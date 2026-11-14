import { z } from 'zod';
import { aiTextService } from '../utils/ai-text-service.js';
import { mediaStudio } from '../utils/media-studio-service.js';
import { logger } from '../utils/logger.js';

const seoOutputSchema = z.object({
  optimizedTitle: z.string().min(5).max(100),
  description: z.string().min(20).max(4800),
  tags: z.array(z.string().min(2).max(40)).min(3).max(25),
  hashtags: z.array(z.string().startsWith('#')).min(1).max(10),
  alternateTitle: z.string().min(5).max(100).optional()
});

export class SEOOptimizerAgent {
  computeRealMetadataScore({ title, description, tags, chaptersText, topic }) {
    let score = 0;
    const breakdown = [];

    if (title.length >= 35 && title.length <= 95) {
      score += 25;
      breakdown.push('Title length optimal (35-95 chars)');
    } else {
      score += 12;
      breakdown.push('Title length outside optimal 35-95 char window');
    }

    const topicWords = String(topic).toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const titleLower = title.toLowerCase();
    const matchedWords = topicWords.filter(w => titleLower.includes(w));
    if (matchedWords.length > 0 || topicWords.length === 0) {
      score += 25;
      breakdown.push('Primary topic keywords present in title');
    } else {
      score += 10;
    }

    if (description.length >= 200) {
      score += 20;
      breakdown.push('Description depth >= 200 chars');
    } else {
      score += 10;
    }

    const chapterLines = String(chaptersText || '').split('\n').filter(Boolean);
    if (chapterLines.length >= 3 && chapterLines[0].startsWith('00:00')) {
      score += 15;
      breakdown.push(`Valid YouTube chapters (${chapterLines.length} sections starting at 00:00)`);
    }

    const totalTagChars = tags.join(',').length;
    if (tags.length >= 5 && totalTagChars <= 480) {
      score += 15;
      breakdown.push(`${tags.length} tags within YouTube 500-char quota`);
    }

    return { score: Math.min(100, score), breakdown };
  }

  async optimizeMetadata(topic, scriptNarration = '', scenes = []) {
    logger.info('SEOOptimizerAgent', `Generating validated YouTube metadata & real chapters for: "${topic}"`);

    const subAndChapters = mediaStudio.generateSrtAndChapters(scenes, topic, { writeFile: false });

    const systemPrompt =
      'You are a YouTube SEO Specialist. Return JSON with keys: optimizedTitle (<= 95 chars), alternateTitle (<= 95 chars), description, tags (array of strings), hashtags (array of strings starting with #).';
    const userPrompt = `Topic: ${topic}\nScript Summary: ${scriptNarration.slice(0, 400)}`;

    const cleanTopic = String(topic).slice(0, 65);
    const fallback = {
      optimizedTitle: `${cleanTopic} | पूरी जानकारी और आवेदन प्रक्रिया`,
      alternateTitle: `${cleanTopic} — योग्यता, डॉक्यूमेंट्स और स्टेप-बाय-स्टेप गाइड`,
      description: `${topic}\n\nइस वीडियो में हमने योग्यता, ज़रूरी डॉक्यूमेंट्स और आवेदन करने की पूरी प्रक्रिया को सरल भाषा में समझाया है।\n\n${scriptNarration.slice(0, 300)}`,
      tags: ['career updates', 'job alert india', 'recruitment guide', 'fresher jobs', 'application process', 'hindi career guide'],
      hashtags: ['#CareerUpdates', '#JobAlert', '#IndiaJobs']
    };

    const rawSeo = await aiTextService.generateStructuredJSON(systemPrompt, userPrompt, fallback, seoOutputSchema);

    // Ensure YouTube API limits: title <= 100 chars, total tags <= 480 chars, and append real scene chapters even when LLM responds (Fixes B17, B24)
    const safeTitle = rawSeo.optimizedTitle.slice(0, 98);
    const chapterBlock = `\n\n⏱️ Video Chapters:\n${subAndChapters.chaptersText}\n\n${rawSeo.hashtags.join(' ')}`;
    const baseDesc = rawSeo.description.includes('00:00')
      ? rawSeo.description
      : `${rawSeo.description.slice(0, 4200)}${chapterBlock}`;

    const trimmedTags = [];
    let runningLen = 0;
    for (const t of rawSeo.tags) {
      const cleanTag = t.replace(/[<>]/g, '').trim();
      if (cleanTag && runningLen + cleanTag.length + 1 <= 460) {
        trimmedTags.push(cleanTag);
        runningLen += cleanTag.length + 1;
      }
    }

    const audit = this.computeRealMetadataScore({
      title: safeTitle,
      description: baseDesc,
      tags: trimmedTags,
      chaptersText: subAndChapters.chaptersText,
      topic
    });

    const result = {
      optimizedTitle: safeTitle,
      alternateTitle: (rawSeo.alternateTitle || fallback.alternateTitle).slice(0, 98),
      description: baseDesc,
      tags: trimmedTags,
      hashtags: rawSeo.hashtags,
      chapters: subAndChapters.chaptersText,
      seoScore: audit.score,
      seoAuditBreakdown: audit.breakdown
    };

    logger.success('SEOOptimizerAgent', `Metadata ready (Verified Rule Score: ${result.seoScore}/100)`);
    return result;
  }
}

export const seoOptimizerAgent = new SEOOptimizerAgent();
    
