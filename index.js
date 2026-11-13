import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadValidatedConfig } from './config/security-validator.js';
import { logger } from './utils/logger.js';
import { db } from './database/db.js';
import { credentialManager } from './utils/credential-manager.js';
import { mcpHub } from './mcp/mcp-hub.js';
import { codeVideoEditor } from './utils/ffmpeg.js';
import { productionManagementAgent } from './agents/production-management-agent.js';
import { publishingSchedulingAgent } from './agents/publishing-scheduling-agent.js';
import { analyticsOptimizationAgent } from './agents/analytics-optimization-agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = loadValidatedConfig();
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

app.use(express.static(path.join(__dirname, 'dashboard')));

app.get('/api/state', (req, res) => {
  res.json({
    state: db.getState(),
    auth: credentialManager.getAuthStatus(),
    recentLogs: logger.getRecentLogs(30)
  });
});

app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const onLog = (entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  };

  logger.on('log', onLog);
  req.on('close', () => {
    logger.off('log', onLog);
  });
});

app.post('/api/production/run', async (req, res) => {
  try {
    const { niche, topicHint, aspectRatio, generateShort } = req.body;
    const job = await productionManagementAgent.runFullProductionPipeline({
      niche,
      topicHint,
      aspectRatio,
      generateShort
    });
    res.json({ success: true, job });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/editor/compile', async (req, res) => {
  try {
    const compiled = codeVideoEditor.validateAndCompileEDL(req.body);
    const renderResult = await codeVideoEditor.executeRender(compiled);
    res.json({ success: true, compiled, renderResult });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/mcp/skills', (req, res) => {
  res.json({ skills: mcpHub.listSkills() });
});

app.post('/api/mcp/skills', (req, res) => {
  try {
    const skills = mcpHub.connectSkillFromBrowser(req.body);
    res.json({ success: true, skills });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/mcp/skills/:id', (req, res) => {
  const skills = mcpHub.disconnectSkill(req.params.id);
  res.json({ success: true, skills });
});

app.post('/api/publish/:jobId', async (req, res) => {
  try {
    const updated = await publishingSchedulingAgent.publishOrSchedule(req.params.jobId, req.body.publishAt);
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/analytics', async (req, res) => {
  const insights = await analyticsOptimizationAgent.analyzeChannelPerformance();
  res.json({ success: true, insights });
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) throw new Error('Missing OAuth code');
    await credentialManager.saveOAuthCode(code);
    res.redirect('/?oauth=success');
  } catch (err) {
    res.status(400).send(`OAuth Error: ${err.message}`);
  }
});

app.listen(config.PORT, () => {
  logger.success('Server', `NextGen YouTube Automation v2.0 running at http://localhost:${config.PORT}`);
});
