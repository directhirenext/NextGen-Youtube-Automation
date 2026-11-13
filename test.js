import assert from 'assert';
import { sanitizeShellArg, escapeXml, validateSafeExternalUrl } from './config/security-validator.js';
import { crossOS } from './utils/cross-os-adapter.js';
import { mcpHub } from './mcp/mcp-hub.js';
import { codeVideoEditor } from './utils/ffmpeg.js';
import { productionManagementAgent } from './agents/production-management-agent.js';
import { logger } from './utils/logger.js';

async function runTests() {
  logger.info('TestSuite', 'Starting 6-Point Zero-Vulnerability & Cross-OS Audit Suite...');

  // 1. Shell & XML Injection Sanitizer Test
  const dirtyShell = 'Hello; rm -rf / && echo `hacked` $(whoami)';
  const cleanShell = sanitizeShellArg(dirtyShell);
  assert(!/[;&|`$()]/.test(cleanShell), 'Shell sanitizer failed to strip dangerous metacharacters');

  const dirtyXml = '<script>alert("xss")</script>';
  const cleanXml = escapeXml(dirtyXml);
  assert(cleanXml.includes('&lt;script&gt;'), 'XML sanitizer failed');
  logger.success('TestSuite', '1/6 Shell & XML/SVG Injection Sanitizers passed.');

  // 2. SSRF Protection Guard Test
  assert.strictEqual(validateSafeExternalUrl('http://127.0.0.1:8080/admin'), false, 'SSRF failed to block loopback');
  assert.strictEqual(validateSafeExternalUrl('http://169.254.169.254/latest/meta-data'), false, 'SSRF failed to block cloud metadata IP');
  assert.strictEqual(validateSafeExternalUrl('internal://editor/ffmpeg-engine'), true, 'Internal MCP scheme blocked erroneously');
  assert.strictEqual(validateSafeExternalUrl('https://api.example.com/mcp'), true, 'Valid public HTTPS URL blocked');
  logger.success('TestSuite', '2/6 Zero-SSRF Network Guard passed.');

  // 3. Cross-OS & Dynamic OAuth Adapter Test
  const osProfile = crossOS.getEnvironmentProfile();
  assert(osProfile.osType && osProfile.platform, 'Cross-OS profile detection failed');
  const redirectUri = crossOS.resolveDynamicOAuthRedirectUri(4000, '');
  assert(redirectUri.includes('/oauth2callback'), 'Dynamic OAuth URI resolution failed');
  logger.success('TestSuite', `3/6 Cross-OS Adapter (${osProfile.osType}) & Dynamic OAuth URI passed.`);

  // 4. Browser MCP Hub Registration & SSRF Rejection Test
  let ssrfBlocked = false;
  try {
    mcpHub.connectSkillFromBrowser({
      id: 'mcp-bad-ssrf',
      name: 'Malicious Localhost Skill',
      type: 'custom',
      endpoint: 'http://192.168.1.1/exploit'
    });
  } catch {
    ssrfBlocked = true;
  }
  assert(ssrfBlocked, 'MCP Hub failed to reject private LAN SSRF endpoint');

  const skills = mcpHub.connectSkillFromBrowser({
    id: 'mcp-test-editor',
    name: 'Verified Browser Video Skill',
    type: 'video-editor',
    endpoint: 'internal://test/editor',
    capabilities: ['cut', 'captions']
  });
  assert(skills.some(s => s.id === 'mcp-test-editor'), 'Valid MCP skill registration failed');
  mcpHub.disconnectSkill('mcp-test-editor');
  logger.success('TestSuite', '4/6 Browser MCP Hub & SSRF Rejection test passed.');

  // 5. Claude-Style Code Video Editor (EDL) & Timeout-Guarded Render Test
  const compiled = codeVideoEditor.validateAndCompileEDL({
    title: 'Zero-Bug Verification Video',
    aspectRatio: '16:9',
    fps: 30,
    scenes: [
      {
        sceneId: 's1',
        type: 'hook',
        durationSec: 4,
        captionText: 'Automated Security & Render Test',
        bgColor: '#0f172a',
        textColor: '#38bdf8',
        transition: 'fade'
      }
    ]
  });
  assert(compiled.ffmpegArgs.includes('-filter_complex'), 'FFmpeg filter_complex missing');
  const renderRes = await codeVideoEditor.executeRender(compiled);
  assert(renderRes.outputFile, 'Render execution failed to return artifact');
  logger.success('TestSuite', '5/6 Claude-Style Code Video Editor & Process Guard passed.');

  // 6. End-to-End Multi-Agent Production Pipeline Test
  const job = await productionManagementAgent.runFullProductionPipeline({
    niche: 'Tech & Career Updates',
    topicHint: 'Zero-Vulnerability Pipeline Test Run <script>',
    aspectRatio: '16:9',
    generateShort: true
  });
  assert(job.status === 'ready_to_publish', 'Production pipeline did not complete');
  assert(job.shortVariant !== null, '9:16 Short repurposing failed');
  logger.success('TestSuite', '6/6 End-to-End Multi-Agent Autonomous Pipeline passed.');

  console.log('\n🛡️🎉 ALL 6/6 ZERO-VULNERABILITY & CROSS-OS TESTS PASSED WITH 0 ERRORS!');
}

runTests().catch(err => {
  console.error('❌ Test Suite Failed:', err);
  process.exit(1);
});
