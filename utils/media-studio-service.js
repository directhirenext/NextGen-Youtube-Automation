import fs from 'fs';
import path from 'path';
import { loadValidatedConfig, sanitizeSafeFilename, validateSafeExternalUrl } from '../config/security-validator.js';
import { crossOS } from './cross-os-adapter.js';
import { logger } from './logger.js';

const MEDIA_DIRS = {
  video: path.resolve('editor/uploads/videos'),
  audio: path.resolve('editor/uploads/audio'),
  overlay: path.resolve('editor/uploads/overlays'),
  subtitles: path.resolve('editor/renders/subtitles')
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

  saveUploadedMedia({ category = 'video', originalName, base64Data }) {
    if (!MEDIA_DIRS[category]) {
      throw new Error(`Invalid media category: ${category}`);
    }
    if (!base64Data || typeof base64Data !== 'string') {
      throw new Error('Missing base64 media payload.');
    }

    const safeName = sanitizeSafeFilename(originalName || `${category}_${Date.now()}.mp4`);
    const ext = path.extname(safeName).toLowerCase();

    if (!ALLOWED_EXTENSIONS[category].has(ext)) {
      throw new Error(`Unsupported ${category} file format "${ext}". Allowed: ${Array.from(ALLOWED_EXTENSIONS[category]).join(', ')}`);
    }

    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(cleanBase64, 'base64');

    const maxBytes = (this.config.MAX_UPLOAD_SIZE_MB || 150) * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new Error(`File exceeds maximum upload limit of ${this.config.MAX_UPLOAD_SIZE_MB}MB.`);
    }

    const finalFilename = `${Date.now()}_${safeName}`;
    const fullPath = path.join(MEDIA_DIRS[category], finalFilename);
    fs.writeFileSync(fullPath, buffer, { mode: 0o600 });

    logger.success('MediaStudio', `Uploaded ${category} asset: ${finalFilename} (${(buffer.length / 1024).toFixed(1)} KB)`);
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
    const result = { videos: [], audio: [], overlays: [], subtitles: [] };

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

    result.videos = readDirSafe(MEDIA_DIRS.video, 'video');
    result.audio = readDirSafe(MEDIA_DIRS.audio, 'audio');
    result.overlays = readDirSafe(MEDIA_DIRS.overlay, 'overlay');
    result.subtitles = readDirSafe(MEDIA_DIRS.subtitles, 'subtitles');
    return result;
  }

  resolveMediaFilePath(category, filename) {
    if (!filename) return null;
    const safeFile = path.basename(filename);
    const targetDir = MEDIA_DIRS[category];
    if (!targetDir) return null;
    const fullPath = path.join(targetDir, safeFile);
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

  generateSrtAndChapters(scenes = [], projectTitle = 'video') {
    crossOS.ensureDirectories([MEDIA_DIRS.subtitles]);
    let currentSec = 0;
    const srtBlocks = [];
    const chapters = [];

    const formatSrtTime = (sec) => {
      const hrs = String(Math.floor(sec / 3600)).padStart(2, '0');
      const mins = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
      const secs = String(Math.floor(sec % 60)).padStart(2, '0');
      return `${hrs}:${mins}:${secs},000`;
    };

    const formatChapterTime = (sec) => {
      const mins = String(Math.floor(sec / 60)).padStart(2, '0');
      const secs = String(Math.floor(sec % 60)).padStart(2, '0');
      return `${mins}:${secs}`;
    };

    scenes.forEach((scene, index) => {
      const start = currentSec;
      const duration = Number(scene.durationSec || 5);
      const end = start + duration;

      srtBlocks.push(
        `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${scene.captionText || scene.type.toUpperCase()}\n`
      );

      chapters.push(`${formatChapterTime(start)} - ${scene.captionText ? scene.captionText.slice(0, 48) : scene.type.toUpperCase()}`);
      currentSec = end;
    });

    const srtContent = srtBlocks.join('\n');
    const safeTitle = sanitizeSafeFilename(projectTitle).replace(/\.[^.]+$/, '');
    const srtFilename = `${safeTitle}_${Date.now()}.srt`;
    const srtPath = path.join(MEDIA_DIRS.subtitles, srtFilename);

    fs.writeFileSync(srtPath, srtContent, { encoding: 'utf-8', mode: 0o600 });
    return {
      srtFilename,
      srtPath,
      srtContent,
      chaptersText: chapters.join('\n')
    };
  }

  async sendEnterpriseNotification(eventTitle, details = {}) {
    try {
      if (this.config.WEBHOOK_NOTIFY_URL && validateSafeExternalUrl(this.config.WEBHOOK_NOTIFY_URL)) {
        await fetch(this.config.WEBHOOK_NOTIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: eventTitle, timestamp: new Date().toISOString(), details })
        });
      }

      if (this.config.TELEGRAM_BOT_TOKEN && this.config.TELEGRAM_CHAT_ID) {
        const tgUrl = `https://api.telegram.org/bot${encodeURIComponent(this.config.TELEGRAM_BOT_TOKEN)}/sendMessage`;
        const text = `🚀 *NextGen YouTube Studio*\n*Event:* ${eventTitle}\n*Details:* ${JSON.stringify(details).slice(0, 300)}`;
        await fetch(tgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: this.config.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' })
        });
      }
    } catch (err) {
      logger.warn('MediaStudio', `Notification dispatch skipped: ${err.message}`);
    }
  }
}

export const mediaStudio = new MediaStudioService();
      
