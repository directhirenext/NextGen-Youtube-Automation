import { z } from 'zod';
import { aiTextService } from '../utils/ai-text-service.js';
import { logger } from '../utils/logger.js';

const sceneItemSchema = z.object({
  sceneId: z.string().min(1).max(64),
  type: z.enum(['hook', 'intro', 'body', 'broll', 'cta']),
  durationSec: z.number().min(10).max(120),
  captionText: z.string().min(2).max(180),
  narrationText: z.string().min(5).max(600).optional(),
  bgColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#0f172a'),
  textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#38bdf8'),
  transition: z.enum(['fade', 'cut', 'slide']).default('fade')
});

const scriptOutputSchema = z.object({
  fullNarration: z.string().min(20),
  scenes: z.array(sceneItemSchema).min(3).max(20)
});

export class ScriptWriterAgent {
  async writeScriptAndEDL(strategy, aspectRatio = '16:9') {
    logger.info('ScriptWriterAgent', `Writing script & multi-scene EDL for: "${strategy.selectedTopic}"`);

    const systemPrompt =
      'You are a YouTube Scriptwriter & Video Director for an Indian audience (natural Hinglish/Hindi or English). ' +
      'Return JSON with keys: fullNarration (string) and scenes (array of at least 3 objects, each having durationSec >= 10: ' +
      '{sceneId, type: "hook"|"intro"|"body"|"broll"|"cta", durationSec, captionText, narrationText, bgColor (6-digit hex like #0f172a), textColor (6-digit hex like #38bdf8), transition: "fade"|"cut"|"slide"}).';

    const userPrompt = `Topic: ${strategy.selectedTopic}. Hook: ${strategy.hookIdea}. Aspect Ratio: ${aspectRatio}. Write a clear, engaging script with 4 scenes (each 10 to 15 seconds).`;

    const fallback = {
      fullNarration: `${strategy.hookIdea} आज के इस वीडियो में हम बात करेंगे ${strategy.selectedTopic} के बारे में। हम देखेंगे कि इसके लिए कौन-कौन से कैंडिडेट्स योग्य हैं, ज़रूरी डॉक्यूमेंट्स क्या हैं, और आप ऑफिशियल वेबसाइट से सीधे कैसे फॉर्म भर सकते हैं। पूरी जानकारी के लिए वीडियो को अंत तक देखें और चैनल को सब्सक्राइब ज़रूर करें।`,
      scenes: [
        {
          sceneId: 'scene_hook',
          type: 'hook',
          durationSec: 10,
          captionText: strategy.hookIdea.slice(0, 120),
          narrationText: strategy.hookIdea,
          bgColor: '#0f172a',
          textColor: '#38bdf8',
          transition: 'fade'
        },
        {
          sceneId: 'scene_intro',
          type: 'intro',
          durationSec: 12,
          captionText: `${strategy.selectedTopic.slice(0, 90)} — मुख्य जानकारी`,
          narrationText: `आज के इस वीडियो में हम विस्तार से समझेंगे ${strategy.selectedTopic} के सभी ज़रूरी पॉइंट्स।`,
          bgColor: '#1e1b4b',
          textColor: '#facc15',
          transition: 'slide'
        },
        {
          sceneId: 'scene_body',
          type: 'body',
          durationSec: 14,
          captionText: 'योग्यता, ज़रूरी डॉक्यूमेंट्स और सिलेक्शन प्रोसेस',
          narrationText: 'सबसे पहले अपनी योग्यता और डॉक्यूमेंट्स चेक करें और केवल आधिकारिक पोर्टल पर ही आवेदन करें।',
          bgColor: '#172554',
          textColor: '#ffffff',
          transition: 'fade'
        },
        {
          sceneId: 'scene_cta',
          type: 'cta',
          durationSec: 10,
          captionText: 'ऑफिशियल प्रोसेस के लिए डिस्क्रिप्शन देखें • Subscribe करें!',
          narrationText: 'पूरी स्टेप-बाय-स्टेप गाइड डिस्क्रिप्शन में दी गई है। रोज़ाना अपडेट्स के लिए चैनल को सब्सक्राइब करें।',
          bgColor: '#090d16',
          textColor: '#4ade80',
          transition: 'cut'
        }
      ]
    };

    const scriptData = await aiTextService.generateStructuredJSON(systemPrompt, userPrompt, fallback, scriptOutputSchema);
    logger.success('ScriptWriterAgent', `Generated script with ${scriptData.scenes.length} validated scenes.`);
    return scriptData;
  }

  async reviseScriptWithFeedback(currentScript, currentTitle, userFeedback) {
    logger.info('ScriptWriterAgent', `Revising script based on user feedback: "${userFeedback}"`);

    const systemPrompt =
      'You are an interactive YouTube Script & EDL Revision Editor. Modify the provided script and scenes according to the user feedback. ' +
      'Return JSON with keys: fullNarration (string) and scenes (array of at least 3 scene objects, each durationSec >= 10, with 6-digit hex bgColor and textColor).';

    const userPrompt =
      `Video Title: ${currentTitle}\n` +
      `Current Narration: ${currentScript.fullNarration}\n` +
      `Current Scenes JSON: ${JSON.stringify(currentScript.scenes)}\n` +
      `User Revision Instruction: "${userFeedback}"\n` +
      'Apply the requested changes accurately and return the updated JSON.';

    const modifiedFallback = structuredClone(currentScript);
    modifiedFallback.fullNarration = `${currentScript.fullNarration} (${userFeedback})`;
    if (modifiedFallback.scenes.length > 0) {
      modifiedFallback.scenes[0].captionText = userFeedback.slice(0, 120);
    }

    return await aiTextService.generateStructuredJSON(systemPrompt, userPrompt, modifiedFallback, scriptOutputSchema);
  }
}

export const scriptWriterAgent = new ScriptWriterAgent();
