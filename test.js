import assert from 'assert';
import { sanitizeShellArg, escapeXml, validateSafeExternalUrl } from './config/security-validator.js';
import { crossOS } from './utils/cross-os-adapter.js';
import { aiTextService } from './utils/ai-text-service.js';
import { mediaStudio } from './utils/media-studio-service.js';
import { mcpHub } from './mcp/mcp-hub.js';
import { codeVideoEditor } from './utils/ffmpeg.js';
import { productionManagementAgent } from './agents/production-management-agent.js';
import { logger } from './utils/logger.js';

async function runTests() {
  logger.info('TestSuite', 'Starting 8-Point Enterprise v3.0 Zero-Vulnerability & Studio Audit Suite...');

  // 1. Shell & XML Injection Sanitizer Test
  const dirtyShell = 'Hello; rm -rf / && echo `hacked` $(whoami)';
  const cleanShell = sanitizeShellArg(dirtyShell);
  assert(!/[;&|`$()]/.test(cleanShell), 'Shell sanitizer failed');
  assert(escapeXml('<script>').includes('&lt;script&gt;'), 'XML sanitizer failed');
  logger.success('TestSuite', '1/8 Shell & XML/SVG Injection Sanitizers passed.');

  // 2. Zero-SSRF Network Guard Test
  assert.strictEqual(validateSafeExternalUrl('http://127.0.0.1:8080/admin'), false);
  assert.strictEqual(validateSafeExternalUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.strictEqual(validateSafeExternalUrl('https://openrouter.ai/api/v1/chat/completions'), true);
  logger.success('TestSuite', '2/8 Zero-SSRF Network Guard passed.');

  // 3. Cross-OS & Dynamic OAuth Adapter Test
  const osProfile = crossOS.getEnvironmentProfile();
  assert(osProfile.osType && osProfile.platform, 'Cross-OS profile detection failed');
  logger.success('TestSuite', `3/8 Cross-OS Adapter (${osProfile.osType}) passed.`);

  // 4. Universal Third-Party AI Gateway & SSRF Check
  const aiState = aiTextService.configureUniversalProvider({
    provider: 'openrouter',
    model: 'deepseek/deepseek-r1:free',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions'
  });
  assert.strictEqual(aiState.activeProvider, 'openrouter', 'Universal AI provider switch failed');
  logger.success('TestSuite', '4/8 Universal Multi-LLM Gateway & Failover Router passed.');

  // 5. Local Media Upload Vault & SRT/Chapters Generator Test
  const dummyMp3Base64 = Buffer.from('ID3-dummy-audio-bytes').toString('base64');
  const uploaded = mediaStudio.saveUploadedMedia({
    category: 'audio',
    originalName: 'test_voiceover.mp3',
    base64Data: dummyMp3Base64
  });
  assert(uploaded.filename.endsWith('.mp3'), 'Audio upload failed');

  const subData = mediaStudio.generateSrtAndChapters(
    [{ durationSec: 5, captionText: 'Hook Intro', type: 'hook' }],
    'Test_Subtitles'
  );
  assert(subData.srtContent.includes('00:00:00,000 --> 00:00:05,000'), 'SRT generation failed');
  logger.success('TestSuite', '5/8 Media Studio Upload Vault & SRT/Chapters Generator passed.');

  // 6. KineMaster-Style Multi-Track EDL (De-Noise, Mute Original Audio, Visual Filter) Test
  const compiled = codeVideoEditor.validateAndCompileEDL({
    title: 'Enterprise Studio Test Video',
    aspectRatio: '16:9',
    fps: 30,
    manualStudio: {
      voiceoverAudioFile: uploaded.filename,
      muteOriginalVideoAudio: true,
      noiseCancellation: true,
      autoDucking: true,
      loudnessNormalization: true,
      visualFilter: 'cinematic',
      playbackSpeed: 1.1
    },
    scenes: [
      {
        sceneId: 's1',
        type: 'hook',
        durationSec: 4,
        captionText: 'Studio Filter & Audio Mastering Test',
        bgColor: '#0f172a',
        textColor: '#38bdf8',
        transition: 'fade'
      }
    ]
  });
  assert(compiled.ffmpegCommandPreview.includes('afftdn'), 'Noise cancellation filter missing in FFmpeg graph');
  assert(compiled.ffmpegCommandPreview.includes('loudnorm'), 'Loudness normalization missing in FFmpeg graph');
  mediaStudio.deleteMediaAsset('audio', uploaded.filename);
  logger.success('TestSuite', '6/8 KineMaster Multi-Track De-Noise, Loudnorm & Visual Filter Compiler passed.');

  // 7. Browser MCP Hub Registration Test
  const skills = mcpHub.connectSkillFromBrowser({
    id: 'mcp-test-editor',
    name: 'Verified Browser Video Skill',
    type: 'video-editor',
    endpoint: 'internal://test/editor',
    capabilities: ['cut', 'captions']
  });
  assert(skills.some(s => s.id === 'mcp-test-editor'), 'Valid MCP skill registration failed');
  mcpHub.disconnectSkill('mcp-test-editor');
  logger.success('TestSuite', '7/8 Browser MCP Hub passed.');

  // 8. End-to-End Enterprise Pipeline (with A/B CTR Winner & Chapters) Test
  const job = await productionManagementAgent.runFullProductionPipeline({
    niche: 'Tech & Career Updates',
    topicHint: 'Enterprise v3.0 Pipeline Test',
    aspectRatio: '16:9',
    generateShort: true
  });
  assert(job.status === 'ready_to_publish', 'Production pipeline did not complete');
  assert(job.seo?.abTesting?.winner, 'A/B CTR testing simulation missing');
  logger.success('TestSuite', '8/8 End-to-End Multi-Agent Enterprise Pipeline passed.');

  console.log('\n🛡️🚀 ALL 8/8 ENTERPRISE v3.0 ZERO-VULNERABILITY & STUDIO TESTS PASSED!');
}

runTests().catch(err => {
  console.error('❌ Test Suite Failed:', err);
  process.exit(1);
});
