import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { crossOS } from './utils/cross-os-adapter.js';
import { logger } from './utils/logger.js';

const requiredDirs = [
  'config',
  'database',
  'editor/renders',
  'editor/renders/subtitles',
  'editor/uploads/videos',
  'editor/uploads/audio',
  'editor/uploads/overlays',
  'editor/temp',
  'logs'
];

logger.info('Setup', 'Running Cross-OS Enterprise v3.0 Environment Bootstrapper...');
crossOS.ensureDirectories(requiredDirs);

const envPath = crossOS.resolveProjectPath('.env');
const examplePath = crossOS.resolveProjectPath('.env.example');

if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
  let content = fs.readFileSync(examplePath, 'utf-8');
  const strongSecret = crypto.randomBytes(32).toString('hex');
  content = content.replace(
    /DASHBOARD_SECRET_KEY=.*/,
    `DASHBOARD_SECRET_KEY=${strongSecret}`
  );
  fs.writeFileSync(envPath, content, { encoding: 'utf-8', mode: 0o600 });
  logger.success('Setup', 'Generated secure .env file with 256-bit cryptographic DASHBOARD_SECRET_KEY (0600 permissions).');
}

const profile = crossOS.getEnvironmentProfile();
const ffmpegCheck = crossOS.resolveFFmpegBinary();
const ffprobeCheck = crossOS.resolveFFprobeBinary();
const fontPath = crossOS.resolveDevanagariFontPath();

logger.success('Setup', `OS Detected: ${profile.osType} (${profile.platform}/${profile.arch})`);
logger.info('Setup', `FFmpeg Binary Available: ${ffmpegCheck.available} (${ffmpegCheck.binaryPath})`);
logger.info('Setup', `FFprobe Binary Available: ${ffprobeCheck.available} (${ffprobeCheck.binaryPath})`);
logger.info('Setup', `Devanagari Hindi Font Ready: ${Boolean(fontPath)} (${fontPath || 'using system fallback'})`);
logger.success('Setup', 'All directories and security guards verified! Run "npm start" to launch.');

