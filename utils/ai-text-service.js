import { z } from 'zod';
import {
  loadValidatedConfig,
  SUPPORTED_AI_PROVIDERS,
  validateSafeExternalUrl,
  assertSafeRemoteUrl
} from '../config/security-validator.js';
import { logger } from './logger.js';

const PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  together: 'https://api.together.xyz/v1/chat/completions'
};

const runtimeConfigSchema = z.object({
  provider: z.enum(SUPPORTED_AI_PROVIDERS),
  model: z.string().min(1).max(120).optional(),
  baseUrl: z.string().max(300).optional(),
  apiKey: z.string().min(8).max(300).optional()
});

export class AITextService {
  constructor() {
    this.config = loadValidatedConfig();
    this.activeProvider = this.config.AI_PROVIDER;
    // Per-provider scoped overrides so keys NEVER leak across providers (Fixes S4)
    this.providerOverrides = new Map();
    this.telemetry = {
      totalCalls: 0,
      successfulCalls: 0,
      failoverSwitches: 0,
      estimatedTokensUsed: 0,
      lastProviderUsed: this.config.AI_PROVIDER,
      lastLatencyMs: 0
    };
  }

  configureUniversalProvider(rawInput = {}) {
    const parsed = runtimeConfigSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid AI configuration: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
    }

    const { provider, model, baseUrl, apiKey } = parsed.data;
    if (baseUrl && !validateSafeExternalUrl(baseUrl)) {
      throw new Error('Blocked by SSRF Guard: Custom AI Base URL must be a valid public HTTPS/HTTP endpoint.');
    }

    this.activeProvider = provider;
    const existing = this.providerOverrides.get(provider) || {};
    this.providerOverrides.set(provider, {
      model: model || existing.model || null,
      baseUrl: baseUrl || existing.baseUrl || null,
      apiKey: apiKey || existing.apiKey || null
    });

    logger.success('UniversalAI', `Configured scoped AI provider "${provider}" (${model || 'default model'})`);
    return this.getTelemetryAndConfig();
  }

  resetRuntimeOverrides() {
    this.activeProvider = this.config.AI_PROVIDER;
    this.providerOverrides.clear();
  }

  getActiveProvider() {
    return this.activeProvider || this.config.AI_PROVIDER;
  }

  getTelemetryAndConfig() {
    const active = this.getActiveProvider();
    const scoped = this.providerOverrides.get(active) || {};
    return {
      activeProvider: active,
      customModel: scoped.model || null,
      customBaseUrl: scoped.baseUrl || null,
      hasCustomRuntimeKey: Boolean(scoped.apiKey),
      failoverChain: this.config.AI_FAILOVER_CHAIN.split(',').map(s => s.trim()).filter(Boolean),
      telemetry: { ...this.telemetry }
    };
  }

  _isPlaceholderKey(key) {
    if (typeof key !== 'string') return true;
    const trimmed = key.trim();
    return !trimmed || trimmed.includes('your_') || trimmed.length < 8;
  }

  _resolveProviderCredentials(provider) {
    const scoped = this.providerOverrides.get(provider) || {};
    let envKey = '';
    let envModel = '';
    let defaultEndpoint = PROVIDER_ENDPOINTS[provider] || '';

    switch (provider) {
      case 'gemini':
        envKey = this.config.GEMINI_API_KEY;
        envModel = this.config.GEMINI_MODEL;
        break;
      case 'openai':
        envKey = this.config.OPENAI_API_KEY;
        envModel = this.config.OPENAI_MODEL;
        break;
      case 'anthropic':
        envKey = this.config.ANTHROPIC_API_KEY;
        envModel = this.config.ANTHROPIC_MODEL;
        break;
      case 'openrouter':
        envKey = this.config.OPENROUTER_API_KEY;
        envModel = this.config.OPENROUTER_MODEL;
        break;
      case 'groq':
        envKey = this.config.GROQ_API_KEY;
        envModel = this.config.GROQ_MODEL;
        break;
      case 'deepseek':
        envKey = this.config.DEEPSEEK_API_KEY;
        envModel = this.config.DEEPSEEK_MODEL;
        break;
      case 'mistral':
        envKey = this.config.MISTRAL_API_KEY;
        envModel = this.config.MISTRAL_MODEL;
        break;
      case 'together':
        envKey = this.config.TOGETHER_API_KEY;
        envModel = this.config.TOGETHER_MODEL;
        break;
      case 'custom':
        envKey = this.config.CUSTOM_AI_API_KEY;
        envModel = this.config.CUSTOM_AI_MODEL;
        defaultEndpoint = this.config.CUSTOM_AI_BASE_URL || PROVIDER_ENDPOINTS.openai;
        break;
      default:
        return { apiKey: '', model: '', endpoint: '' };
    }

    return {
      apiKey: scoped.apiKey || envKey || '',
      model: scoped.model || envModel,
      endpoint: scoped.baseUrl || defaultEndpoint
    };
  }

  async generateStructuredJSON(systemPrompt, userPrompt, fallbackTemplate = {}, zodSchema = null) {
    this.telemetry.totalCalls += 1;
    const startMs = Date.now();

    const primary = this.getActiveProvider();
    const chain = [
      primary,
      ...this.config.AI_FAILOVER_CHAIN
        .split(',')
        .map(s => s.trim())
        .filter(p => SUPPORTED_AI_PROVIDERS.includes(p) && p !== primary)
    ];

    let attemptedRealCall = false;

    for (const provider of chain) {
      try {
        const creds = this._resolveProviderCredentials(provider);
        if (this._isPlaceholderKey(creds.apiKey)) {
          continue;
        }

        const hadPreviousAttempt = attemptedRealCall;
        attemptedRealCall = true;

        let rawObj = null;
        if (provider === 'gemini') {
          rawObj = await this._callGemini(creds.apiKey, creds.model, systemPrompt, userPrompt);
        } else if (provider === 'anthropic') {
          rawObj = await this._callAnthropic(creds.apiKey, creds.model, systemPrompt, userPrompt);
        } else {
          rawObj = await this._callOpenAICompatible(creds.endpoint, creds.apiKey, creds.model, systemPrompt, userPrompt);
        }

        if (zodSchema) {
          const validated = zodSchema.safeParse(rawObj);
          if (!validated.success) {
            throw new Error(`LLM JSON failed schema validation: ${JSON.stringify(validated.error.flatten().fieldErrors)}`);
          }
          rawObj = validated.data;
        }

        if (hadPreviousAttempt) {
          this.telemetry.failoverSwitches += 1;
        }
        this.telemetry.successfulCalls += 1;
        this.telemetry.lastProviderUsed = provider;
        this.telemetry.lastLatencyMs = Date.now() - startMs;
        this.telemetry.estimatedTokensUsed += Math.ceil((systemPrompt.length + userPrompt.length + JSON.stringify(rawObj).length) / 3.5);
        return rawObj;
      } catch (err) {
        logger.warn('UniversalAI', `Provider "${provider}" failed (${err.message}). Checking next configured provider...`);
      }
    }

    this.telemetry.lastProviderUsed = 'deterministic-fallback';
    this.telemetry.lastLatencyMs = Date.now() - startMs;
    logger.info('UniversalAI', 'No live API key succeeded; returning verified structured template.');
    return structuredClone(fallbackTemplate);
  }

  async _callGemini(apiKey, model, systemPrompt, userPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        signal: controller.signal,
        redirect: 'manual',
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 4096 }
        })
      });
      if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      return JSON.parse(this._extractJsonText(text));
    } finally {
      clearTimeout(timer);
    }
  }

  async _callAnthropic(apiKey, model, systemPrompt, userPrompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        signal: controller.signal,
        redirect: 'manual',
        body: JSON.stringify({
          model,
          max_tokens: 4096,
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
    await assertSafeRemoteUrl(endpoint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal,
        redirect: 'manual',
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${systemPrompt} Respond strictly in valid JSON format.` },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.4
        })
      });
      if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
      const data = await response.json();
      const rawText = data?.choices?.[0]?.message?.content || '{}';
      return JSON.parse(this._extractJsonText(rawText));
    } finally {
      clearTimeout(timer);
    }
  }

  _extractJsonText(text = '') {
    // Strip reasoning <think>...</think> blocks from DeepSeek/R1 models (Fixes B18)
    const withoutThink = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const fenceMatch = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) return fenceMatch[1].trim();
    const firstBrace = withoutThink.indexOf('{');
    const lastBrace = withoutThink.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return withoutThink.slice(firstBrace, lastBrace + 1);
    }
    return withoutThink;
  }
}

export const aiTextService = new AITextService();
        
