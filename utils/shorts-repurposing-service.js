import { codeVideoEditor } from './ffmpeg.js';
import { logger } from './logger.js';

export class ShortsRepurposingService {
  async repurposeLongToShort(longEdlCode, voiceoverAudioFile = null) {
    logger.info('ShortsRepurposer', `Repurposing "${longEdlCode.title}" into 9:16 Vertical YouTube Short...`);

    const sourceScenes = Array.isArray(longEdlCode.scenes) ? longEdlCode.scenes : [];
    const sliced = sourceScenes.slice(0, 4);

    const shortScenes = sliced.map((scene, idx) => ({
      ...scene,
      sceneId: `short_${scene.sceneId || idx}`,
      durationSec: Math.min(scene.durationSec || 8, 12),
      type: idx === 0 ? 'hook' : (idx === sliced.length - 1 ? 'cta' : 'body')
    }));

    const shortEdl = {
      title: `${longEdlCode.title} #Shorts`.slice(0, 100),
      aspectRatio: '9:16',
      fps: longEdlCode.fps || 30,
      manualStudio: {
        ...(longEdlCode.manualStudio || {}),
        voiceoverAudioFile: voiceoverAudioFile || longEdlCode.manualStudio?.voiceoverAudioFile || null
      },
      scenes: shortScenes
    };

    const compiledShort = codeVideoEditor.validateAndCompileEDL(shortEdl, {
      saveRecord: false,
      writeSrt: false
    });
    const renderResult = await codeVideoEditor.executeRender(compiledShort);

    logger.success('ShortsRepurposer', `9:16 YouTube Short ready (${compiledShort.totalDurationSec}s, rendered: ${renderResult.rendered}).`);
    return {
      ...compiledShort,
      renderResult
    };
  }
}

export const shortsRepurposer = new ShortsRepurposingService();
