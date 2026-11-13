import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { crossOS } from '../utils/cross-os-adapter.js';

const DB_DIR = path.resolve('database');
const DB_PATH = path.join(DB_DIR, 'vault.json');
const DB_BACKUP_PATH = path.join(DB_DIR, 'vault.json.bak');

const defaultSchema = {
  engine: 'atomic-mutex-vault-v2',
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
    this._writeLock = false;
    this._pendingWrite = false;
    this.init();
  }

  init() {
    crossOS.ensureDirectories([DB_DIR]);
    try {
      if (!fs.existsSync(DB_PATH)) {
        this.data = structuredClone(defaultSchema);
        this.save();
        logger.info('Database', 'Initialized clean zero-bug mutex vault database.');
      } else {
        const raw = fs.readFileSync(DB_PATH, 'utf-8');
        this.data = { ...structuredClone(defaultSchema), ...JSON.parse(raw) };
      }
    } catch (err) {
      logger.warn('Database', `Primary vault corrupted (${err.message}). Attempting recovery from .bak...`);
      if (fs.existsSync(DB_BACKUP_PATH)) {
        try {
          const backupRaw = fs.readFileSync(DB_BACKUP_PATH, 'utf-8');
          this.data = { ...structuredClone(defaultSchema), ...JSON.parse(backupRaw) };
          this.save();
          logger.success('Database', 'Recovered database state from backup vault.');
          return;
        } catch {
          // Fallback to clean state
        }
      }
      this.data = structuredClone(defaultSchema);
      this.save();
    }
  }

  save() {
    if (this._writeLock) {
      this._pendingWrite = true;
      return true;
    }
    this._writeLock = true;
    try {
      const payload = JSON.stringify(this.data, null, 2);
      const tempPath = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tempPath, payload, { encoding: 'utf-8', mode: 0o600 });
      if (fs.existsSync(DB_PATH)) {
        fs.copyFileSync(DB_PATH, DB_BACKUP_PATH);
      }
      fs.renameSync(tempPath, DB_PATH);
      return true;
    } catch (err) {
      logger.error('Database', `Atomic mutex write failed: ${err.message}`);
      return false;
    } finally {
      this._writeLock = false;
      if (this._pendingWrite) {
        this._pendingWrite = false;
        this.save();
      }
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
            
