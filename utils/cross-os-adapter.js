import os from 'os';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

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
      tempDir: os.tmpdir(),
      cpuCores: os.cpus()?.length || 1
    };
  }

  resolveFFmpegBinary(configuredPath = 'ffmpeg') {
    const candidates = [configuredPath];
    if (this.isTermux) {
      candidates.push('/data/data/com.termux/files/usr/bin/ffmpeg');
    } else if (this.isWindows) {
      candidates.push('ffmpeg.exe', 'C:\\ffmpeg\\bin\\ffmpeg.exe');
    } else {
      candidates.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg');
    }

    for (const bin of candidates) {
      try {
        execFileSync(bin, ['-version'], { stdio: 'ignore', timeout: 3000 });
        return { available: true, binaryPath: bin };
      } catch {
        // Check next candidate
      }
    }
    return { available: false, binaryPath: configuredPath };
  }

  resolveDynamicOAuthRedirectUri(port, configuredUri) {
    if (this.isCodespaces && process.env.CODESPACE_NAME) {
      const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
      return `https://${process.env.CODESPACE_NAME}-${port}.${domain}/oauth2callback`;
    }
    if (process.env.PUBLIC_HOST_URL) {
      return `${process.env.PUBLIC_HOST_URL.replace(/\/$/, '')}/oauth2callback`;
    }
    if (configuredUri && !configuredUri.includes('localhost:3000')) {
      return configuredUri;
    }
    return `http://localhost:${port}/oauth2callback`;
  }

  ensureDirectories(dirList = []) {
    for (const dir of dirList) {
      const resolved = path.resolve(dir);
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true, mode: 0o750 });
      }
    }
  }
}

export const crossOS = new CrossOSAdapter();
      
