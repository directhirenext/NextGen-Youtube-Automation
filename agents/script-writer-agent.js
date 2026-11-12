import { aiTextService } from '../utils/ai-text-service.js';
import { logger } from '../utils/logger.js';

export class ScriptWriterAgent {
  async writeScriptAndScenes(strategyPlan) {
    logger.info('ScriptWriterAgent', `Writing script and EDL scenes for: "${strategyPlan.selectedTopic}"`);

    const systemPrompt = 'You are a YouTube Scriptwriter. Output JSON with keys: title, fullNarration, and scenes (array of sceneId, type, durationSec, captionText, bgColor, textColor, transition).';
    const userPrompt = `Write a script for topic: ${strategyPlan.selectedTopic}. Hook: ${strategyPlan.hookIdea}`;

    const fallback = {
      title: strategyPlan.selectedTopic,
      fullNarration: `${strategyPlan.hookIdea} Welcome back! Today we cover verified opportunities, eligibility criteria, and direct application steps. Check the description link and subscribe!`,
      scenes: [
        {
          sceneId: 'scene_1',
          type: 'hook',
          durationSec: 5,
          captionText: strategyPlan.hookIdea.slice(0, 100),
          bgColor: '#0f172a',
          textColor: '#38bdf8',
          transition: 'fade'
        },
        {
          sceneId: 'scene_2',
          type: 'intro',
          durationSec: 6,
          captionText: `Topic: ${strategyPlan.selectedTopic.slice(0, 80)}`,
          bgColor: '#1e1b4b',
          textColor: '#f8fafc',
          transition: 'slide'
        },
        {
          sceneId: 'scene_3',
          type: 'body',
          durationSec: 10,
          captionText: 'Eligibility, Salary Package & Direct Walk-in / Online Apply Breakdown',
          bgColor: '#090d16',
          textColor: '#4ade80',
          transition: 'cut'
        },
        {
          sceneId: 'scene_4',
          type: 'cta',
          durationSec: 5,
          captionText: 'Subscribe & Check Direct Link in Description!',
          bgColor: '#450a0a',
          textColor: '#facc15',
          transition: 'fade'
        }
      ]
    };

    const scriptData = await aiTextService.generateStructuredJSON(systemPrompt, userPrompt, fallback);
    logger.success('ScriptWriterAgent', `Generated script with ${scriptData.scenes?.length || 4} scenes.`);
    return scriptData;
  }
}

export const scriptWriterAgent = new ScriptWriterAgent();
        
