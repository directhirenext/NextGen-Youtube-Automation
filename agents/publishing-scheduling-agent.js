import fs from 'fs';
import path from 'path';
import { credentialManager } from '../utils/credential-manager.js';
import { crossOS } from '../utils/cross-os-adapter.js';
import { db } from '../database/db.js';
import { logger } from '../utils/logger.js';

export class PublishingSchedulingAgent {
  _validatePublishDate(publishAt) {
    if (!publishAt) return null;
    const d = new Date(publishAt);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid publishAt ISO date: "${publishAt}"`);
    }
    if (d.getTime() <= Date.now() + 60 * 1000) {
      throw new Error('Scheduled publishAt time must be at least 1 minute in the future.');
    }
    return d.toISOString();
  }

  async publishOrSchedule(jobId, publishAt = null, privacyStatus = 'private') {
    const job = db.getVideoJobById(jobId);
    if (!job) throw new Error(`Video job ${jobId} not found`);

    const validatedPublishAt = this._validatePublishDate(publishAt);
    const outputPath = crossOS.resolveProjectPath('editor', 'renders', path.basename(job.edlProject?.outputFile || ''));
    const isActuallyRendered = Boolean(
      job.renderResult?.rendered &&
      fs.existsSync(outputPath) &&
      fs.statSync(outputPath).size > 512
    );

    const authStatus = credentialManager.getAuthStatus();
    if (!authStatus.isYouTubeAuthorized) {
      const state = validatedPublishAt ? 'scheduled_local' : 'queued_for_oauth';
      const updated = db.updateVideoJob(jobId, {
        status: state,
        scheduledFor: validatedPublishAt || new Date().toISOString(),
        publishNote: isActuallyRendered
          ? 'Video rendered & ready on disk. Authorize YouTube OAuth2 in the dashboard to push live to YouTube.'
          : 'Queued locally (Install FFmpeg and authorize YouTube OAuth2 to upload).'
      });
      logger.info('PublishingAgent', `Job ${jobId} saved in ${state} mode.`);
      return updated;
    }

    if (!isActuallyRendered) {
      throw new Error('Cannot upload to YouTube: MP4 video file has not been rendered by FFmpeg yet.');
    }

    const youtube = credentialManager.getYouTubeClient();
    const safeTitle = String(job.seo?.optimizedTitle || job.title || 'Career Update').slice(0, 98);
    const safeDesc = String(job.seo?.description || '').slice(0, 4800);
    const safeTags = Array.isArray(job.seo?.tags) ? job.seo.tags.slice(0, 20) : [];

    logger.info('PublishingAgent', `Uploading MP4 video "${safeTitle}" to YouTube Data API v3...`);

    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: safeTitle,
          description: safeDesc,
          tags: safeTags,
          categoryId: '27',
          defaultLanguage: 'hi',
          defaultAudioLanguage: 'hi'
        },
        status: {
          privacyStatus: validatedPublishAt ? 'private' : privacyStatus,
          publishAt: validatedPublishAt || undefined,
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(outputPath)
      }
    });

    const youtubeVideoId = res.data.id;
    let thumbnailUploaded = false;
    let captionsUploaded = false;

    // 2. Upload Custom 1280x720 PNG Thumbnail if available (Fixes B24)
    if (job.thumbnail?.pngFile) {
      const thumbPath = crossOS.resolveProjectPath('editor', 'renders', path.basename(job.thumbnail.pngFile));
      if (fs.existsSync(thumbPath)) {
        try {
          await youtube.thumbnails.set({
            videoId: youtubeVideoId,
            media: {
              mimeType: 'image/png',
              body: fs.createReadStream(thumbPath)
            }
          });
          thumbnailUploaded = true;
          logger.success('PublishingAgent', `Uploaded custom PNG thumbnail for YouTube video ${youtubeVideoId}`);
        } catch (thumbErr) {
          logger.warn('PublishingAgent', `Custom thumbnail upload skipped (${thumbErr.message})`);
        }
      }
    }

    // 3. Upload .SRT Closed Captions Track if available (Fixes B24)
    if (job.edlProject?.srtFile) {
      const srtPath = crossOS.resolveProjectPath('editor', 'renders', 'subtitles', path.basename(job.edlProject.srtFile));
      if (fs.existsSync(srtPath)) {
        try {
          await youtube.captions.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                videoId: youtubeVideoId,
                language: 'hi',
                name: 'Hindi / Hinglish Subtitles',
                isDraft: false
              }
            },
            media: {
              mimeType: 'application/x-subrip',
              body: fs.createReadStream(srtPath)
            }
          });
          captionsUploaded = true;
          logger.success('PublishingAgent', `Uploaded .SRT closed captions for YouTube video ${youtubeVideoId}`);
        } catch (capErr) {
          logger.warn('PublishingAgent', `Captions upload skipped (${capErr.message})`);
        }
      }
    }

    const currentMetrics = db.getState().channelMetrics;
    db.updateChannelMetrics({
      videosPublished: (currentMetrics.videosPublished || 0) + 1
    });

    const updated = db.updateVideoJob(jobId, {
      status: validatedPublishAt ? 'scheduled_on_youtube' : 'published',
      youtubeVideoId,
      youtubeUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
      thumbnailUploaded,
      captionsUploaded,
      publishedAt: new Date().toISOString()
    });

    logger.success('PublishingAgent', `Published to YouTube! Video ID: ${youtubeVideoId}`);
    return updated;
  }
}

export const publishingSchedulingAgent = new PublishingSchedulingAgent();
            
