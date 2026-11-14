import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

import { crossOS } from './utils/cross-os-adapter.js';
import { loadValidatedConfig } from './config/security-validator.js';
import { logger } from './utils/logger.js';
import { db } from './database/db.js';
import { credentialManager } from './utils/credential-manager.js';
import { aiTextService } from './utils/ai-text-service.js';
import { mediaStudio } from './utils/media-studio-service.js';
import { mcpHub } from './mcp/mcp-hub.js';
import { codeVideoEditor } from './utils/ffmpeg.js';
import { productionManagementAgent } from './agents/production-management-agent.js';
import { publishingSchedulingAgent } from './agents/publishing-scheduling-agent.js';
import { analyticsOptimizationAgent } from './agents/analytics-optimization-agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

crossOS.ensureDirectories([
  'config',
  'database',
  'editor/renders',
  'editor/renders/subtitles',
  'editor/uploads/videos',
  'editor/uploads/audio',
  'editor/uploads/overlays',
  'editor/temp',
  'logs'
]);

const config = loadValidatedConfig();
const app = express();

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        mediaSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"]
      }
    }
  })
);
app.use(cors({ origin: true, methods: ['GET', 'POST', 'DELETE'] }));
app.use(express.json({ limit: '200mb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

app.use(express.static(path.join(__dirname, 'dashboard')));
app.use('/renders', express.static(path.join(__dirname, 'editor/renders')));

app.get('/api/state', (req, res) => {
  res.json({
    state: db.getState(),
    auth: {
      ...credentialManager.getAuthStatus(),
      dynamicRedirectUri: credentialManager.getDynamicRedirectUri(req)
    },
    aiGateway: aiTextService.getTelemetryAndConfig(),
    mediaAssets: mediaStudio.listUploadedMedia(),
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

// Universal Third-Party AI Runtime Configuration
app.post('/api/ai/config', (req, res) => {
  try {
    const status = aiTextService.configureUniversalProvider(req.body || {});
    res.json({ success: true, aiGateway: status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Local Media Studio Upload & Asset Management
app.get('/api/media/list', (req, res) => {
  res.json({ success: true, mediaAssets: mediaStudio.listUploadedMedia() });
});

app.post('/api/media/upload', (req, res) => {
  try {
    const saved = mediaStudio.saveUploadedMedia(req.body || {});
    res.json({
      success: true,
      asset: saved,
      mediaAssets: mediaStudio.listUploadedMedia()
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/media/:category/:filename', (req, res) => {
  try {
    const deleted = mediaStudio.deleteMediaAsset(req.params.category, req.params.filename);
    res.json({
      success: deleted,
      mediaAssets: mediaStudio.listUploadedMedia()
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/production/run', async (req, res) => {
  try {
    const { niche, topicHint, aspectRatio, generateShort } = req.body || {};
    const job = await productionManagementAgent.runFullProductionPipeline({
      niche: String(niche || 'Pan-India Jobs').slice(0, 120),
      topicHint: String(topicHint || '').slice(0, 150),
      aspectRatio: aspectRatio === '9:16' ? '9:16' : '16:9',
      generateShort: Boolean(generateShort)
    });
    await mediaStudio.sendEnterpriseNotification('Autonomous Video Produced', {
      jobId: job.id,
      title: job.title
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
    const updated = await publishingSchedulingAgent.publishOrSchedule(req.params.jobId, req.body?.publishAt);
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/analytics', async (req, res) => {
  const insights = await analyticsOptimizationAgent.analyzeChannelPerformance();
  res.json({ success: true, insights });
});

app.get('/api/oauth/url', (req, res) => {
  try {
    const url = credentialManager.generateYouTubeAuthUrl(req);
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    if (!code) throw new Error('Missing OAuth code');
    await credentialManager.saveOAuthCode(code);
    res.redirect('/?oauth=success');
  } catch (err) {
    res.status(400).send(`OAuth Error: ${err.message}`);
  }
});

app.listen(config.PORT, () => {
  const osProfile = crossOS.getEnvironmentProfile();
  logger.success('Server', `NextGen YouTube Automation v3.0 Enterprise [${osProfile.osType}] running at http://localhost:${config.PORT}`);
});
         
