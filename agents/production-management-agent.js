import { contentStrategyAgent } from './content-strategy-agent.js';
import { scriptWriterAgent } from './script-writer-agent.js';
import { seoOptimizerAgent } from './seo-optimizer-agent.js';
import { thumbnailDesignerAgent } from './thumbnail-designer-agent.js';
import { codeVideoEditor } from '../utils/ffmpeg.js';
import { shortsRepurposer } from '../utils/shorts-repurposing-service.js';
import { db } from '../database/db.js';
import { logger } from '../utils/logger.js';

export class ProductionManagementAgent {
  async runFullProductionPipeline({ niche, topicHint, aspectRatio = '16:9', generateShort = true } = {}) {
    logger.info('ProductionAgent', 'Starting end-to-end autonomous video production pipeline...');

    const job = db.addVideoJob({ topicHint, niche, status: 'producing' });

    try {
      const strategy = await contentStrategyAgent.generateContentPlan(niche, topicHint);
      const script = await scriptWriterAgent.writeScriptAndScenes(strategy);
      const seo = await seoOptimizerAgent.optimizeMetadata(strategy.selectedTopic, script.fullNarration);
      const thumbnail = await thumbnailDesignerAgent.designThumbnail(seo.optimizedTitle);

      const compiledEdl = codeVideoEditor.validateAndCompileEDL({
        title: seo.optimizedTitle,
        aspectRatio,
        fps: 30,
        scenes: script.scenes
      });

      const renderResult = await codeVideoEditor.executeRender(compiledEdl);

      let shortVariant = null;
      if (generateShort) {
        shortVariant = shortsRepurposer.convertLongEdlToShort(compiledEdl);
      }

      const completedJob = db.updateVideoJob(job.id, {
        status: 'ready_to_publish',
        title: seo.optimizedTitle,
        strategy,
        script,
        seo,
        thumbnail,
        edlProject: compiledEdl,
        renderResult,
        shortVariant
      });

      logger.success('ProductionAgent', `Production pipeline completed for Job ID: ${job.id}`);
      return completedJob;
    } catch (err) {
      logger.error('ProductionAgent', `Pipeline failed: ${err.message}`);
      db.updateVideoJob(job.id, { status: 'failed', error: err.message });
      throw err;
    }
  }
}

export const productionManagementAgent = new ProductionManagementAgent();
        
