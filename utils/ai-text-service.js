import { loadValidatedConfig } from '../config/security-validator.js';
import { logger } from './logger.js';

export class AITextService {
  constructor() {
    this.config = loadValidatedConfig();
  }

  async generateStructuredJSON(systemPrompt, userPrompt, fallbackTemplate = {}) {
    const provider = this.config.AI_PROVIDER;
    try {
      if (provider === 'gemini' && this.config.GEMINI_API_KEY && !this.config.GEMINI_API_KEY.includes('your_')) {
        return await this._callGemini(systemPrompt, userPrompt);
      }
      if (provider === 'openai' && this.config.OPENAI_API_KEY && !this.config.OPENAI_API_KEY.includes('your_')) {
        return await this._callOpenAI(systemPrompt, userPrompt);
      }
      logger.info('AITextService', `Using built-in deterministic engine (No live ${provider} API key set).`);
      return fallbackTemplate;
    } catch (err) {
      logger.warn('AITextService', `LLM API call failed (${err.message}). Returning resilient fallback.`);
      return fallbackTemplate;
    }
  }

  async _callGemini(systemPrompt, userPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.config.GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4 }
      })
    });
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return JSON.parse(text);
  }

  async _callOpenAI(systemPrompt, userPrompt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  }
}

export const aiTextService = new AITextService();
                            
