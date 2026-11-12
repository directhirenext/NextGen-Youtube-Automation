import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const DB_PATH = path.resolve('database/vault.json');

const defaultSchema = {
  channelMetrics: { subscribers: 0, views: 0, videosPublished: 0, healthScore: 100 },
  videos: [],
  schedules: [],
  mcpSkills: [
    {
      id: 'mcp-ffmpeg-editor',
      name: 'Claude-Style Code Video Editor',
      type: 'video-editor',
      endpoint: 'internal://editor/ffmpeg-engine',
      status: 'connected',
      capabilities: ['cut', 'stitch', 'captions', 'b-roll', 'audio-sync']
    },
    {
      id: 'mcp-seo-analyzer',
      name: 'Real-Time YouTube SEO & Trend Skill',
      type: 'seo',
      endpoint: 'internal://agents/seo-optimizer',
      status: 'connected',
      capabilities: ['keyword-research', 'metadata-validation', 'tags']
    }
  ],
  edlProjects: [],
  settings: { autonomousMode: true, dailyUploadLimit: 2, targetNiche: 'Tech & Careers' }
};

class LocalVaultDB {
  constructor() {
    this.data = null;
    this.init();
  }

  init() {
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify(defaultSchema, null, 2), 'utf-8');
        this.data = structuredClone(defaultSchema);
        logger.info('Database', 'Initialized new clean local vault database.');
      } else {
        const raw = fs.readFileSync(DB_PATH, 'utf-8');
        this.data = { ... structuredClone(defaultSchema), ...JSON.parse(raw) };
      }
    } catch (err) {
      logger.error('Database', `Vault initialization error: ${err.message}`);
      this.data = structuredClone(defaultSchema);
    }
  }

  save() {
    try {
      const tempPath = `${DB_PATH}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tempPath, DB_PATH);
      return true;
    } catch (err) {
      logger.error('Database', `Atomic write failed: ${err.message}`);
      return false;
    }
  }

  getState() { return this.data; }

  addVideoJob(job) {
    const record = { id: `vid_${Date.now()}`, createdAt: new Date().toISOString(), status: 'queued', ...job };
    this.data.videos.unshift(record);
    this.save();
    return record;
  }

  updateVideoJob(id, updates) {
    const idx = this.data.videos.findIndex(v => v.id === id);
    if (idx === -1) return null;
    this.data.videos[idx] = { ...this.data.videos[idx], ...updates, updatedAt: new Date().toISOString() };
    this.save();
    return this.data.videos[idx];
  }

  registerMcpSkill(skill) {
    const existingIdx = this.data.mcpSkills.findIndex(s => s.id === skill.id);
    if (existingIdx >= 0) {
      this.data.mcpSkills[existingIdx] = { ...this.data.mcpSkills[existingIdx], ...skill };
    } else {
      this.data.mcpSkills.push({ ...skill, status: 'connected', connectedAt: new Date().toISOString() });
    }
    this.save();
    return this.data.mcpSkills;
  }

  removeMcpSkill(id) {
    this.data.mcpSkills = this.data.mcpSkills.filter(s => s.id !== id);
    this.save();
    return this.data.mcpSkills;
  }

  saveEdlProject(project) {
    const record = { id: `edl_${Date.now()}`, createdAt: new Date().toISOString(), ...project };
    this.data.edlProjects.unshift(record);
    this.save();
    return record;
  }
}

export const db = new LocalVaultDB();
              
