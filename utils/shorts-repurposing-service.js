import { codeVideoEditor } from './ffmpeg.js';
import { logger } from './logger.js';

export class ShortsRepurposingService {
  convertLongEdlToShort(longEdlProject) {
    logger.info('ShortsRepurposer', `Repurposing "${longEdlProject.title}" into 9:16 Vertical Short...`);

    const sourceScenes = longEdlProject.edlCode?.scenes || longEdlProject.scenes || [];
    const shortScenes = sourceScenes.slice(0, 4).map((scene, idx) => ({
      sceneId: `short_s${idx + 1}`,
      type: idx === 0 ? 'hook' : idx === sourceScenes.length - 1 ? 'cta' : 'body',
      durationSec: Math.min(scene.durationSec || 5, 12),
      captionText: scene.captionText,
      bgColor: scene.bgColor || '#090d16',
      textColor: '#facc15',
      transition: 'cut'
    }));

    const shortEdl = {
      title: `${longEdlProject.title} #Shorts`,
      aspectRatio: '9:16',
      fps: 30,
      scenes: shortScenes.length > 0 ? shortScenes : [
        {
          sceneId: 'short_s1',
          type: 'hook',
          durationSec: 5,
          captionText: `Quick Breakdown: ${longEdlProject.title}`,
          bgColor: '#090d16',
          textColor: '#facc15',
          transition: 'cut'
        }
      ]
    };

    return codeVideoEditor.validateAndCompileEDL(shortEdl);
  }
}

export const shortsRepurposer = new ShortsRepurposingService();
