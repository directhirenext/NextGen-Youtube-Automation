import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');

export class CrossOSAdapter {
  constructor() {
    this.platform = os.platform();
    this.arch = os.arch();
    this.isTermux = Boolean(
      process.env.TERMUX_VERSION ||
      (process.env.PREFIX && process.env.PREFIX.includes('com.termux'))
    );
    this.isCodespaces = Boolean(process.env.CODESPACES === 'true' || process.env.CODESPACE_NAME);
    this.isWindows = this.platform === 'win32';
  }

  resolveProjectPath(...segments) {
    return path.join(PROJECT_ROOT, ...segments);
  }

  getEnvironmentProfile() {
    let osType = 'Linux/Unix';
    if (this.isTermux) osType = 'Android-Termux';
    else if (this.isCodespaces) osType = 'GitHub-Codespaces';
    else if (this.isWindows) osType = 'Windows';
    else if (this.platform === 'darwin') osType = 'macOS';

    return {
      osType,
      platform: this.platform,
      arch: this.arch,
      isTermux: this.isTermux,
      isCodespaces: this.isCodespaces,
      projectRoot: PROJECT_ROOT,
      tempDir: os.tmpdir(),
      cpuCores: os.cpus()?.length || 1
    };
  }

  resolveBinary(configuredPath, defaultName) {
    const candidates = [];
    if (configuredPath) candidates.push(configuredPath);
    candidates.push(defaultName);

    if (this.isTermux) {
      candidates.push(`/data/data/com.termux/files/usr/bin/${defaultName}`);
    } else if (this.isWindows) {
      candidates.push(`${defaultName}.exe`, `C:\\ffmpeg\\bin\\${defaultName}.exe`);
    } else {
      candidates.push(
        `/usr/bin/${defaultName}`,
        `/usr/local/bin/${defaultName}`,
        `/opt/homebrew/bin/${defaultName}`
      );
    }

    for (const bin of candidates) {
      try {
        execFileSync(bin, ['-version'], { stdio: 'ignore', timeout: 4000 });
        return { available: true, binaryPath: bin };
      } catch {
        // try next
      }
    }
    return { available: false, binaryPath: configuredPath || defaultName };
  }

  resolveFFmpegBinary(configuredPath = 'ffmpeg') {
    return this.resolveBinary(configuredPath, 'ffmpeg');
  }

  resolveFFprobeBinary(configuredPath = 'ffprobe') {
    return this.resolveBinary(configuredPath, 'ffprobe');
  }

  resolveDevanagariFontPath(configuredFontPath = '') {
    const candidates = [
      configuredFontPath,
      this.resolveProjectPath('config', 'fonts', 'NotoSansDevanagari-Bold.ttf'),
      this.resolveProjectPath('config', 'fonts', 'NotoSansDevanagari-Regular.ttf'),
      '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf',
      '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf',
      '/usr/share/fonts/noto/NotoSansDevanagari-Regular.ttf',
      '/data/data/com.termux/files/usr/share/fonts/TTF/NotoSansDevanagari-Regular.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      'C:\\Windows\\Fonts\\Nirmala.ttf',
      'C:\\Windows\\Fonts\\mangal.ttf',
      '/System/Library/Fonts/Supplemental/ITFDevanagari.ttc'
    ].filter(Boolean);

    for (const fontPath of candidates) {
      if (fs.existsSync(fontPath)) {
        return fontPath;
      }
    }
    return null;
  }

  resolveDynamicOAuthRedirectUri(port, configuredUri) {
    if (configuredUri && configuredUri.trim() !== '' && !configuredUri.includes('127.0.0.1:3000') && !configuredUri.includes('localhost:3000')) {
      return configuredUri.trim();
    }
    if (process.env.PUBLIC_HOST_URL) {
      return `${process.env.PUBLIC_HOST_URL.replace(/\/$/, '')}/oauth2callback`;
    }
    if (this.isCodespaces && process.env.CODESPACE_NAME) {
      const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
      return `https://${process.env.CODESPACE_NAME}-${port}.${domain}/oauth2callback`;
    }
    return `http://127.0.0.1:${port}/oauth2callback`;
  }

  ensureDirectories(dirList = []) {
    for (const dir of dirList) {
      const resolved = path.isAbsolute(dir) ? dir : this.resolveProjectPath(dir);
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true, mode: 0o750 });
      }
    }
  }
}

export const crossOS = new CrossOSAdapter();
