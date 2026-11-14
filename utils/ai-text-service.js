import { loadValidatedConfig, validateSafeExternalUrl } from '../config/security-validator.js';
import { logger } from './logger.js';

const PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  together: 'https://api.together.xyz/v1/chat/completions'
};

export class AITextService {
  constructor() {
    this.config = loadValidatedConfig();
    this.runtimeOverrides = {
      provider: null,
      customBaseUrl: null,
      customApiKey: null,
      customModel: null
    };
    this.telemetry = {
      totalCalls: 0,
      successfulCalls: 0,
      failoverSwitches: 0,
      estimatedTokensUsed: 0,
      lastProviderUsed: this.config.AI_PROVIDER,
      lastLatencyMs: 0
    };
  }

  configureUniversalProvider({ provider, baseUrl, apiKey, model } = {}) {
    if (baseUrl && !validateSafeExternalUrl(baseUrl)) {
      throw new Error('Blocked by SSRF Guard: Custom AI Base URL must be a public HTTPS/HTTP endpoint.');
    }
    if (provider) this.runtimeOverrides.provider = provider;
    if (baseUrl !== undefined) this.runtimeOverrides.customBaseUrl = baseUrl;
    if (apiKey !== undefined) this.runtimeOverrides.customApiKey = apiKey;
    if (model !== undefined) this.runtimeOverrides.customModel = model;

    logger.success('UniversalAI', `Updated runtime AI provider to "${this.getActiveProvider()}" (${model || 'default model'})`);
    return this.getTelemetryAndConfig();
  }

  getActiveProvider() {
    return this.runtimeOverrides.provider || this.config.AI_PROVIDER;
  }

  getTelemetryAndConfig() {
    return {
      activeProvider: this.getActiveProvider(),
      customModel: this.runtimeOverrides.customModel || null,
      customBaseUrl: this.runtimeOverrides.customBaseUrl || null,
      hasCustomRuntimeKey: Boolean(this.runtimeOverrides.customApiKey),
      failoverChain: this.config.AI_FAILOVER_CHAIN.split(',').map(s => s.trim()).filter(Boolean),
      telemetry: this.telemetry
    };
  }

  _isPlaceholderKey(key) {
    return !key || key.includes('your_') || key.trim().length < 8;
  }

  _resolveProviderCredentials(provider) {
    if (this.runtimeOverrides.customApiKey && !this._isPlaceholderKey(this.runtimeOverrides.customApiKey)) {
      return {
        apiKey: this.runtimeOverrides.customApiKey,
        model: this.runtimeOverrides.customModel || 'gpt-4o-mini',
        endpoint: this.runtimeOverrides.customBaseUrl || PROVIDER_ENDPOINTS[provider] || this.config.CUSTOM_AI_BASE_URL
      };
    }

    switch (provider) {
      case 'gemini':
        return { apiKey: this.config.GEMINI_API_KEY, model: this.config.GEMINI_MODEL };
      case 'openai':
        return { apiKey: this.config.OPENAI_API_KEY, model: this.config.OPENAI_MODEL, endpoint: PROVIDER_ENDPOINTS.openai };
      case 'anthropic':
        return { apiKey: this.config.ANTHROPIC_API_KEY, model: this.config.ANTHROPIC_MODEL };
      case 'openrouter':
        return { apiKey: this.config.OPENROUTER_API_KEY, model: this.config.OPENROUTER_MODEL, endpoint: PROVIDER_ENDPOINTS.openrouter };
      case 'groq':
        return { apiKey: this.config.GROQ_API_KEY, model: this.config.GROQ_MODEL, endpoint: PROVIDER_ENDPOINTS.groq };
      case 'deepseek':
        return { apiKey: this.config.DEEPSEEK_API_KEY, model: this.config.DEEPSEEK_MODEL, endpoint: PROVIDER_ENDPOINTS.deepseek };
      case 'custom':
      default:
        return {
          apiKey: this.config.CUSTOM_AI_API_KEY,
          model: this.config.CUSTOM_AI_MODEL,
          endpoint: this.config.CUSTOM_AI_BASE_URL || PROVIDER_ENDPOINTS.openai
        };
    }
  }

  async generateStructuredJSON(systemPrompt, userPrompt, fallbackTemplate = {}) {
    this.telemetry.totalCalls += 1;
    const startMs = Date.now();

    const primary = this.getActiveProvider();
    const chain = [
      primary,
      ...this.config.AI_FAILOVER_CHAIN.split(',').map(s => s.trim()).filter(p => p && p !== primary)
    ];

    for (let i = 0; i < chain.length; i++) {
      const provider = chain[i];
      const creds = this._resolveProviderCredentials(provider);

      if (this._isPlaceholderKey(creds.apiKey)) {
        continue;
      }

      try {
        let result = null;
        if (provider === 'gemini') {
          result = await this._callGemini(creds.apiKey, creds.model, systemPrompt, userPrompt);
        } else if (provider === 'anthropic') {
          result = await this._callAnthropic(creds.apiKey, creds.model, systemPrompt, userPrompt);
        } else {
          result = await this._callOpenAICompatible(creds.endpoint, creds.apiKey, creds.model, systemPrompt, userPrompt);
        }

        if (i > 0) this.telemetry.failoverSwitches += 1;
        this.telemetry.successfulCalls += 1;
        this.telemetry.lastProviderUsed = provider;
        this.telemetry.lastLatencyMs = Date.now() - startMs;
        this.telemetry.estimatedTokensUsed += Math.ceil((systemPrompt.length + userPrompt.length + JSON.stringify(result).length) / 4);
        return result;
      } catch (err) {
        logger.warn('UniversalAI', `Provider "${provider}" failed (${err.message}). Checking next in failover chain...`);
      }
    }

    this.telemetry.lastProviderUsed = 'deterministic-fallback';
    this.telemetry.lastLatencyMs = Date.now() - startMs;
    logger.info('UniversalAI', 'Using built-in deterministic fallback engine (No live API keys active).');
    return fallbackTemplate;
  }

  async _callGemini(apiKey, model, systemPrompt, userPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4 }
        })
      });
      if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return JSON.parse(this._extractJsonText(text));
    } finally {
      clearTimeout(timer);
    }
  }

  async _callAnthropic(apiKey, model, systemPrompt, userPrompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          max_tokens: 1500,
          system: `${systemPrompt} Always respond with valid JSON only.`,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });
      if (!response.ok) throw new Error(`Anthropic HTTP ${response.status}`);
      const data = await response.json();
      const text = data?.content?.[0]?.text || '{}';
      return JSON.parse(this._extractJsonText(text));
    } finally {
      clearTimeout(timer);
    }
  }

  async _callOpenAICompatible(endpoint, apiKey, model, systemPrompt, userPrompt) {
    if (!validateSafeExternalUrl(endpoint)) {
      throw new Error('Unsafe endpoint blocked by SSRF policy');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: `${systemPrompt} Respond strictly in valid JSON format.` },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.4
        })
      });
      if (!response.ok) throw new Error(`Universal API HTTP ${response.status}`);
      const data = await response.json();
      const rawText = data?.choices?.[0]?.message?.content || '{}';
      return JSON.parse(this._extractJsonText(rawText));
    } finally {
      clearTimeout(timer);
    }
  }

  _extractJsonText(text = '') {
    const cleaned = String(text).trim();
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return match ? match[1].trim() : cleaned;
  }
}

export const aiTextService = new AITextService();
    
