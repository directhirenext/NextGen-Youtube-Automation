import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { loadValidatedConfig, sanitizeShellArg } from '../config/security-validator.js';
import { logger } from './logger.js';
import { db } from '../database/db.js';

const edlSceneSchema = z.object({
  sceneId: z.string(),
  type: z.enum(['hook', 'intro', 'body', 'broll', 'cta']),
  durationSec: z.number().min(1).max(600),
  captionText: z.string().max(180),
  bgColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#0f172a'),
  textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#38bdf8'),
  transition: z.enum(['fade', 'cut', 'slide']).default('fade')
});

const edlProjectSchema = z.object({
  title: z.string().min(2).max(120),
  aspectRatio: z.enum(['16:9', '9:16']).default('16:9'),
  fps: z.number().min(24).max(60).default(30),
  scenes: z.array(edlSceneSchema).min(1)
});

export class CodeDrivenVideoEditor {
  constructor() {
    this.config = loadValidatedConfig();
    this.outputDir = path.resolve('editor/renders');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  validateAndCompileEDL(rawEdl) {
    const parsed = edlProjectSchema.safeParse(rawEdl);
    if (!parsed.success) {
      throw new Error(`Invalid Video Editor Code (EDL): ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
    }

    const edl = parsed.data;
    const resolution = edl.aspectRatio === '9:16' ? '1080x1920' : this.config.VIDEO_RESOLUTION;
    const totalDuration = edl.scenes.reduce((acc, s) => acc + s.durationSec, 0);
    const safeFilename = `render_${Date.now()}.mp4`;
    const outputPath = path.join(this.outputDir, safeFilename);

    const filterComplexParts = [];
    const inputArgs = [];

    edl.scenes.forEach((scene, idx) => {
      const hexBg = scene.bgColor.replace('#', '0x');
      inputArgs.push('-f', 'lavfi', '-i', `color=c=${hexBg}:s=${resolution}:d=${scene.durationSec}:r=${edl.fps}`);

      const cleanCaption = sanitizeShellArg(scene.captionText).replace(/:/g, '\\:').replace(/'/g, '');
      const hexText = scene.textColor.replace('#', '0x');

      filterComplexParts.push(
        `[${idx}:v]drawtext=text='${cleanCaption}':fontcolor=${hexText}:fontsize=44:x=(w-text_w)/2:y=(h-text_h)/2[v${idx}]`
      );
    });

    const concatInputs = edl.scenes.map((_, idx) => `[v${idx}]`).join('');
    filterComplexParts.push(`${concatInputs}concat=n=${edl.scenes.length}:v=1:a=0,format=yuv420p[outv]`);

    const filterComplexScript = filterComplexParts.join('; ');
    const ffmpegArgs = [
      '-y',
      ...inputArgs,
      '-filter_complex',
      filterComplexScript,
      '-map',
      '[outv]',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      outputPath
    ];

    const compiledProject = {
      title: edl.title,
      aspectRatio: edl.aspectRatio,
      resolution,
      fps: edl.fps,
      totalDurationSec: totalDuration,
      sceneCount: edl.scenes.length,
      outputFile: safeFilename,
      ffmpegCommandPreview: `${this.config.FFMPEG_PATH} ${ffmpegArgs.join(' ')}`,
      edlCode: edl
    };

    const saved = db.saveEdlProject(compiledProject);
    logger.success('CodeVideoEditor', `Compiled Claude-Style EDL for "${edl.title}" (${totalDuration}s, ${edl.scenes.length} scenes)`);
    return { ...saved, ffmpegArgs, outputPath };
  }

  async executeRender(compiledEdl) {
    return new Promise((resolve) => {
      const child = spawn(this.config.FFMPEG_PATH, compiledEdl.ffmpegArgs, { stdio: 'ignore' });

      child.on('error', () => {
        logger.warn('CodeVideoEditor', 'FFmpeg binary not installed on host; returning verified EDL dry-run artifact.');
        resolve({
          rendered: false,
          mode: 'code-compiled-dry-run',
          outputFile: compiledEdl.outputFile,
          command: compiledEdl.ffmpegCommandPreview
        });
      });

      child.on('close', (code) => {
        if (code === 0) {
          logger.success('CodeVideoEditor', `Successfully rendered MP4 video: ${compiledEdl.outputFile}`);
          resolve({
            rendered: true,
            mode: 'ffmpeg-hardware-render',
            outputFile: compiledEdl.outputFile,
            command: compiledEdl.ffmpegCommandPreview
          });
        } else {
          resolve({
            rendered: false,
            mode: 'code-compiled-dry-run',
            outputFile: compiledEdl.outputFile,
            command: compiledEdl.ffmpegCommandPreview
          });
        }
      });
    });
  }
}

export const codeVideoEditor = new CodeDrivenVideoEditor();
      
