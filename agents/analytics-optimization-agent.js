import { db } from '../database/db.js';
import { credentialManager } from '../utils/credential-manager.js';
import { logger } from '../utils/logger.js';

export class AnalyticsOptimizationAgent {
  async analyzeChannelPerformance() {
    logger.info('AnalyticsAgent', 'Computing real channel & production telemetry...');
    const state = db.getState({ limit: 200 });
    const videos = state.videos || [];

    const totalProduced = videos.length;
    const renderedCount = videos.filter(v => v.renderResult?.rendered).length;
    const publishedCount = videos.filter(v => v.status === 'published' || v.youtubeVideoId).length;
    const failedCount = videos.filter(v => v.status === 'failed' || v.status === 'render_failed').length;

    const scoredVideos = videos.filter(v => typeof v.seo?.seoScore === 'number');
    const averageSeoScore = scoredVideos.length
      ? Math.round(scoredVideos.reduce((acc, v) => acc + v.seo.seoScore, 0) / scoredVideos.length)
      : null;

    let liveYouTubeStats = null;
    const authStatus = credentialManager.getAuthStatus();
    if (authStatus.isYouTubeAuthorized) {
      try {
        const yt = credentialManager.getYouTubeClient();
        const res = await yt.channels.list({ part: ['statistics', 'snippet'], mine: true });
        const channel = res.data?.items?.[0];
        if (channel?.statistics) {
          liveYouTubeStats = {
            channelTitle: channel.snippet?.title,
            subscribers: Number(channel.statistics.subscriberCount || 0),
            views: Number(channel.statistics.viewCount || 0),
            videosPublished: Number(channel.statistics.videoCount || 0)
          };
          db.updateChannelMetrics(liveYouTubeStats);
        }
      } catch (err) {
        logger.warn('AnalyticsAgent', `Could not fetch live YouTube channel stats: ${err.message}`);
      }
    }

    const recommendations = [];
    if (!authStatus.ffmpegAvailable) {
      recommendations.push('Install FFmpeg on host machine to enable hardware MP4 video rendering.');
    }
    if (!authStatus.devanagariFontReady) {
      recommendations.push('Install NotoSansDevanagari font (via npm run setup) for crisp Hindi typography.');
    }
    if (!authStatus.isYouTubeAuthorized) {
      recommendations.push('Connect YouTube OAuth2 to sync live subscriber/view counts and enable 1-click uploads.');
    }
    if (averageSeoScore !== null && averageSeoScore < 85) {
      recommendations.push('Expand video descriptions (>200 chars) and ensure >=3 scenes (10s each) to boost SEO score.');
    }
    if (recommendations.length === 0) {
      recommendations.push('All studio subsystems (FFmpeg, Devanagari font, and metadata rules) are operating optimally.');
    }

    const insights = {
      totalVideosInVault: totalProduced,
      renderedMp4Count: renderedCount,
      publishedCount,
      failedCount,
      averageSeoScore,
      liveYouTubeStats,
      recommendations
    };

    logger.success('AnalyticsAgent', `Telemetry analyzed (${totalProduced} jobs, ${renderedCount} rendered).`);
    return insights;
  }
}

export const analyticsOptimizationAgent = new AnalyticsOptimizationAgent();
    
