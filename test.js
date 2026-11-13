import assert from 'assert';
import { sanitizeShellArg } from './config/security-validator.js';
import { mcpHub } from './mcp/mcp-hub.js';
import { codeVideoEditor } from './utils/ffmpeg.js';
import { productionManagementAgent } from './agents/production-management-agent.js';
import { logger } from './utils/logger.js';

async function runTests() {
  logger.info('TestSuite', 'Starting Zero-Bug Verification Suite...');

  // 1. Security Sanitizer Test
  const dirty = 'Hello; rm -rf / && echo `hacked`';
  const clean = sanitizeShellArg(dirty);
  assert(!clean.includes(';') && !clean.includes('`'), 'Shell sanitizer failed');
  logger.success('TestSuite', '1/4 Security Input Sanitizer passed.');

  // 2. MCP Browser Skill Registration Test
  const skills = mcpHub.connectSkillFromBrowser({
    id: 'mcp-test-editor',
    name: 'Test Browser Video Skill',
    type: 'video-editor',
    endpoint: 'internal://test/editor',
    capabilities: ['cut', 'captions']
  });
  assert(skills.some(s => s.id === 'mcp-test-editor'), 'MCP skill registration failed');
  mcpHub.disconnectSkill('mcp-test-editor');
  logger.success('TestSuite', '2/4 Browser MCP Hub connection test passed.');

  // 3. Claude-Style Code-Driven Video Editor (EDL) Compilation Test
  const compiled = codeVideoEditor.validateAndCompileEDL({
    title: 'Verification Test Video',
    aspectRatio: '16:9',
    fps: 30,
    scenes: [
      {
        sceneId: 's1',
        type: 'hook',
        durationSec: 4,
        captionText: 'Automated Verification Scene',
        bgColor: '#0f172a',
        textColor: '#38bdf8',
        transition: 'fade'
      }
    ]
  });
  assert(compiled.ffmpegArgs.includes('-filter_complex'), 'FFmpeg filter_complex missing');
  logger.success('TestSuite', '3/4 Claude-Style Code Video Editor EDL compiler passed.');

  // 4. End-to-End Multi-Agent Production Pipeline Test
  const job = await productionManagementAgent.runFullProductionPipeline({
    niche: 'Tech & Career Updates',
    topicHint: 'Automated Pipeline Test Run',
    aspectRatio: '16:9',
    generateShort: true
  });
  assert(job.status === 'ready_to_publish', 'Production pipeline did not complete');
  assert(job.shortVariant !== null, '9:16 Short repurposing failed');
  logger.success('TestSuite', '4/4 Multi-Agent Autonomous Pipeline passed.');

  console.log('\n🎉 ALL 4/4 ZERO-BUG VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test Suite Failed:', err);
  process.exit(1);
});
        
