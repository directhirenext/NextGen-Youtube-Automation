import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { sanitizeShellArg, escapeXml, validateSafeExternalUrl } from './config/security-validator.js';
import { crossOS } from './utils/cross-os-adapter.js';
import { LocalVaultDB } from './database/db.js';
import { mediaStudio } from './utils/media-studio-service.js';
import { codeVideoEditor } from './utils/ffmpeg.js';
import { logger } from './utils/logger.js';

test('1. Shell & XML Injection Sanitizers', () => {
  const dirtyShell = 'Hello; rm -rf / && echo `hacked`';
  const cleanShell = sanitizeShellArg(dirtyShell);
  assert(!/[;&|`$()]/.test(cleanShell));

  const dirtyXml = '<script>alert("xss")</script>';
  const cleanXml = escapeXml(dirtyXml);
  assert(cleanXml.includes('&lt;script&gt;'));
});

test('2. Zero-SSRF Network Guard', () => {
  assert.strictEqual(validateSafeExternalUrl('http://127.0.0.1:8080/admin'), false);
  assert.strictEqual(validateSafeExternalUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.strictEqual(validateSafeExternalUrl('https://openrouter.ai/api/v1/chat/completions'), true);
  assert.strictEqual(validateSafeExternalUrl('internal://editor/ffmpeg-engine'), true);
});

test('3. Cross-OS Profile Adapter', () => {
  const profile = crossOS.getEnvironmentProfile();
  assert(profile.osType && profile.platform);
});

test('4. Atomic UUID Database Vault', () => {
  const testDbDir = crossOS.resolveProjectPath('database', 'test_vault_run');
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }

  const testDb = new LocalVaultDB('database/test_vault_run');
  const job = testDb.addVideoJob({ title: 'Test Job', topicHint: 'Testing DB' });
  assert(job.id.startsWith('vid_'));
  assert.strictEqual(testDb.getVideoJobById(job.id).title, 'Test Job');

  fs.rmSync(testDbDir, { recursive: true, force: true });
});

test('5. Media Studio SRT & Chapters Generator', () => {
  const subData = mediaStudio.generateSrtAndChapters(
    [
      { durationSec: 12, captionText: 'Introduction to Career Updates', type: 'hook' },
      { durationSec: 15, captionText: 'Eligibility & Salary Packages', type: 'body' },
      { durationSec: 12, captionText: 'Direct Application Process', type: 'cta' }
    ],
    'Test_Video',
    { writeFile: false }
  );
  assert(subData.chaptersText.includes('00:00 - Introduction'));
  assert(subData.srtContent.includes('00:00:00,000 --> 00:00:12,000'));
});

test('6. Code-Driven Video Editor EDL Compiler & FFmpeg Filters', () => {
  const compiled = codeVideoEditor.validateAndCompileEDL({
    title: 'Enterprise Studio Test Video',
    aspectRatio: '16:9',
    fps: 30,
    manualStudio: {
      noiseCancellation: true,
      loudnessNormalization: true,
      visualFilter: 'cinematic',
      playbackSpeed: 1.0
    },
    scenes: [
      {
        sceneId: 's1',
        type: 'hook',
        durationSec: 12,
        captionText: 'Studio Filter & Audio Mastering Test',
        bgColor: '#0f172a',
        textColor: '#38bdf8',
        transition: 'fade'
      }
    ]
  }, { saveRecord: false, writeSrt: false });

  assert(compiled.ffmpegCommandPreview.includes('afftdn'), 'Noise cancellation missing');
  assert(compiled.ffmpegCommandPreview.includes('loudnorm'), 'Loudness normalization missing');
  assert(compiled.totalDurationSec === 12);
});
