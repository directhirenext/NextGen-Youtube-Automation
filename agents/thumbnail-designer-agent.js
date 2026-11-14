import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { escapeXml, loadValidatedConfig, wrapCaptionLines } from '../config/security-validator.js';
import { crossOS } from '../utils/cross-os-adapter.js';
import { logger } from '../utils/logger.js';

export class ThumbnailDesignerAgent {
  constructor() {
    this.config = loadValidatedConfig();
    this.rendersDir = crossOS.resolveProjectPath('editor', 'renders');
    this.tempDir = crossOS.resolveProjectPath('editor', 'temp');
    crossOS.ensureDirectories([this.rendersDir, this.tempDir]);
  }

  _truncateAtWordBoundary(text = '', maxChars = 42) {
    const clean = (text.toWellFormed ? text.toWellFormed() : String(text)).replace(/\s+/g, ' ').trim();
    const chars = Array.from(clean);
    if (chars.length <= maxChars) return clean;
    const sliced = chars.slice(0, maxChars).join('');
    const lastSpace = sliced.lastIndexOf(' ');
    return (lastSpace > 15 ? sliced.slice(0, lastSpace) : sliced) + '…';
  }

  _escapeFilterPath(filePath) {
    return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  }

  async designThumbnail(title, hookText = 'IMPORTANT UPDATE', subtitleText = 'STEP-BY-STEP GUIDE') {
    crossOS.ensureDirectories([this.rendersDir, this.tempDir]);
    logger.info('ThumbnailDesignerAgent', `Designing 1280x720 SVG & PNG thumbnail for: "${title}"`);

    const rawBadge = this._truncateAtWordBoundary(hookText.toUpperCase(), 22);
    const rawHeadline = this._truncateAtWordBoundary(title, 44);
    const rawSub = this._truncateAtWordBoundary(subtitleText.toUpperCase(), 38);

    const xmlBadge = escapeXml(rawBadge);
    const xmlHeadline = escapeXml(rawHeadline);
    const xmlSub = escapeXml(rawSub);

    const svgOverlay = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#090d16"/>
          <stop offset="55%" stop-color="#1e1b4b"/>
          <stop offset="100%" stop-color="#0f172a"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#bg)"/>
      <rect x="40" y="40" width="1200" height="640" rx="24" fill="none" stroke="#38bdf8" stroke-width="4" stroke-opacity="0.35"/>
      <rect x="70" y="70" width="540" height="86" rx="14" fill="#ef4444"/>
      <text x="100" y="126" fill="#ffffff" font-family="Noto Sans Devanagari, sans-serif" font-size="38" font-weight="bold">${xmlBadge}</text>
      <text x="70" y="340" fill="#facc15" font-family="Noto Sans Devanagari, sans-serif" font-size="54" font-weight="bold">${xmlHeadline}</text>
      <rect x="70" y="540" width="760" height="74" rx="12" fill="#0284c7"/>
      <text x="100" y="588" fill="#ffffff" font-family="Noto Sans Devanagari, sans-serif" font-size="34" font-weight="bold">${xmlSub}</text>
    </svg>`;

    const token = `${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const svgFilename = `thumb_${token}.svg`;
    const pngFilename = `thumb_${token}.png`;
    const svgPath = path.join(this.rendersDir, svgFilename);
    const pngPath = path.join(this.rendersDir, pngFilename);

    fs.writeFileSync(svgPath, svgOverlay, { encoding: 'utf-8', mode: 0o600 });

    // Also render real 1280x720 PNG via FFmpeg so YouTube thumbnails.set API can upload it (Fixes B24, B29)
    let pngGenerated = false;
    const ffmpegBin = crossOS.resolveFFmpegBinary(this.config.FFMPEG_PATH);
    const fontPath = crossOS.resolveDevanagariFontPath(this.config.FONT_FILE_PATH);

    if (ffmpegBin.available) {
      const txtFile = path.join(this.tempDir, `thumb_txt_${token}.txt`);
      try {
        const wrappedTitle = wrapCaptionLines(`${rawBadge}\n\n${rawHeadline}\n\n${rawSub}`, 30);
        fs.writeFileSync(txtFile, wrappedTitle, { encoding: 'utf-8', mode: 0o600 });
        const escapedTxt = this._escapeFilterPath(txtFile);
        const fontOpt = fontPath ? `:fontfile='${this._escapeFilterPath(fontPath)}'` : '';

        execFileSync(ffmpegBin.binaryPath, [
          '-y',
          '-f', 'lavfi',
          '-i', 'color=c=0x111827:s=1280x720:d=1',
          '-vf', `drawbox=x=40:y=40:w=1200:h=640:color=0x38bdf8@0.6:t=6,drawtext=textfile='${escapedTxt}'${fontOpt}:fontcolor=0xfacc15:fontsize=52:line_spacing=18:box=1:boxcolor=0x00000099:boxborderw=24:x=(w-text_w)/2:y=(h-text_h)/2`,
          '-frames:v', '1',
          pngPath
        ], { stdio: 'ignore', timeout: 10000 });

        pngGenerated = fs.existsSync(pngPath) && fs.statSync(pngPath).size > 256;
      } catch {
        pngGenerated = false;
      } finally {
        try { if (fs.existsSync(txtFile)) fs.unlinkSync(txtFile); } catch {}
      }
    }

    const result = {
      resolution: '1280x720',
      rawBadgeText: rawBadge,
      rawHeadline,
      rawSub,
      svgFile: svgFilename,
      pngFile: pngGenerated ? pngFilename : null,
      pngPath: pngGenerated ? pngPath : null,
      svgDataUri: `data:image/svg+xml;base64,${Buffer.from(svgOverlay).toString('base64')}`
    };

    logger.success('ThumbnailDesignerAgent', `Thumbnail generated (SVG: ${svgFilename}, PNG: ${pngGenerated ? pngFilename : 'SVG-only'})`);
    return result;
  }
}

export const thumbnailDesignerAgent = new ThumbnailDesignerAgent();
