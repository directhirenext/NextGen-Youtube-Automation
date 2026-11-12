import { aiTextService } from '../utils/ai-text-service.js';
import { logger } from '../utils/logger.js';

export class SEOOptimizerAgent {
  async optimizeMetadata(topic, scriptNarration = '') {
    logger.info('SEOOptimizerAgent', `Optimizing SEO metadata for: "${topic}"`);

    const systemPrompt = 'You are a YouTube SEO Expert. Return JSON with keys: optimizedTitle, description, tags, hashtags, and seoScore.';
    const userPrompt = `Optimize metadata for topic: ${topic}. Summary: ${scriptNarration.slice(0, 250)}`;

    const fallback = {
      optimizedTitle: `${topic} | Direct Apply Link & Full Details`,
      description: `🔥 ${topic}\n\nComplete details, eligibility, and step-by-step application instructions.\n\n✅ Subscribe for daily verified updates!\n\n#Jobs #CareerUpdates #DirectHiring`,
      tags: ['direct hiring', 'job updates', 'career portal', 'freshers jobs', 'work from home'],
      hashtags: ['#DirectHiring', '#JobUpdates', '#Career'],
      seoScore: 96
    };

    const seo = await aiTextService.generateStructuredJSON(systemPrompt, userPrompt, fallback);
    logger.success('SEOOptimizerAgent', `SEO Metadata ready (Score: ${seo.seoScore}/100)`);
    return seo;
  }
}

export const seoOptimizerAgent = new SEOOptimizerAgent();
