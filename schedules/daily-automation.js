import cron from 'node-cron';
import { productionManagementAgent } from '../agents/production-management-agent.js';
import { analyticsOptimizationAgent } from '../agents/analytics-optimization-agent.js';
import { db } from '../database/db.js';
import { logger } from '../utils/logger.js';

export function startDailyAutomation() {
  logger.info('Scheduler', 'Initializing 24/7 Daily Autonomous YouTube Cron Scheduler...');

  cron.schedule('0 9 * * *', async () => {
    const state = db.getState();
    if (!state.settings?.autonomousMode) return;

    logger.info('Scheduler', 'Executing scheduled daily autonomous video production...');
    try {
      await productionManagementAgent.runFullProductionPipeline({
        niche: state.settings.targetNiche || 'Pan-India Direct Hiring & Career Updates',
        topicHint: `Daily Verified Job & Career Update (${new Date().toLocaleDateString()})`,
        aspectRatio: '16:9',
        generateShort: true
      });
      await analyticsOptimizationAgent.analyzeChannelPerformance();
    } catch (err) {
      logger.error('Scheduler', `Daily cron execution failed: ${err.message}`);
    }
  });
}

if (process.argv[1]?.endsWith('daily-automation.js')) {
  startDailyAutomation();
}
