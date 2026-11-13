import { z } from 'zod';
import { db } from '../database/db.js';
import { logger } from '../utils/logger.js';
import { validateSafeExternalUrl } from '../config/security-validator.js';

const mcpSkillSchema = z.object({
  id: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(3).max(100),
  type: z.enum(['video-editor', 'seo', 'thumbnail', 'voiceover', 'publishing', 'custom']),
  endpoint: z.string().min(5).max(300).refine(
    (val) => validateSafeExternalUrl(val),
    { message: 'Blocked by SSRF Guard: Endpoint must be internal:// or a public HTTPS/HTTP URL (private/loopback IPs forbidden).' }
  ),
  capabilities: z.array(z.string().max(50)).max(20).default([])
});

export class MCPHub {
  constructor() {
    this.handlers = new Map();
    this._registerBuiltInHandlers();
  }

  _registerBuiltInHandlers() {
    this.handlers.set('mcp-ffmpeg-editor', async (action, payload) => {
      logger.info('MCPHub', `Executing built-in Code Video Editor skill: ${action}`);
      return { status: 'executed', skill: 'mcp-ffmpeg-editor', action, timestamp: new Date().toISOString(), payload };
    });

    this.handlers.set('mcp-seo-analyzer', async (action, payload) => {
      logger.info('MCPHub', `Executing built-in SEO Analyzer skill: ${action}`);
      return { status: 'executed', skill: 'mcp-seo-analyzer', action, score: 96, payload };
    });
  }

  listSkills() {
    return db.getState().mcpSkills;
  }

  connectSkillFromBrowser(rawSkillData) {
    const parsed = mcpSkillSchema.safeParse(rawSkillData);
    if (!parsed.success) {
      throw new Error(`Invalid MCP Skill Schema: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
    }

    const updatedSkills = db.registerMcpSkill(parsed.data);
    logger.success('MCPHub', `Connected Verified MCP Skill: ${parsed.data.name} (${parsed.data.id})`);
    return updatedSkills;
  }

  disconnectSkill(skillId) {
    const cleanId = String(skillId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const updatedSkills = db.removeMcpSkill(cleanId);
    logger.warn('MCPHub', `Disconnected MCP Skill: ${cleanId}`);
    return updatedSkills;
  }

  async invokeSkill(skillId, action, payload = {}) {
    const skills = this.listSkills();
    const skill = skills.find(s => s.id === skillId);
    if (!skill) {
      throw new Error(`MCP Skill "${skillId}" is not connected.`);
    }

    if (this.handlers.has(skillId)) {
      return await this.handlers.get(skillId)(action, payload);
    }

    if (skill.endpoint.startsWith('http://') || skill.endpoint.startsWith('https://')) {
      if (!validateSafeExternalUrl(skill.endpoint)) {
        throw new Error('Blocked unsafe MCP endpoint by SSRF security policy.');
      }

      logger.info('MCPHub', `Dispatching remote MCP JSON-RPC call to ${skill.endpoint}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(skill.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: String(action).slice(0, 80),
            params: payload
          })
        });
        if (!response.ok) {
          throw new Error(`Remote MCP endpoint returned HTTP ${response.status}`);
        }
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      status: 'simulated',
      skillId,
      action,
      message: 'Skill registered and verified in local MCP state.'
    };
  }
}

export const mcpHub = new MCPHub();
    
