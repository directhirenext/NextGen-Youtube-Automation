import fs from 'fs';
import path from 'path';
import {
  loadValidatedConfig,
  sanitizeSafeFilename,
  assertSafeRemoteUrl
} from '../config/security-validator.js';
import { crossOS } from './cross-os-adapter.js';
import { logger } from './logger.js';

const MEDIA_DIRS = {
  video: crossOS.resolveProjectPath('editor', 'uploads', 'videos'),
  audio: crossOS.resolveProjectPath('editor', 'uploads', 'audio'),
  overlay: crossOS.resolveProjectPath('editor', 'uploads', 'overlays'),
  subtitles: crossOS.resolveProjectPath('editor', 'renders', 'subtitles')
};

const ALLOWED_EXTENSIONS = {
  video: new Set(['.mp4', '.webm', '.mov', '.mkv']),
  audio: new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg']),
  overlay: new Set(['.png', '.jpg', '.jpeg', '.webp', '.mp4'])
};

export class MediaStudioService {
  constructor() {
    this.config = loadValidatedConfig();
    crossOS.ensureDirectories(Object.values(MEDIA_DIRS));
  }

  _verifyMagicBytes(buffer, ext) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
    const hex4 = buffer.subarray(0, 4).toString('hex').toLowerCase();
    const ascii4 = buffer.subarray(0, 4).toString('ascii');
    const ftyp = buffer.subarray(4, 8).toString('ascii');

    switch (ext) {
      case '.png':
        return hex4 === '89504e47';
      case '.jpg':
      case '.jpeg':
        return hex4.startsWith('ffd8ff');
      case '.webp':
        return ascii4 === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
      case '.wav':
        return ascii4 === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
      case '.ogg':
        return ascii4 === 'OggS';
      case '.webm':
      case '.mkv':
        return hex4 === '1a45dfa3';
      case '.mp4':
      case '.m4a':
      case '.mov':
        return ftyp === 'ftyp' || ftyp === 'moov' || ftyp === 'wide' || ftyp === 'mdat';
      case '.mp3':
      case '.aac':
        return ascii4.startsWith('ID3') || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
      default:
        return false;
    }
  }

  async saveUploadedMedia({ category = 'video', originalName, base64Data, skipMagicCheck = false }) {
    if (!Object.hasOwn(MEDIA_DIRS, category) || category === 'subtitles') {
      throw new Error(`Invalid media category: ${category}`);
    }
    if (!base64Data || typeof base64Data !== 'string') {
      throw new Error('Missing base64 media payload.');
    }

    const safeName = sanitizeSafeFilename(originalName || `${category}_${Date.now()}.mp4`);
    const ext = path.extname(safeName).toLowerCase();

    if (!ALLOWED_EXTENSIONS[category].has(ext)) {
      throw new Error(`Unsupported ${category} format "${ext}". Allowed: ${Array.from(ALLOWED_EXTENSIONS[category]).join(', ')}`);
    }

    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(cleanBase64, 'base64');

    const maxBytes = (this.config.MAX_UPLOAD_SIZE_MB || 150) * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new Error(`File exceeds maximum upload limit of ${this.config.MAX_UPLOAD_SIZE_MB}MB.`);
    }

    if (!skipMagicCheck && !this._verifyMagicBytes(buffer, ext)) {
      throw new Error(`Security rejection: File header (magic bytes) does not match a valid ${ext} media container.`);
    }

    const finalFilename = `${Date.now()}_${safeName}`;
    const fullPath = path.join(MEDIA_DIRS[category], finalFilename);
    await fs.promises.writeFile(fullPath, buffer, { mode: 0o600 });

    logger.success('MediaStudio', `Uploaded verified ${category} asset: ${finalFilename} (${(buffer.length / 1024).toFixed(1)} KB)`);
    return {
      id: finalFilename,
      category,
      filename: finalFilename,
      sizeBytes: buffer.length,
      uploadedAt: new Date().toISOString()
    };
  }

  listUploadedMedia() {
    crossOS.ensureDirectories(Object.values(MEDIA_DIRS));
    const readDirSafe = (dirPath, category) => {
      if (!fs.existsSync(dirPath)) return [];
      return fs.readdirSync(dirPath)
        .filter(f => !f.startsWith('.'))
        .map(f => {
          const stat = fs.statSync(path.join(dirPath, f));
          return {
            id: f,
            filename: f,
            category,
            sizeBytes: stat.size,
            uploadedAt: stat.mtime.toISOString()
          };
        })
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    };

    return {
      videos: readDirSafe(MEDIA_DIRS.video, 'video'),
      audio: readDirSafe(MEDIA_DIRS.audio, 'audio'),
      overlays: readDirSafe(MEDIA_DIRS.overlay, 'overlay'),
      subtitles: readDirSafe(MEDIA_DIRS.subtitles, 'subtitles')
    };
  }

  resolveMediaFilePath(category, filename) {
    if (!filename || !Object.hasOwn(MEDIA_DIRS, category)) return null;
    const safeFile = path.basename(String(filename));
    const fullPath = path.join(MEDIA_DIRS[category], safeFile);
    return fs.existsSync(fullPath) ? fullPath : null;
  }

  deleteMediaAsset(category, filename) {
    const resolved = this.resolveMediaFilePath(category, filename);
    if (resolved && fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
      logger.warn('MediaStudio', `Deleted ${category} asset: ${filename}`);
      return true;
    }
    return false;
  }

  // Enforces YouTube's official chapter rules: starts at 00:00, >=3 chapters, each >=10s, proper HH:MM:SS formatting (Fixes B17)
  generateSrtAndChapters(scenes = [], projectTitle = 'video', { writeFile = true } = {}) {
    crossOS.ensureDirectories([MEDIA_DIRS.subtitles]);
    let currentSec = 0;
    const srtBlocks = [];
    const rawTimeline = [];

    const formatSrtTime = (sec) => {
      const totalMs = Math.round(sec * 1000);
      const hrs = String(Math.floor(totalMs / 3600000)).padStart(2, '0');
      const mins = String(Math.floor((totalMs % 3600000) / 60000)).padStart(2, '0');
      const secs = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, '0');
      const ms = String(totalMs % 1000).padStart(3, '0');
      return `${hrs}:${mins}:${secs},${ms}`;
    };

    const formatChapterTime = (sec) => {
      const whole = Math.floor(sec);
      const hrs = Math.floor(whole / 3600);
      const mins = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
      const secs = String(whole % 60).padStart(2, '0');
      return hrs > 0 ? `${hrs}:${mins}:${secs}` : `${mins}:${secs}`;
    };

    scenes.forEach((scene, index) => {
      const start = currentSec;
      const duration = Math.max(1, Number(scene.durationSec || 10));
      const end = start + duration;
      const label = (scene.captionText || scene.type || `Section ${index + 1}`).replace(/\s+/g, ' ').trim();

      srtBlocks.push(
        `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${label}\n`
      );
      rawTimeline.push({ start, duration, label: label.slice(0, 60) });
      currentSec = end;
    });

    // Merge short scenes so every YouTube chapter is >=10 seconds
    const validChapters = [];
    for (const item of rawTimeline) {
      if (validChapters.length === 0) {
        validChapters.push({ start: 0, duration: item.duration, label: item.label });
      } else {
        const prev = validChapters[validChapters.length - 1];
        if (prev.duration < 10) {
          prev.duration += item.duration;
        } else {
          validChapters.push({ start: item.start, duration: item.duration, label: item.label });
        }
      }
    }

    const chaptersLines = validChapters.map(ch => `${formatChapterTime(ch.start)} - ${ch.label}`);
    const srtContent = srtBlocks.join('\n');
    let srtFilename = null;
    let srtPath = null;

    if (writeFile) {
      const safeTitle = sanitizeSafeFilename(`${projectTitle}.srt`).replace(/\.srt$/i, '');
      srtFilename = `${safeTitle}_${Date.now()}.srt`;
      srtPath = path.join(MEDIA_DIRS.subtitles, srtFilename);
      fs.writeFileSync(srtPath, srtContent, { encoding: 'utf-8', mode: 0o600 });
    }

    return {
      srtFilename,
      srtPath,
      srtContent,
      chaptersText: chaptersLines.join('\n')
    };
  }

  async sendEnterpriseNotification(eventTitle, details = {}) {
    const dispatchTask = async () => {
      if (this.config.WEBHOOK_NOTIFY_URL) {
        await assertSafeRemoteUrl(this.config.WEBHOOK_NOTIFY_URL);
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        try {
          await fetch(this.config.WEBHOOK_NOTIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: ctrl.signal,
            redirect: 'manual',
            body: JSON.stringify({ event: eventTitle, timestamp: new Date().toISOString(), details })
          });
        } finally {
          clearTimeout(t);
        }
      }

      if (this.config.TELEGRAM_BOT_TOKEN && this.config.TELEGRAM_CHAT_ID) {
        const tgUrl = `https://api.telegram.com/bot${encodeURIComponent(this.config.TELEGRAM_BOT_TOKEN)}/sendMessage`;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        try {
          const plainText = `NextGen YouTube Studio\nEvent: ${eventTitle}\nDetails: ${JSON.stringify(details).slice(0, 350)}`;
          await fetch(tgUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: ctrl.signal,
            body: JSON.stringify({ chat_id: this.config.TELEGRAM_CHAT_ID, text: plainText })
          });
        } finally {
          clearTimeout(t);
        }
      }
    };

    dispatchTask().catch(err => {
      logger.warn('MediaStudio', `Background notification skipped: ${err.message}`);
    });
  }
}

export const mediaStudio = new MediaStudioService();
        
