import { z } from 'zod';
import { aiTextService } from '../utils/ai-text-service.js';
import { logger } from '../utils/logger.js';

const strategySchema = z.object({
  selectedTopic: z.string().min(5).max(160),
  targetAudience: z.string().min(3).max(160),
  angle: z.string().min(3).max(200),
  hookIdea: z.string().min(5).max(200)
});

export class ContentStrategyAgent {
  async generateStrategy(niche = 'Pan-India Direct Hiring & Career Updates', customTopic = '') {
    logger.info('ContentStrategyAgent', `Generating content strategy for niche: "${niche}"`);

    const systemPrompt =
      'You are a YouTube Content Strategist for an Indian audience (Hindi/Hinglish/English). ' +
      'Never fabricate fake company hiring links or unverified salary claims. ' +
      'Return JSON with keys: selectedTopic, targetAudience, angle, hookIdea.';
    const userPrompt = customTopic
      ? `Build a factual, high-retention video strategy around: "${customTopic}" in niche "${niche}".`
      : `Suggest a practical, high-retention video topic for niche "${niche}" focused on real career preparation and official application guidance.`;

    const fallback = {
      selectedTopic: customTopic || `${niche}: ताज़ा भर्ती और आवेदन की पूरी प्रक्रिया`,
      targetAudience: 'Freshers, Job Seekers & Working Professionals across India',
      angle: 'Step-by-step official portal walkthrough, eligibility checklist, and interview preparation tips',
      hookIdea: 'क्या आप भी सही तरीके से अप्लाई करना चाहते हैं? जानिए ऑफिशियल प्रोसेस और ज़रूरी योग्यता!'
    };

    const strategy = await aiTextService.generateStructuredJSON(systemPrompt, userPrompt, fallback, strategySchema);
    logger.success('ContentStrategyAgent', `Strategy locked: "${strategy.selectedTopic}"`);
    return strategy;
  }
}

export const contentStrategyAgent = new ContentStrategyAgent();

