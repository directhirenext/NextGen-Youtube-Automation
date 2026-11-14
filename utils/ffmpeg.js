import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, execFileSync } from 'child_process';
import { z } from 'zod';
import { loadValidatedConfig, wrapCaptionLines } from '../config/security-validator.js';
import { crossOS } from './cross-os-adapter.js';
import { mediaStudio } from './media-studio-service.js';
import { logger } from './logger.js';
import { db } from '../database/db.js';

const edlSceneSchema = z.object({
  sceneId: z.string().min(1).max(64),
  type: z.enum(['hook', 'intro', 'body', 'broll', 'cta']),
  durationSec: z.number().min(1).max(600),
  captionText: z.string().min(1).max(240),
  narrationText: z.string().max(1000).optional(),
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
  fps: z.number().min(15).max(60).default(30),
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
    this.outputDir = crossOS.resolveProjectPath('editor', 'renders');
    this.tempDir = crossOS.resolveProjectPath('editor', 'temp');
    crossOS.ensureDirectories([this.outputDir, this.tempDir]);
  }

  _escapeFilterPath(filePath) {
    return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  }

  probeMediaFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      return { exists: false, hasVideo: false, hasAudio: false, durationSec: 0 };
    }
    const probeBin = crossOS.resolveFFprobeBinary(this.config.FFPROBE_PATH);
    if (!probeBin.available) {
      return { exists: true, hasVideo: true, hasAudio: true, durationSec: 0 };
    }
    try {
      const raw = execFileSync(probeBin.binaryPath, [
        '-v', 'error',
        '-show_entries', 'stream=codec_type:format=duration',
        '-of', 'json',
        filePath
      ], { encoding: 'utf-8', timeout: 8000 });
      const parsed = JSON.parse(raw);
      const streams = parsed.streams || [];
      const hasVideo = streams.some(s => s.codec_type === 'video');
      const hasAudio = streams.some(s => s.codec_type === 'audio');
      const durationSec = Number.parseFloat(parsed.format?.duration || '0') || 0;
      return { exists: true, hasVideo, hasAudio, durationSec };
    } catch {
      return { exists: true, hasVideo: true, hasAudio: false, durationSec: 0 };
    }
  }

  validateAndCompileEDL(rawEdl, { saveRecord = true, writeSrt = true } = {}) {
    crossOS.ensureDirectories([this.outputDir, this.tempDir]);

    const ffmpegResolution = crossOS.resolveFFmpegBinary(this.config.FFMPEG_PATH);
    const fontPath = crossOS.resolveDevanagariFontPath(this.config.FONT_FILE_PATH);

    const parsed = edlProjectSchema.safeParse(rawEdl);
    if (!parsed.success) {
      throw new Error(`Invalid Video Editor Code (EDL): ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
    }

    const edl = structuredClone(parsed.data);
    const studio = manualStudioSchema.parse(edl.manualStudio || {});

    if (studio.endTrimSec > 0 && studio.endTrimSec <= studio.startTrimSec) {
      throw new Error(`Invalid trim range: endTrimSec (${studio.endTrimSec}s) must be greater than startTrimSec (${studio.startTrimSec}s).`);
    }

    const isVertical = edl.aspectRatio === '9:16';
    const resolution = isVertical ? '1080x1920' : this.config.VIDEO_RESOLUTION;
    const [resW, resH] = resolution.split('x').map(Number);
    const fontSize = isVertical ? 40 : 46;
    const maxCharsPerLine = isVertical ? 26 : 40;

    const uploadedVideoPath = mediaStudio.resolveMediaFilePath('video', studio.sourceVideoFile);
    const uploadedVoicePath = mediaStudio.resolveMediaFilePath('audio', studio.voiceoverAudioFile);
    const uploadedBgmPath = mediaStudio.resolveMediaFilePath('audio', studio.bgmAudioFile);
    const uploadedOverlayPath = mediaStudio.resolveMediaFilePath('overlay', studio.overlayFile);

    const videoProbe = this.probeMediaFile(uploadedVideoPath);
    const voiceProbe = this.probeMediaFile(uploadedVoicePath);

    // Sync scene total duration with actual voiceover length so voice NEVER gets cut short (Fixes B12)
    let sceneSumSec = edl.scenes.reduce((acc, s) => acc + s.durationSec, 0);
    if (voiceProbe.durationSec > sceneSumSec) {
      const extraPerScene = Math.ceil((voiceProbe.durationSec - sceneSumSec) / edl.scenes.length);
      edl.scenes.forEach(s => { s.durationSec += extraPerScene; });
      sceneSumSec = edl.scenes.reduce((acc, s) => acc + s.durationSec, 0);
    }

    const subtitleData = mediaStudio.generateSrtAndChapters(edl.scenes, edl.title, { writeFile: writeSrt });

    const jobToken = `${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const safeFilename = `render_${jobToken}.mp4`;
    const outputPath = path.join(this.outputDir, safeFilename);
    const tempCaptionFiles = [];

    const inputArgs = ['-protocol_whitelist', 'file,pipe,crypto'];
    const filterComplexParts = [];
    let nextInputIdx = 0;

    const fontOption = fontPath ? `:fontfile='${this._escapeFilterPath(fontPath)}'` : '';
    let baseVideoLabel = '[basev]';
    let sourceVideoInputIdx = -1;

    // 1. Base Video Stream
    if (uploadedVideoPath && videoProbe.exists) {
      sourceVideoInputIdx = nextInputIdx++;
      if (studio.startTrimSec > 0) {
        inputArgs.push('-ss', String(studio.startTrimSec));
      }
      if (studio.endTrimSec > studio.startTrimSec) {
        inputArgs.push('-to', String(studio.endTrimSec));
      }
      inputArgs.push('-i', uploadedVideoPath);

      const vFilters = [
        `scale=${resW}:${resH}:force_original_aspect_ratio=decrease`,
        `pad=${resW}:${resH}:(ow-iw)/2:(oh-ih)/2`,
        `fps=${edl.fps}`,
        'format=yuv420p'
      ];

      if (studio.playbackSpeed !== 1.0) {
        const ptsFactor = (1 / studio.playbackSpeed).toFixed(4);
        vFilters.push(`setpts=${ptsFactor}*PTS`);
      }

      if (VISUAL_FILTER_PRESETS[studio.visualFilter]) {
        vFilters.push(VISUAL_FILTER_PRESETS[studio.visualFilter]);
      }

      if (studio.brightness !== 0 || studio.contrast !== 1.0 || studio.saturation !== 1.0) {
        vFilters.push(`eq=brightness=${studio.brightness}:contrast=${studio.contrast}:saturation=${studio.saturation}`);
      }

      // Burn timed captions for ALL scenes onto uploaded video (Fixes B11)
      if (studio.burnSubtitles && edl.scenes.length > 0) {
        let elapsed = 0;
        edl.scenes.forEach((scene, idx) => {
          const startT = elapsed;
          const endT = elapsed + scene.durationSec;
          elapsed = endT;

          const wrapped = wrapCaptionLines(scene.captionText, maxCharsPerLine);
          const capFile = path.join(this.tempDir, `cap_${jobToken}_${idx}.txt`);
          fs.writeFileSync(capFile, wrapped, { encoding: 'utf-8', mode: 0o600 });
          tempCaptionFiles.push(capFile);

          const escapedCapPath = this._escapeFilterPath(capFile);
          const hexText = (scene.textColor || '#facc15').replace('#', '0x');
          vFilters.push(
            `drawtext=textfile='${escapedCapPath}'${fontOption}:fontcolor=${hexText}:fontsize=${fontSize}:line_spacing=10:box=1:boxcolor=0x000000AA:boxborderw=14:x=(w-text_w)/2:y=h-text_h-110:enable='between(t,${startT},${endT})'`
          );
        });
      }

      filterComplexParts.push(`[${sourceVideoInputIdx}:v]${vFilters.join(',')}${baseVideoLabel}`);
    } else {
      // Multi-Scene Canvas Mode with Devanagari textfile= and Visual Filters/Color Controls (Fixes B2, B13)
      edl.scenes.forEach((scene, idx) => {
        const sceneInputIdx = nextInputIdx++;
        const hexBg = scene.bgColor.replace('#', '0x');
        inputArgs.push('-f', 'lavfi', '-i', `color=c=${hexBg}:s=${resolution}:d=${scene.durationSec}:r=${edl.fps}`);

        const wrapped = wrapCaptionLines(scene.captionText, maxCharsPerLine);
        const capFile = path.join(this.tempDir, `cap_${jobToken}_${idx}.txt`);
        fs.writeFileSync(capFile, wrapped, { encoding: 'utf-8', mode: 0o600 });
        tempCaptionFiles.push(capFile);

        const escapedCapPath = this._escapeFilterPath(capFile);
        const hexText = scene.textColor.replace('#', '0x');

        const sceneChain = [
          `drawtext=textfile='${escapedCapPath}'${fontOption}:fontcolor=${hexText}:fontsize=${fontSize}:line_spacing=12:box=1:boxcolor=0x00000088:boxborderw=16:x=(w-text_w)/2:y=(h-text_h)/2`
        ];

        if ( scene.transition === 'fade' && scene.durationSec >= 2 ) {
          sceneChain.push(`fade=t=in:st=0:d=0.4`, `fade=t=out:st=${(scene.durationSec - 0.4).toFixed(2)}:d=0.4`);
        }

        filterComplexParts.push(`[${sceneInputIdx}:v]${sceneChain.join(',')}[v${idx}]`);
      });

      const concatInputs = edl.scenes.map((_, idx) => `[v${idx}]`).join('');
      const postFilters = ['format=yuv420p'];
      if (VISUAL_FILTER_PRESETS[studio.visualFilter]) {
        postFilters.push(VISUAL_FILTER_PRESETS[studio.visualFilter]);
      }
      if (studio.brightness !== 0 || studio.contrast !== 1.0 || studio.saturation !== 1.0) {
        postFilters.push(`eq=brightness=${studio.brightness}:contrast=${studio.contrast}:saturation=${studio.saturation}`);
      }
      if (studio.playbackSpeed !== 1.0) {
        const ptsFactor = (1 / studio.playbackSpeed).toFixed(4);
        postFilters.push(`setpts=${ptsFactor}*PTS`);
      }
      filterComplexParts.push(`${concatInputs}concat=n=${edl.scenes.length}:v=1:a=0,${postFilters.join(',')}${baseVideoLabel}`);
    }

    // 2. Picture-in-Picture / Watermark / Chroma Key Overlay with -loop 1 for Static Images (Fixes B4)
    let finalVideoLabel = '[outv]';
    if (uploadedOverlayPath) {
      const overlayIdx = nextInputIdx++;
      const ext = path.extname(uploadedOverlayPath).toLowerCase();
      const isStaticImage = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
      if (isStaticImage) {
        inputArgs.push('-loop', '1');
      }
      inputArgs.push('-i', uploadedOverlayPath);

      const ovFilters = ['scale=340:-1'];
      if (studio.chromaKeyGreen) {
        ovFilters.push('chromakey=0x00ff00:0.15:0.1');
      }
      filterComplexParts.push(`[${overlayIdx}:v]${ovFilters.join(',')}[pip]`);
      filterComplexParts.push(`${baseVideoLabel}[pip]overlay=W-w-40:H-h-40:shortest=1[outv]`);
    } else {
      filterComplexParts.push(`${baseVideoLabel}null[outv]`);
    }

    // 3. Multi-Track Audio Mastering (ffprobe-checked Original Audio + Voiceover + Sidechain Auto-Ducking + Final Loudnorm)
    let origLabel = null;
    let voiceLabel = null;
    let bgmLabel = null;

    const hasUsableOrigAudio = Boolean(
      uploadedVideoPath &&
      videoProbe.hasAudio &&
      !studio.muteOriginalVideoAudio &&
      studio.originalVideoVolume > 0
    );

    if (hasUsableOrigAudio) {
      const origChain = [`volume=${studio.originalVideoVolume}`];
      if (studio.noiseCancellation) {
        origChain.push('highpass=f=80', 'lowpass=f=8500', 'afftdn=nf=-25');
      }
      if (studio.playbackSpeed !== 1.0) {
        origChain.push(`atempo=${studio.playbackSpeed}`);
      }
      filterComplexParts.push(`[${sourceVideoInputIdx}:a]${origChain.join(',')}[origa]`);
      origLabel = '[origa]';
    }

    if (uploadedVoicePath && voiceProbe.exists) {
      const voiceIdx = nextInputIdx++;
      inputArgs.push('-i', uploadedVoicePath);
      const voiceChain = [`volume=${studio.voiceoverVolume}`];
      if (studio.noiseCancellation) {
        voiceChain.push('highpass=f=80', 'lowpass=f=8500', 'afftdn=nf=-25');
      }
      if (studio.removeSilence) {
        voiceChain.push('silenceremove=start_periods=1:start_silence=0.25:start_threshold=-40dB:stop_periods=-1:stop_silence=0.35:stop_threshold=-40dB');
      }
      if (studio.playbackSpeed !== 1.0) {
        voiceChain.push(`atempo=${studio.playbackSpeed}`);
      }
      filterComplexParts.push(`[${voiceIdx}:a]${voiceChain.join(',')}[voicea]`);
      voiceLabel = '[voicea]';
    }

    if (uploadedBgmPath) {
      const bgmIdx = nextInputIdx++;
      inputArgs.push('-i', uploadedBgmPath);
      filterComplexParts.push(`[${bgmIdx}:a]volume=${studio.bgmVolume}[bgma]`);
      bgmLabel = '[bgma]';
    }

    const activeAudioStreams = [];
    if (origLabel) activeAudioStreams.push(origLabel);

    // Real Sidechain Compression Auto-Ducking when both Voiceover and BGM exist (Fixes B8)
    if (voiceLabel && bgmLabel && studio.autoDucking) {
      filterComplexParts.push(`${voiceLabel}asplit=2[voicemai][voicesc]`);
      filterComplexParts.push(`${bgmLabel}[voicesc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[bgmducked]`);
      activeAudioStreams.push('[voicemai]', '[bgmducked]');
    } else {
      if (voiceLabel) activeAudioStreams.push(voiceLabel);
      if (bgmLabel) activeAudioStreams.push(bgmLabel);
    }

    const mapArgs = ['-map', finalVideoLabel];
    if (activeAudioStreams.length > 0) {
      let mixedAudioLabel = '[preloud]';
      if (activeAudioStreams.length === 1) {
        filterComplexParts.push(`${activeAudioStreams[0]}anull${mixedAudioLabel}`);
      } else {
        filterComplexParts.push(
          `${activeAudioStreams.join('')}amix=inputs=${activeAudioStreams.length}:duration=longest:dropout_transition=2:normalize=0${mixedAudioLabel}`
        );
      }

    // Apply YouTube -14 LUFS Loudness Normalization & 48kHz Resampling on Final Master Mix (Fixes B9)
      if (studio.loudnessNormalization) {
        filterComplexParts.push(`${mixedAudioLabel}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[outa]`);
      } else {
        filterComplexParts.push(`${mixedAudioLabel}aresample=48000[outa]`);
      }
      mapArgs.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '192k');
    }

    const effectiveDurationSec = Math.max(
      4,
      Math.ceil((uploadedVideoPath && videoProbe.durationSec > 0 ? videoProbe.durationSec : sceneSumSec) / studio.playbackSpeed)
    );

    const filterComplexScript = filterComplexParts.join('; ');
    const ffmpegArgs = [
      '-y',
      ...inputArgs,
      '-filter_complex',
      filterComplexScript,
      ...mapArgs,
      '-t',
      String(effectiveDurationSec),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '21',
      '-preset',
      'veryfast',
      '-movflags',
      '+faststart',
      outputPath
    ];

    const redactedPreviewArgs = ffmpegArgs.map(arg =>
      arg.startsWith(crossOS.resolveProjectPath())
        ? path.relative(crossOS.resolveProjectPath(), arg)
        : arg
    );

    const compiledProject = {
      title: edl.title,
      aspectRatio: edl.aspectRatio,
      resolution,
      fps: edl.fps,
      totalDurationSec: effectiveDurationSec,
      sceneCount: edl.scenes.length,
      outputFile: safeFilename,
      srtFile: subtitleData.srtFilename,
      chaptersText: subtitleData.chaptersText,
      manualStudioApplied: studio,
      fontUsed: fontPath ? path.basename(fontPath) : 'system-default',
      ffmpegAvailable: ffmpegResolution.available,
      ffmpegCommandPreview: `ffmpeg ${redactedPreviewArgs.map(a => (a.includes(' ') || a.includes(';') ? `"${a}"` : a)).join(' ')}`,
      edlCode: edl
    };

    const saved = saveRecord ? db.saveEdlProject(compiledProject) : { id: `edl_${crypto.randomUUID()}`, ...compiledProject };
    return {
      ...saved,
      ffmpegBinary: ffmpegResolution.binaryPath,
      ffmpegArgs,
      outputPath,
      tempCaptionFiles
    };
  }

  async executeRender(compiledEdl) {
    crossOS.ensureDirectories([this.outputDir]);
    const cleanupTempFiles = () => {
      for (const f of compiledEdl.tempCaptionFiles || []) {
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch {}
      }
    };

    const ffmpegResolution = crossOS.resolveFFmpegBinary(this.config.FFMPEG_PATH);
    if (!ffmpegResolution.available) {
      cleanupTempFiles();
      const msg = 'FFmpeg binary is not installed on this system. Run "npm run setup" or install ffmpeg to render real MP4 files.';
      logger.warn('CodeVideoEditor', msg);
      return {
        rendered: false,
        mode: 'ffmpeg-missing',
        error: msg,
        outputFile: compiledEdl.outputFile,
        srtFile: compiledEdl.srtFile,
        command: compiledEdl.ffmpegCommandPreview
      };
    }

    const dynamicTimeoutMs = Math.max(
      this.config.FFMPEG_TIMEOUT_MS || 180000,
      (compiledEdl.totalDurationSec || 30) * 4000
    );

    return new Promise((resolve) => {
      let settled = false;
      const stderrLines = [];

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        cleanupTempFiles();
        resolve(result);
      };

      const child = spawn(ffmpegResolution.binaryPath, compiledEdl.ffmpegArgs, {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
      });

      child.stderr?.on('data', (chunk) => {
        const lines = chunk.toString('utf-8').split(/\r?\n/).filter(Boolean);
        stderrLines.push(...lines);
        if (stderrLines.length > 30) {
          stderrLines.splice(0, stderrLines.length - 30);
        }
      });

      const timeoutHandle = setTimeout(() => {
        logger.error('CodeVideoEditor', `FFmpeg render timed out after ${dynamicTimeoutMs}ms. Cleaning up partial file.`);
        try { child.kill('SIGKILL'); } catch {}
        try {
          if (fs.existsSync(compiledEdl.outputPath)) fs.unlinkSync(compiledEdl.outputPath);
        } catch {}
        finish({
          rendered: false,
          mode: 'render-timeout',
          error: `FFmpeg render timed out after ${Math.round(dynamicTimeoutMs / 1000)}s.`,
          stderrTail: stderrLines.slice(-15).join('\n'),
          outputFile: compiledEdl.outputFile,
          srtFile: compiledEdl.srtFile,
          command: compiledEdl.ffmpegCommandPreview
        });
      }, dynamicTimeoutMs);

      child.on('error', (err) => {
        try {
          if (fs.existsSync(compiledEdl.outputPath)) fs.unlinkSync(compiledEdl.outputPath);
        } catch {}
        finish({
          rendered: false,
          mode: 'spawn-error',
          error: err.message,
          stderrTail: stderrLines.slice(-15).join('\n'),
          outputFile: compiledEdl.outputFile,
          srtFile: compiledEdl.srtFile,
          command: compiledEdl.ffmpegCommandPreview
        });
      });

      child.on('exit', (code) => {
        const fileValid =
          code === 0 &&
          fs.existsSync(compiledEdl.outputPath) &&
          fs.statSync(compiledEdl.outputPath).size > 512;

        if (fileValid) {
          logger.success('CodeVideoEditor', `Successfully rendered MP4 video: ${compiledEdl.outputFile}`);
          finish({
            rendered: true,
            mode: 'ffmpeg-hardware-render',
            outputFile: compiledEdl.outputFile,
            outputPath: compiledEdl.outputPath,
            srtFile: compiledEdl.srtFile,
            command: compiledEdl.ffmpegCommandPreview
          });
        } else {
          try {
            if (fs.existsSync(compiledEdl.outputPath)) fs.unlinkSync(compiledEdl.outputPath);
          } catch {}
          const errTail = stderrLines.slice(-15).join('\n') || `FFmpeg exited with code ${code}`;
          logger.error('CodeVideoEditor', `FFmpeg render failed (code ${code}): ${errTail}`);
          finish({
            rendered: false,
            mode: 'render-failed',
            error: `FFmpeg exited with code ${code}`,
            stderrTail: errTail,
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
