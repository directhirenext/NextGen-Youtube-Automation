import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

import { crossOS } from './utils/cross-os-adapter.js';
import { loadValidatedConfig, requireAuth } from './config/security-validator.js';
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
import { startDailyAutomation, stopDailyAutomation } from './schedules/daily-automation.js';

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
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        mediaSrc: ["'self'", 'data:', 'blob:', 'http:', 'https:'],
        connectSrc: ["'self'"]
      }
    }
  })
);

// Strict Same-Origin CORS (Fixes S2)
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('http://127.0.0.1:') || origin.startsWith('http://localhost:') || origin.startsWith('https://')) {
      return callback(null, true);
    }
    return callback(new Error('Blocked by Strict CORS policy.'));
  },
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-dashboard-key']
}));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

// Body parsers placed AFTER rate limiter (Fixes S6)
app.use(express.json({ limit: '150mb' }));
app.use(express.urlencoded({ limit: '150mb', extended: true }));

app.use(express.static(path.join(__dirname, 'dashboard')));
app.use('/renders', express.static(crossOS.resolveProjectPath('editor', 'renders')));
app.use('/uploads', express.static(crossOS.resolveProjectPath('editor', 'uploads')));

// Public read state route
app.get('/api/state', (req, res) => {
  res.json({
    state: db.getState(),
    auth: {
      ...credentialManager.getAuthStatus(),
      dynamicRedirectUri: credentialManager.getDynamicRedirectUri()
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

// Protected API Routes (Requires DASHBOARD_SECRET_KEY via Bearer token or x-dashboard-key header - Fixes S1)
app.post('/api/ai/config', requireAuth, (req, res) => {
  try {
    const status = aiTextService.configureUniversalProvider(req.body || {});
    res.json({ success: true, aiGateway: status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/media/list', requireAuth, (req, res) => {
  res.json({ success: true, mediaAssets: mediaStudio.listUploadedMedia() });
});

app.post('/api/media/upload', requireAuth, async (req, res) => {
  try {
    const saved = await mediaStudio.saveUploadedMedia(req.body || {});
    res.json({
      success: true,
      asset: saved,
      mediaAssets: mediaStudio.listUploadedMedia()
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/media/:category/:filename', requireAuth, (req, res) => {
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

app.post('/api/production/run', requireAuth, async (req, res) => {
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

// Interactive AI Revision / Re-render Endpoint (Fixes User Feedback & Regeneration requirement)
app.post('/api/production/revise', requireAuth, async (req, res) => {
  try {
    const { jobId, feedbackPrompt, regenerateTarget, manualTitle, manualDescription, manualNarration, manualBadgeText, manualScenes, manualStudioOverrides } = req.body || {};
    if (!jobId) throw new Error('Missing jobId for revision.');

    const revisedJob = await productionManagementAgent.reviseAndReRenderJob(jobId, {
      feedbackPrompt,
      regenerateTarget,
      manualTitle,
      manualDescription,
      manualNarration,
      manualBadgeText,
      manualScenes,
      manualStudioOverrides
    });
    res.json({ success: true, job: revisedJob });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/editor/compile', requireAuth, async (req, res) => {
  try {
    const compiled = codeVideoEditor.validateAndCompileEDL(req.body);
    const renderResult = await codeVideoEditor.executeRender(compiled);
    res.json({ success: true, compiled, renderResult });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/mcp/skills', requireAuth, (req, res) => {
  res.json({ skills: mcpHub.listSkills() });
});

app.post('/api/mcp/skills', requireAuth, (req, res) => {
  try {
    const skills = mcpHub.connectSkillFromBrowser(req.body);
    res.json({ success: true, skills });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/mcp/skills/:id', requireAuth, (req, res) => {
  try {
    const skills = mcpHub.disconnectSkill(req.params.id);
    res.json({ success: true, skills });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/publish/:jobId', requireAuth, async (req, res) => {
  try {
    const { publishAt, privacyStatus } = req.body || {};
    const updated = await publishingSchedulingAgent.publishOrSchedule(req.params.jobId, publishAt, privacyStatus || 'private');
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/analytics', requireAuth, async (req, res) => {
  try {
    const insights = await analyticsOptimizationAgent.analyzeChannelPerformance();
    res.json({ success: true, insights });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/oauth/url', requireAuth, (req, res) => {
  try {
    const url = credentialManager.generateYouTubeAuthUrl();
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code || !state) throw new Error('Missing OAuth code or security state parameter.');
    await credentialManager.saveOAuthCode(code, state);
    res.redirect('/?oauth=success');
  } catch (err) {
    res.status(400).send(`OAuth Authorization Error: ${err.message}`);
  }
});

// Global Express Error Middleware (Fixes B26)
app.use((err, req, res, next) => {
  logger.error('ExpressError', err.stack || err.message);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const server = app.listen(config.PORT, config.HOST, () => {
  const osProfile = crossOS.getEnvironmentProfile();
  logger.success('Server', `NextGen YouTube Studio Enterprise [${osProfile.osType}] running at http://${config.HOST}:${config.PORT}`);
  if (config.ENABLE_SCHEDULER) {
    startDailyAutomation();
  }
});

// Graceful Shutdown handler
const shutdown = () => {
  logger.info('Server', 'Shutting down server gracefully...');
  stopDailyAutomation();
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
                       
