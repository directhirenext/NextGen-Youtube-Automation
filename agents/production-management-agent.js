import { contentStrategyAgent } from './content-strategy-agent.js';
import { scriptWriterAgent } from './script-writer-agent.js';
import { seoOptimizerAgent } from './seo-optimizer-agent.js';
import { thumbnailDesignerAgent } from './thumbnail-designer-agent.js';
import { codeVideoEditor } from '../utils/ffmpeg.js';
import { shortsRepurposer } from '../utils/shorts-repurposing-service.js';
import { ttsService } from '../utils/tts-service.js';
import { db } from '../database/db.js';
import { logger } from '../utils/logger.js';

export class ProductionManagementAgent {
  async runFullProductionPipeline({ niche, topicHint, aspectRatio = '16:9', generateShort = true }) {
    logger.info('ProductionAgent', 'Starting End-to-End Autonomous Production Pipeline...');

    const job = db.addVideoJob({
      niche,
      topicHint,
      aspectRatio,
      status: 'producing'
    });

    try {
      // 1. Strategy
      const strategy = await contentStrategyAgent.generateStrategy(niche, topicHint);

      // 2. Script + EDL Scenes
      const script = await scriptWriterAgent.writeScriptAndEDL(strategy, aspectRatio);

      // 3. Humanized Neural TTS Voiceover Generation (Fixes B1 - Video is no longer silent!)
      const ttsTrack = await ttsService.synthesizeNarration(script.fullNarration);

      // 4. Compile & Render Video with Voiceover Track
      const edlPayload = {
        title: strategy.selectedTopic,
        aspectRatio,
        fps: 30,
        manualStudio: {
          voiceoverAudioFile: ttsTrack.filename,
          noiseCancellation: true,
          loudnessNormalization: true,
          burnSubtitles: true
        },
        scenes: script.scenes
      };

      const compiledEdl = codeVideoEditor.validateAndCompileEDL(edlPayload);
      const renderResult = await codeVideoEditor.executeRender(compiledEdl);

      // 5. SEO Metadata & Real Scene Chapters (Using actual post-TTS scene durations - Fixes B17)
      const seo = await seoOptimizerAgent.optimizeMetadata(
        strategy.selectedTopic,
        script.fullNarration,
        compiledEdl.edlCode.scenes
      );
      seo.srtSubtitleFile = compiledEdl.srtFile;

      // 6. Thumbnail (SVG + Real 1280x720 PNG)
      const thumbnail = await thumbnailDesignerAgent.designThumbnail(
        seo.optimizedTitle,
        'IMPORTANT UPDATE',
        strategy.selectedTopic
      );

      // 7. Optional 9:16 Short Repurposing & Real Render (Fixes B16)
      let shortVariant = null;
      if (generateShort && aspectRatio === '16:9') {
        shortVariant = await shortsRepurposer.repurposeLongToShort(compiledEdl.edlCode, ttsTrack.filename);
      }

      const finalStatus = renderResult.rendered
        ? 'ready_to_publish'
        : (renderResult.mode === 'ffmpeg-missing' ? 'compiled_awaiting_ffmpeg' : 'render_failed');

      const completedJob = db.updateVideoJob(job.id, {
        status: finalStatus,
        title: seo.optimizedTitle,
        strategy,
        script: {
          fullNarration: script.fullNarration,
          scenes: compiledEdl.edlCode.scenes
        },
        ttsTrack,
        seo,
        thumbnail,
        edlProject: {
          id: compiledEdl.id,
          outputFile: compiledEdl.outputFile,
          srtFile: compiledEdl.srtFile,
          totalDurationSec: compiledEdl.totalDurationSec,
          sceneCount: compiledEdl.sceneCount,
          ffmpegCommandPreview: compiledEdl.ffmpegCommandPreview,
          edlCode: compiledEdl.edlCode
        },
        renderResult,
        shortVariant
      });

      logger.success('ProductionAgent', `Job ${job.id} finished with status "${finalStatus}".`);
      return completedJob;
    } catch (err) {
      db.updateVideoJob(job.id, { status: 'failed', error: err.message });
      logger.error('ProductionAgent', `Pipeline failed for ${job.id}: ${err.message}`);
      throw err;
    }
  }

  // Interactive AI Revision & Manual Override Handler (Fixes User Feedback / Regeneration Requirement)
  async reviseAndReRenderJob(jobId, {
    feedbackPrompt = '',
    regenerateTarget = 'all', // 'all' | 'script_video' | 'seo' | 'thumbnail'
    manualTitle = '',
    manualDescription = '',
    manualNarration = '',
    manualBadgeText = '',
    manualScenes = null,
    manualStudioOverrides = null
  } = {}) {
    const job = db.getVideoJobById(jobId);
    if (!job) throw new Error(`Video job "${jobId}" not found.`);

    logger.info('ProductionAgent', `Revising job ${jobId} (Target: ${regenerateTarget}, Feedback: "${feedbackPrompt || 'manual edit'}")`);
    db.updateVideoJob(jobId, { status: 'rendering' });

    try {
      let updatedScript = structuredClone(job.script || { fullNarration: '', scenes: [] });
      let updatedTts = job.ttsTrack;
      let updatedSeo = structuredClone(job.seo || {});
      let updatedThumb = structuredClone(job.thumbnail || {});

      // 1. Apply AI Feedback or Manual Script/Scene Edits
      const needsScriptUpdate =
        Boolean(feedbackPrompt && ['all', 'script_video'].includes(regenerateTarget)) ||
        Boolean(manualNarration) ||
        Array.isArray(manualScenes);

      if (feedbackPrompt && ['all', 'script_video'].includes(regenerateTarget)) {
        updatedScript = await scriptWriterAgent.reviseScriptWithFeedback(
          updatedScript,
          manualTitle || updatedSeo.optimizedTitle || job.title,
          feedbackPrompt
        );
      }
      if (manualNarration && manualNarration.trim()) {
        updatedScript.fullNarration = manualNarration.trim();
      }
      if (Array.isArray(manualScenes) && manualScenes.length > 0) {
        updatedScript.scenes = manualScenes;
      }

      // Regenerate humanized voiceover if narration changed or missing
      if (needsScriptUpdate || !updatedTts?.filename) {
        updatedTts = await ttsService.synthesizeNarration(updatedScript.fullNarration);
      }

      // 2. Re-compile and Re-render Video
      const currentStudio = {
        ...(job.edlProject?.edlCode?.manualStudio || {}),
        ...(manualStudioOverrides || {}),
        voiceoverAudioFile: manualStudioOverrides?.voiceoverAudioFile || updatedTts.filename
      };

      const edlPayload = {
        title: manualTitle || updatedSeo.optimizedTitle || job.title || 'Revised Video',
        aspectRatio: job.aspectRatio || '16:9',
        fps: 30,
        manualStudio: currentStudio,
        scenes: updatedScript.scenes
      };

      const compiledEdl = codeVideoEditor.validateAndCompileEDL(edlPayload);
      const renderResult = await codeVideoEditor.executeRender(compiledEdl);

      // 3. Update SEO if requested or if scenes/title changed
      if (['all', 'seo'].includes(regenerateTarget) || feedbackPrompt) {
        const topicQuery = feedbackPrompt
          ? `${edlPayload.title} (${feedbackPrompt})`
          : edlPayload.title;
        updatedSeo = await seoOptimizerAgent.optimizeMetadata(
          topicQuery,
          updatedScript.fullNarration,
          compiledEdl.edlCode.scenes
        );
      }
      if (manualTitle && manualTitle.trim()) {
        updatedSeo.optimizedTitle = manualTitle.trim().slice(0, 98);
      }
      if (manualDescription && manualDescription.trim()) {
        updatedSeo.description = manualDescription.trim().slice(0, 4800);
      }
      updatedSeo.srtSubtitleFile = compiledEdl.srtFile;

      // 4. Update Thumbnail if requested or if title/badge changed
      if (['all', 'thumbnail'].includes(regenerateTarget) || manualTitle || manualBadgeText || feedbackPrompt) {
        updatedThumb = await thumbnailDesignerAgent.designThumbnail(
          updatedSeo.optimizedTitle,
          manualBadgeText || updatedThumb.rawBadgeText || 'UPDATED EDITION',
          feedbackPrompt || updatedSeo.alternateTitle || 'STEP-BY-STEP GUIDE'
        );
      }

      const historyEntry = {
        revisedAt: new Date().toISOString(),
        feedbackPrompt: feedbackPrompt || 'Manual Override Edit',
        regenerateTarget,
        rendered: renderResult.rendered
      };

      const finalStatus = renderResult.rendered
        ? 'ready_to_publish'
        : (renderResult.mode === 'ffmpeg-missing' ? 'compiled_awaiting_ffmpeg' : 'render_failed');

      const savedJob = db.updateVideoJob(jobId, {
        status: finalStatus,
        title: updatedSeo.optimizedTitle,
        script: {
          fullNarration: updatedScript.fullNarration,
          scenes: compiledEdl.edlCode.scenes
        },
        ttsTrack: updatedTts,
        seo: updatedSeo,
        thumbnail: updatedThumb,
        edlProject: {
          id: compiledEdl.id,
          outputFile: compiledEdl.outputFile,
          srtFile: compiledEdl.srtFile,
          totalDurationSec: compiledEdl.totalDurationSec,
          sceneCount: compiledEdl.sceneCount,
          ffmpegCommandPreview: compiledEdl.ffmpegCommandPreview,
          edlCode: compiledEdl.edlCode
        },
        renderResult,
        revisionHistory: [...(job.revisionHistory || []), historyEntry]
      });

      logger.success('ProductionAgent', `Successfully revised & re-rendered job ${jobId}`);
      return savedJob;
    } catch (err) {
      db.updateVideoJob(jobId, { status: 'render_failed', error: err.message });
      throw err;
    }
  }
}

export const productionManagementAgent = new ProductionManagementAgent();
          
