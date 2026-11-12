import fs from 'fs';
import { credentialManager } from '../utils/credential-manager.js';
import { db } from '../database/db.js';
import { logger } from '../utils/logger.js';

export class PublishingSchedulingAgent {
  async publishOrSchedule(videoJobId, publishAtIso = null) {
    const state = db.getState();
    const job = state.videos.find(v => v.id === videoJobId);
    if (!job) throw new Error(`Video job ${videoJobId} not found`);

    const authStatus = credentialManager.getAuthStatus();
    if (!authStatus.isYouTubeAuthorized) {
      logger.warn('PublishingAgent', 'YouTube OAuth token not connected yet. Marking job as scheduled in local queue.');
      return db.updateVideoJob(videoJobId, {
        status: 'scheduled_local',
        scheduledFor: publishAtIso || new Date(Date.now() + 3600_000).toISOString()
      });
    }

    const yt = credentialManager.getYouTubeClient();
    const filePath = job.edlProject?.outputPath;

    if (!filePath || !fs.existsSync(filePath)) {
      logger.warn('PublishingAgent', 'Rendered MP4 file not on disk; saving metadata schedule ready for cloud render.');
      return db.updateVideoJob(videoJobId, { status: 'scheduled_metadata_ready' });
    }

    const res = await yt.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: job.seo.optimizedTitle,
          description: job.seo.description,
          tags: job.seo.tags,
          categoryId: '27'
        },
        status: {
          privacyStatus: publishAtIso ? 'private' : 'public',
          publishAt: publishAtIso || undefined,
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(filePath)
      }
    });

    logger.success('PublishingAgent', `Uploaded to YouTube! Video ID: ${res.data.id}`);
    return db.updateVideoJob(videoJobId, {
      status: 'published',
      youtubeVideoId: res.data.id
    });
  }
}

export const publishingSchedulingAgent = new PublishingSchedulingAgent();
