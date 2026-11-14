import { spawn } from 'child_process';
import path from 'path';
import { z } from 'zod';
import { loadValidatedConfig, sanitizeShellArg } from '../config/security-validator.js';
import { crossOS } from './cross-os-adapter.js';
import { mediaStudio } from './media-studio-service.js';
import { logger } from './logger.js';
import { db } from '../database/db.js';

const edlSceneSchema = z.object({
  sceneId: z.string().min(1).max(64),
  type: z.enum(['hook', 'intro', 'body', 'broll', 'cta']),
  durationSec: z.number().min(1).max(600),
  captionText: z.string().max(180),
  bgColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#0f172a'),
  textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#38bdf8'),
  transition: z.enum(['fade', 'cut', 'slide']).default('fade')
});

const manualStudioSchema = z.object({
  sourceVideoFile: z.string().optional().nullable(),
  voiceoverAudioFile: z.string().optional().nullable(),
  bgmAudioFile: z.string().optional().nullable(),
  overlayFile: z.string().optional().nullable(),

  muteOriginalVideoAudio: z.boolean().default(false),
  originalVideoVolume: z.number().min(0).max(2).default(1.0),
  voiceoverVolume: z.number().min(0).max(3).default(1.2),
  bgmVolume: z.number().min(0).max(2).default(0.25),

  noiseCancellation: z.boolean().default(true),
  autoDucking: z.boolean().default(true),
  loudnessNormalization: z.boolean().default(true),
  removeSilence: z.boolean().default(false),

  visualFilter: z.enum(['none', 'cinematic', 'warm', 'cyberpunk', 'noir', 'sharp']).default('none'),
  brightness: z.number().min(-0.5).max(0.5).default(0),
  contrast: z.number().min(0.5).max(2.0).default(1.0),
  saturation: z.number().min(0).max(3.0).default(1.0),
  playbackSpeed: z.number().min(0.5).max(2.0).default(1.0),

  startTrimSec: z.number().min(0).default(0),
  endTrimSec: z.number().min(0).default(0),
  chromaKeyGreen: z.boolean().default(false),
  burnSubtitles: z.boolean().default(true)
}).default({});

const edlProjectSchema = z.object({
  title: z.string().min(2).max(120),
  aspectRatio: z.enum(['16:9', '9:16']).default('16:9'),
  fps: z.number().min(24).max(60).default(30),
  scenes: z.array(edlSceneSchema).min(1).max(50),
  manualStudio: manualStudioSchema.optional()
});

const VISUAL_FILTER_PRESETS = {
  none: '',
  cinematic: 'eq=contrast=1.18:brightness=-0.03:saturation=1.15,unsharp=5:5:0.8:5:5:0.0',
  warm: 'colorbalance=rs=0.12:gs=0.04:bs=-0.10,eq=saturation=1.2',
  cyberpunk: 'hue=h=14:s=1.45,eq=contrast=1.22',
  noir: 'hue=s=0,eq=contrast=1.35:brightness=-0.02',
  sharp: 'unsharp=5:5:1.2:5:5:0.0,eq=contrast=1.08'
};

export class CodeDrivenVideoEditor {
  constructor() {
    this.config = loadValidatedConfig();
    this.outputDir = path.resolve('editor/renders');
    crossOS.ensureDirectories([this.outputDir, 'editor/temp']);
    this.ffmpegResolution = crossOS.resolveFFmpegBinary(this.config.FFMPEG_PATH);
  }

  validateAndCompileEDL(rawEdl) {
    crossOS.ensureDirectories([this.outputDir]);

    const parsed = edlProjectSchema.safeParse(rawEdl);
    if (!parsed.success) {
      throw new Error(`Invalid Video Editor Code (EDL): ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
    }

    const edl = parsed.data;
    const studio = manualStudioSchema.parse(edl.manualStudio || {});
    const resolution = edl.aspectRatio === '9:16' ? '1080x1920' : this.config.VIDEO_RESOLUTION;
    const [resW, resH] = resolution.split('x');
    const totalDuration = edl.scenes.reduce((acc, s) => acc + s.durationSec, 0);
    const safeFilename = `render_${Date.now()}.mp4`;
    const outputPath = path.join(this.outputDir, safeFilename);

    const subtitleData = mediaStudio.generateSrtAndChapters(edl.scenes, edl.title);

    const inputArgs = [];
    const filterComplexParts = [];
    let nextInputIdx = 0;

    const uploadedVideoPath = mediaStudio.resolveMediaFilePath('video', studio.sourceVideoFile);
    const uploadedVoicePath = mediaStudio.resolveMediaFilePath('audio', studio.voiceoverAudioFile);
    const uploadedBgmPath = mediaStudio.resolveMediaFilePath('audio', studio.bgmAudioFile);
    const uploadedOverlayPath = mediaStudio.resolveMediaFilePath('overlay', studio.overlayFile);

    let baseVideoLabel = '[basev]';
    let hasSourceVideoAudio = false;
    let sourceVideoInputIdx = -1;

    // 1. Base Video Track (Either Uploaded Manual Video OR Multi-Scene Generated Canvas)
    if (uploadedVideoPath) {
      sourceVideoInputIdx = nextInputIdx++;
      if (studio.startTrimSec > 0) {
        inputArgs.push('-ss', String(studio.startTrimSec));
      }
      if (studio.endTrimSec > studio.startTrimSec) {
        inputArgs.push('-to', String(studio.endTrimSec));
      }
      inputArgs.push('-i', uploadedVideoPath);
      hasSourceVideoAudio = !studio.muteOriginalVideoAudio;

      const vFilters = [`scale=${resW}:${resH}:force_original_aspect_ratio=decrease,pad=${resW}:${resH}:(ow-iw)/2:(oh-ih)/2`];

      if (studio.playbackSpeed !== 1.0) {
        const ptsFactor = (1 / studio.playbackSpeed).toFixed(3);
        vFilters.push(`setpts=${ptsFactor}*PTS`);
      }

      if (VISUAL_FILTER_PRESETS[studio.visualFilter]) {
        vFilters.push(VISUAL_FILTER_PRESETS[studio.visualFilter]);
      }

      if (studio.brightness !== 0 || studio.contrast !== 1.0 || studio.saturation !== 1.0) {
        vFilters.push(`eq=brightness=${studio.brightness}:contrast=${studio.contrast}:saturation=${studio.saturation}`);
      }

      if (studio.burnSubtitles && edl.scenes.length > 0) {
        const firstCaption = sanitizeShellArg(edl.scenes[0].captionText);
        const hexText = (edl.scenes[0].textColor || '#facc15').replace('#', '0x');
        vFilters.push(`drawtext=text='${firstCaption}':fontcolor=${hexText}:fontsize=46:x=(w-text_w)/2:y=h-140`);
      }

      filterComplexParts.push(`[${sourceVideoInputIdx}:v]${vFilters.join(',')}${baseVideoLabel}`);
    } else {
      edl.scenes.forEach((scene) => {
        const sceneInputIdx = nextInputIdx++;
        const hexBg = scene.bgColor.replace('#', '0x');
        inputArgs.push('-f', 'lavfi', '-i', `color=c=${hexBg}:s=${resolution}:d=${scene.durationSec}:r=${edl.fps}`);

        const cleanCaption = sanitizeShellArg(scene.captionText);
        const hexText = scene.textColor.replace('#', '0x');

        filterComplexParts.push(
          `[${sceneInputIdx}:v]drawtext=text='${cleanCaption}':fontcolor=${hexText}:fontsize=44:x=(w-text_w)/2:y=(h-text_h)/2[v${sceneInputIdx}]`
        );
      });

      const concatInputs = edl.scenes.map((_, idx) => `[v${idx}]`).join('');
      const postFilters = ['format=yuv420p'];
      if (VISUAL_FILTER_PRESETS[studio.visualFilter]) {
        postFilters.push(VISUAL_FILTER_PRESETS[studio.visualFilter]);
      }
      filterComplexParts.push(`${concatInputs}concat=n=${edl.scenes.length}:v=1:a=0,${postFilters.join(',')}${baseVideoLabel}`);
    }

    // 2. Picture-in-Picture (PiP) / Watermark / Chroma Key Green Screen Overlay
    let finalVideoLabel = baseVideoLabel;
    if (uploadedOverlayPath) {
      const overlayIdx = nextInputIdx++;
      inputArgs.push('-i', uploadedOverlayPath);
      const ovFilters = ['scale=360:-1'];
      if (studio.chromaKeyGreen) {
        ovFilters.push('chromakey=0x00ff00:0.15:0.1');
      }
      filterComplexParts.push(`[${overlayIdx}:v]${ovFilters.join(',')}[pip]`);
      filterComplexParts.push(`${baseVideoLabel}[pip]overlay=W-w-40:H-h-40:shortest=1[outv]`);
      finalVideoLabel = '[outv]';
    } else {
      filterComplexParts.push(`${baseVideoLabel}null[outv]`);
      finalVideoLabel = '[outv]';
    }

    // 3. Multi-Track Audio Mastering (Original Video Audio + Voiceover + BGM + De-Noise + Loudnorm)
    const audioMixLabels = [];

    if (uploadedVideoPath && hasSourceVideoAudio && studio.originalVideoVolume > 0) {
      filterComplexParts.push(`[${sourceVideoInputIdx}:a]volume=${studio.originalVideoVolume}[origa]`);
      audioMixLabels.push('[origa]');
    }

    if (uploadedVoicePath) {
      const voiceIdx = nextInputIdx++;
      inputArgs.push('-i', uploadedVoicePath);
      const voiceChain = [`volume=${studio.voiceoverVolume}`];

      if (studio.noiseCancellation) {
        voiceChain.push('highpass=f=80', 'lowpass=f=8500', 'afftdn=nf=-25');
      }
      if (studio.removeSilence) {
        voiceChain.push('silenceremove=start_periods=1:start_silence=0.3:start_threshold=-40dB:stop_periods=-1:stop_silence=0.4:stop_threshold=-40dB');
      }
      if (studio.loudnessNormalization) {
        voiceChain.push('loudnorm=I=-14:TP=-1.5:LRA=11');
      }

      filterComplexParts.push(`[${voiceIdx}:a]${voiceChain.join(',')}[voicea]`);
      audioMixLabels.push('[voicea]');
    }

    if (uploadedBgmPath) {
      const bgmIdx = nextInputIdx++;
      inputArgs.push('-i', uploadedBgmPath);
      const effectiveBgmVol = (studio.autoDucking && uploadedVoicePath)
        ? Number((studio.bgmVolume * 0.45).toFixed(2))
        : studio.bgmVolume;
      filterComplexParts.push(`[${bgmIdx}:a]volume=${effectiveBgmVol}[bgma]`);
      audioMixLabels.push('[bgma]');
    }

    const mapArgs = ['-map', finalVideoLabel];
    if (audioMixLabels.length === 1) {
      filterComplexParts.push(`${audioMixLabels[0]}anull[outa]`);
      mapArgs.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '192k', '-shortest');
    } else if (audioMixLabels.length > 1) {
      filterComplexParts.push(`${audioMixLabels.join('')}amix=inputs=${audioMixLabels.length}:duration=first:dropout_transition=2[outa]`);
      mapArgs.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '192k', '-shortest');
    }

    const filterComplexScript = filterComplexParts.join('; ');
    const ffmpegArgs = [
      '-y',
      ...inputArgs,
      '-filter_complex',
      filterComplexScript,
      ...mapArgs,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      outputPath
    ];

    const binPath = this.ffmpegResolution.binaryPath;
    const compiledProject = {
      title: edl.title,
      aspectRatio: edl.aspectRatio,
      resolution,
      fps: edl.fps,
      totalDurationSec: totalDuration,
      sceneCount: edl.scenes.length,
      outputFile: safeFilename,
      srtFile: subtitleData.srtFilename,
      chaptersText: subtitleData.chaptersText,
      manualStudioApplied: studio,
      ffmpegBinary: binPath,
      ffmpegAvailable: this.ffmpegResolution.available,
      ffmpegCommandPreview: `${binPath} ${ffmpegArgs.join(' ')}`,
      edlCode: edl
    };

    const saved = db.saveEdlProject(compiledProject);
    logger.success('CodeVideoEditor', `Compiled Studio EDL "${edl.title}" (DeNoise: ${studio.noiseCancellation}, MuteOrig: ${studio.muteOriginalVideoAudio}, Filter: ${studio.visualFilter})`);
    return { ...saved, ffmpegArgs, outputPath };
  }

  async executeRender(compiledEdl) {
    crossOS.ensureDirectories([this.outputDir]);

    if (!this.ffmpegResolution.available) {
      logger.info('CodeVideoEditor', 'FFmpeg binary not installed on host; returning verified Studio EDL dry-run artifact.');
      return {
        rendered: false,
        mode: 'code-compiled-dry-run',
        outputFile: compiledEdl.outputFile,
        srtFile: compiledEdl.srtFile,
        command: compiledEdl.ffmpegCommandPreview
      };
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        resolve(result);
      };

      const child = spawn(this.ffmpegResolution.binaryPath, compiledEdl.ffmpegArgs, {
        stdio: 'ignore',
        windowsHide: true
      });

      const timeoutHandle = setTimeout(() => {
        logger.warn('CodeVideoEditor', `FFmpeg render exceeded ${this.config.FFMPEG_TIMEOUT_MS}ms timeout. Terminating process.`);
        try { child.kill('SIGKILL'); } catch {}
        finish({
          rendered: false,
          mode: 'timeout-guarded-fallback',
          outputFile: compiledEdl.outputFile,
          srtFile: compiledEdl.srtFile,
          command: compiledEdl.ffmpegCommandPreview
        });
      }, this.config.FFMPEG_TIMEOUT_MS);

      child.on('error', () => {
        finish({
          rendered: false,
          mode: 'code-compiled-dry-run',
          outputFile: compiledEdl.outputFile,
          srtFile: compiledEdl.srtFile,
          command: compiledEdl.ffmpegCommandPreview
        });
      });

      child.on('exit', (code) => {
        if (code === 0) {
          logger.success('CodeVideoEditor', `Rendered Studio MP4 video: ${compiledEdl.outputFile}`);
          finish({
            rendered: true,
            mode: 'ffmpeg-hardware-render',
            outputFile: compiledEdl.outputFile,
            srtFile: compiledEdl.srtFile,
            command: compiledEdl.ffmpegCommandPreview
          });
        } else {
          finish({
            rendered: false,
            mode: 'code-compiled-dry-run',
            outputFile: compiledEdl.outputFile,
            srtFile: compiledEdl.srtFile,
            command: compiledEdl.ffmpegCommandPreview
          });
        }
      });
    });
  }
}

export const codeVideoEditor = new CodeDrivenVideoEditor();
                                                            
