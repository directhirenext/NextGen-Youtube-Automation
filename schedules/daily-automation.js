import cron from 'node-cron';
import { loadValidatedConfig } from '../config/security-validator.js';
import { productionManagementAgent } from '../agents/production-management-agent.js';
import { publishingSchedulingAgent } from '../agents/publishing-scheduling-agent.js';
import { analyticsOptimizationAgent } from '../agents/analytics-optimization-agent.js';
import { db } from '../database/db.js';
import { logger } from '../utils/logger.js';

let scheduledTask = null;
let isJobRunning = false;

export function startDailyAutomation() {
  if (scheduledTask) return scheduledTask;

  const config = loadValidatedConfig();
  if (!config.ENABLE_SCHEDULER) {
    logger.info('Scheduler', 'In-process scheduler is disabled via ENABLE_SCHEDULER=false.');
    return null;
  }

  const cronExpr = config.SCHEDULER_CRON || '0 9 * * *';
  const timezone = config.SCHEDULER_TIMEZONE || 'Asia/Kolkata';

  logger.info('Scheduler', `Initializing In-Process Autonomous Scheduler (${cronExpr} [${timezone}])...`);

  scheduledTask = cron.schedule(
    cronExpr,
    async () => {
      if (isJobRunning) {
        logger.warn('Scheduler', 'Previous scheduled production run is still active; skipping overlapping run.');
        return;
      }

      const state = db.getState({ limit: 100 });
      if (!state.settings?.autonomousMode) {
        logger.info('Scheduler', 'Autonomous mode is toggled OFF in settings; skipping scheduled run.');
        return;
      }

      const todayIsoPrefix = new Date().toISOString().slice(0, 10);
      const producedToday = (state.videos || []).filter(v => String(v.createdAt).startsWith(todayIsoPrefix)).length;
      const limit = Number(state.settings?.dailyUploadLimit || 2);

      if (producedToday >= limit) {
        logger.info('Scheduler', `Daily upload limit (${limit}) reached for ${todayIsoPrefix}; skipping run.`);
        return;
      }

      isJobRunning = true;
      logger.info('Scheduler', `Executing scheduled autonomous production (${producedToday + 1}/${limit} for ${todayIsoPrefix})...`);

      try {
        const job = await productionManagementAgent.runFullProductionPipeline({
          niche: state.settings.targetNiche || 'Pan-India Direct Hiring & Career Updates',
          topicHint: `Daily Career & Recruitment Update (${todayIsoPrefix})`,
          aspectRatio: '16:9',
          generateShort: true
        });

        if (job && job.status === 'ready_to_publish') {
          await publishingSchedulingAgent.publishOrSchedule(job.id);
        }

        await analyticsOptimizationAgent.analyzeChannelPerformance();
      } catch (err) {
        logger.error('Scheduler', `Scheduled cron execution failed: ${err.message}`);
      } finally {
        isJobRunning = false;
      }
    },
    { timezone }
  );

  return scheduledTask;
}

export function stopDailyAutomation() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}

if (process.argv[1]?.endsWith('daily-automation.js')) {
  startDailyAutomation();
}
