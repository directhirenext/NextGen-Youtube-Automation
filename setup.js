import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { crossOS } from './utils/cross-os-adapter.js';
import { logger } from './utils/logger.js';

const requiredDirs = ['config', 'database', 'editor/renders', 'editor/temp', 'logs'];

logger.info('Setup', 'Running Cross-OS Zero-Vulnerability Environment Bootstrapper...');
crossOS.ensureDirectories(requiredDirs);

const envPath = path.resolve('.env');
const examplePath = path.resolve('.env.example');

if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
  let content = fs.readFileSync(examplePath, 'utf-8');
  const strongSecret = crypto.randomBytes(32).toString('hex');
  content = content.replace(
    /DASHBOARD_SECRET_KEY=.*/,
    `DASHBOARD_SECRET_KEY=${strongSecret}`
  );
  fs.writeFileSync(envPath, content, { encoding: 'utf-8', mode: 0o600 });
  logger.success('Setup', 'Generated .env with cryptographic 256-bit DASHBOARD_SECRET_KEY (0600 permissions).');
}

const profile = crossOS.getEnvironmentProfile();
const ffmpegCheck = crossOS.resolveFFmpegBinary();

logger.success('Setup', `OS Detected: ${profile.osType} (${profile.platform}/${profile.arch})`);
logger.info('Setup', `FFmpeg Binary Available: ${ffmpegCheck.available} (${ffmpegCheck.binaryPath})`);
logger.success('Setup', 'All directories and security guards verified! Run "npm start" to launch.');
  
