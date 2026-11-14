import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { crossOS } from '../utils/cross-os-adapter.js';

const defaultSchema = {
  schemaVersion: 3,
  engine: 'atomic-uuid-vault-v3',
  channelMetrics: {
    subscribers: null,
    views: null,
    videosPublished: 0,
    lastSyncedAt: null
  },
  videos: [],
  schedules: [],
  mcpSkills: [
    {
      id: 'mcp-ffmpeg-editor',
      name: 'Multi-Track Code & FFmpeg Video Studio',
      type: 'video-editor',
      endpoint: 'internal://editor/ffmpeg-engine',
      builtIn: true,
      status: 'connected',
      capabilities: ['cut', 'stitch', 'captions', 'b-roll', 'audio-sync']
    },
    {
      id: 'mcp-seo-analyzer',
      name: 'YouTube Metadata & Chapter Validator',
      type: 'seo',
      endpoint: 'internal://agents/seo-optimizer',
      builtIn: true,
      status: 'connected',
      capabilities: ['keyword-research', 'metadata-validation', 'chapters']
    }
  ],
  edlProjects: [],
  settings: {
    autonomousMode: true,
    dailyUploadLimit: 2,
    targetNiche: 'Pan-India Direct Hiring & Career Updates'
  }
};

export class LocalVaultDB {
  constructor(customDbDir = null) {
    this.dbDir = customDbDir ? path.resolve(customDbDir) : crossOS.resolveProjectPath('database');
    this.dbPath = path.join(this.dbDir, 'vault.json');
    this.backupPath = path.join(this.dbDir, 'vault.json.bak');
    this.data = null;
    this.init();
  }

  _deepMergeSchema(target, source) {
    const base = structuredClone(target);
    if (!source || typeof source !== 'object') return base;
    return {
      ...base,
      ...source,
      channelMetrics: { ...base.channelMetrics, ...(source.channelMetrics || {}) },
      settings: { ...base.settings, ...(source.settings || {}) },
      videos: Array.isArray(source.videos) ? source.videos : base.videos,
      schedules: Array.isArray(source.schedules) ? source.schedules : base.schedules,
      mcpSkills: Array.isArray(source.mcpSkills) ? source.mcpSkills : base.mcpSkills,
      edlProjects: Array.isArray(source.edlProjects) ? source.edlProjects : base.edlProjects
    };
  }

  init() {
    crossOS.ensureDirectories([this.dbDir]);
    try {
      if (!fs.existsSync(this.dbPath)) {
        this.data = structuredClone(defaultSchema);
        this.save({ skipBackupCopy: true });
        logger.info('Database', 'Initialized clean v3 UUID vault database.');
      } else {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = this._deepMergeSchema(defaultSchema, parsed);
        this._cleanupInterruptedJobs();
      }
    } catch (err) {
      logger.warn('Database', `Primary vault corrupted (${err.message}). Preserving corrupt file and recovering from .bak...`);
      try {
        if (fs.existsSync(this.dbPath)) {
          fs.renameSync(this.dbPath, `${this.dbPath}.corrupt.${Date.now()}`);
        }
      } catch {}

      if (fs.existsSync(this.backupPath)) {
        try {
          const backupRaw = fs.readFileSync(this.backupPath, 'utf-8');
          this.data = this._deepMergeSchema(defaultSchema, JSON.parse(backupRaw));
          this.save({ skipBackupCopy: true });
          logger.success('Database', 'Recovered database state from verified .bak file.');
          return;
        } catch {
          // Fallback to clean state
        }
      }
      this.data = structuredClone(defaultSchema);
      this.save({ skipBackupCopy: true });
    }
  }

  _cleanupInterruptedJobs() {
    let modified = false;
    for (const v of this.data.videos) {
      if (v.status === 'producing' || v.status === 'rendering') {
        v.status = 'interrupted';
        v.error = 'Server restarted while job was in progress. Click Revise/Re-Render to resume.';
        modified = true;
      }
    }
    if (modified) this.save();
  }

  save({ skipBackupCopy = false } = {}) {
    const tempPath = `${this.dbPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const payload = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(tempPath, payload, { encoding: 'utf-8', mode: 0o600 });
      if (!skipBackupCopy && fs.existsSync(this.dbPath)) {
        fs.copyFileSync(this.dbPath, this.backupPath);
      }
      fs.renameSync(tempPath, this.dbPath);
      return true;
    } catch (err) {
      logger.error('Database', `Atomic write failed: ${err.message}`);
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {}
      return false;
    }
  }

  getState({ limit = 50 } = {}) {
    const clone = structuredClone(this.data);
    clone.videos = clone.videos.slice(0, limit);
    clone.edlProjects = clone.edlProjects.slice(0, limit);
    return clone;
  }

  getVideoJobById(id) {
    const found = this.data.videos.find(v => v.id === id);
    return found ? structuredClone(found) : null;
  }

  addVideoJob(job) {
    const record = {
      id: `vid_${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      status: 'queued',
      revisionHistory: [],
      ...job
    };
    this.data.videos.unshift(record);
    this.save();
    return structuredClone(record);
  }

  updateVideoJob(id, updates) {
    const idx = this.data.videos.findIndex(v => v.id === id);
    if (idx === -1) return null;
    this.data.videos[idx] = {
      ...this.data.videos[idx],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.save();
    return structuredClone(this.data.videos[idx]);
  }

  updateChannelMetrics(metricsUpdate) {
    this.data.channelMetrics = {
      ...this.data.channelMetrics,
      ...metricsUpdate,
      lastSyncedAt: new Date().toISOString()
    };
    this.save();
    return structuredClone(this.data.channelMetrics);
  }

  updateSettings(newSettings) {
    this.data.settings = {
      ...this.data.settings,
      ...newSettings
    };
    this.save();
    return structuredClone(this.data.settings);
  }

  registerMcpSkill(skill) {
    const existingIdx = this.data.mcpSkills.findIndex(s => s.id === skill.id);
    if (existingIdx >= 0) {
      if (this.data.mcpSkills[existingIdx].builtIn) {
        throw new Error(`Cannot overwrite built-in system MCP skill "${skill.id}"`);
      }
      this.data.mcpSkills[existingIdx] = { ...this.data.mcpSkills[existingIdx], ...skill };
    } else {
      this.data.mcpSkills.push({ ...skill, builtIn: false, status: 'connected', connectedAt: new Date().toISOString() });
    }
    this.save();
    return structuredClone(this.data.mcpSkills);
  }

  removeMcpSkill(id) {
    const target = this.data.mcpSkills.find(s => s.id === id);
    if (target?.builtIn) {
      throw new Error(`Cannot remove built-in system MCP skill "${id}"`);
    }
    this.data.mcpSkills = this.data.mcpSkills.filter(s => s.id !== id);
    this.save();
    return structuredClone(this.data.mcpSkills);
  }

  saveEdlProject(project) {
    const compactProject = { ...project };
    delete compactProject.ffmpegArgs;
    const record = {
      id: `edl_${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      ...compactProject
    };
    this.data.edlProjects.unshift(record);
    if (this.data.edlProjects.length > 100) {
      this.data.edlProjects.length = 100;
    }
    this.save();
    return structuredClone(record);
  }
}

export const db = new LocalVaultDB();
                                            
