import { aiTextService } from '../utils/ai-text-service.js';
import { logger } from '../utils/logger.js';

export class ContentStrategyAgent {
  async generateContentPlan(niche = 'Pan-India Jobs & Career Updates', topicHint = '') {
    logger.info('ContentStrategyAgent', `Generating strategy for niche: "${niche}"`);

    const systemPrompt = 'You are a YouTube Content Strategist. Output JSON with keys: selectedTopic, targetAudience, angle, viralScore, and hookIdea.';
    const userPrompt = `Create a video strategy for niche: ${niche}. Topic hint: ${topicHint || 'Latest Direct Hiring & Tech Skills'}.`;

    const fallback = {
      selectedTopic: topicHint || `Top Pan-India Direct Hiring Drives & Remote Roles (${new Date().getFullYear()})`,
      targetAudience: 'Job seekers, freshers, and working professionals across India',
      angle: 'Step-by-step direct application links, salary breakdown, and walk-in details',
      viralScore: 94,
      hookIdea: 'Stop applying on fake portals—here are verified direct hiring links open right now!'
    };

    const plan = await aiTextService.generateStructuredJSON(systemPrompt, userPrompt, fallback);
    logger.success('ContentStrategyAgent', `Locked topic: "${plan.selectedTopic}"`);
    return plan;
  }
}

export const contentStrategyAgent = new ContentStrategyAgent();
