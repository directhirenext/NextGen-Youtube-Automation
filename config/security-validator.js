import dotenv from 'dotenv';
import crypto from 'crypto';
import { z } from 'zod';
import { crossOS } from '../utils/cross-os-adapter.js';

dotenv.config();

const WEAK_SECRETS = new Set([
  'change_this_to_a_strong_random_key_32_chars',
  'secret',
  'password',
  '1234567890',
  ''
]);

const envSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DASHBOARD_SECRET_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(['gemini', 'openai', 'anthropic']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: z.string().optional(),
  MCP_ENABLED: z.string().default('true').transform((val) => val === 'true'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFMPEG_TIMEOUT_MS: z.string().default('45000').transform(Number),
  VIDEO_OUTPUT_FPS: z.string().default('30').transform(Number),
  VIDEO_RESOLUTION: z.string().regex(/^\d{3,4}x\d{3,4}$/).default('1920x1080')
});

let cachedConfig = null;

export function loadValidatedConfig() {
  if (cachedConfig) return cachedConfig;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ [CRITICAL CONFIG ERROR]: Invalid .env parameters:', parsed.error.format());
    process.exit(1);
  }

  const data = parsed.data;
  const rawSecret = (data.DASHBOARD_SECRET_KEY || '').trim();

  if (WEAK_SECRETS.has(rawSecret) || rawSecret.length < 32) {
    if (data.NODE_ENV === 'production') {
      console.error('❌ [ZERO-TOLERANCE SECURITY]: Weak or default DASHBOARD_SECRET_KEY is strictly forbidden in production!');
      process.exit(1);
    }
    data.DASHBOARD_SECRET_KEY = crypto.randomBytes(32).toString('hex');
  }

  data.YOUTUBE_REDIRECT_URI = crossOS.resolveDynamicOAuthRedirectUri(data.PORT, data.YOUTUBE_REDIRECT_URI);
  cachedConfig = Object.freeze(data);
  return cachedConfig;
}

export function sanitizeShellArg(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/[;&|`$<>\\!#%*?~{}[\]()'"\n\r]/g, '').trim();
}

export function escapeXml(unsafe) {
  if (typeof unsafe !== 'string') return '';
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

export function validateSafeExternalUrl(urlString) {
  if (urlString.startsWith('internal://')) return true;
  try {
    const u = new URL(urlString);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    // Block SSRF to loopback, metadata & private LAN ranges
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('169.254.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
