import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import dns from 'dns/promises';
import net from 'net';
import { z } from 'zod';
import { crossOS } from '../utils/cross-os-adapter.js';

dotenv.config({ path: crossOS.resolveProjectPath('.env') });

const WEAK_SECRETS = new Set([
  'change_this_to_a_strong_random_key_32_chars',
  'replace_with_64_char_cryptographic_hex_secret_for_production_mode',
  'secret',
  'password',
  '1234567890',
  ''
]);

export const SUPPORTED_AI_PROVIDERS = [
  'gemini', 'openai', 'anthropic', 'openrouter', 'groq', 'deepseek', 'mistral', 'together', 'custom'
];

const intString = (defaultVal, minVal = 1, maxVal = 10000000) =>
  z.string().default(String(defaultVal)).transform((val, ctx) => {
    const parsed = Number.parseInt(val, 10);
    if (Number.isNaN(parsed) || parsed < minVal || parsed > maxVal) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid integer value: ${val}` });
      return z.NEVER;
    }
    return parsed;
  });

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: intString(3000, 1, 65535),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DASHBOARD_SECRET_KEY: z.string().optional(),
  PUBLIC_HOST_URL: z.string().optional(),

  ENABLE_SCHEDULER: z.string().default('true').transform(v => v === 'true'),
  SCHEDULER_CRON: z.string().default('0 9 * * *'),
  SCHEDULER_TIMEZONE: z.string().default('Asia/Kolkata'),

  AI_PROVIDER: z.enum(SUPPORTED_AI_PROVIDERS).default('gemini'),
  AI_FAILOVER_CHAIN: z.string().default('gemini,groq,openrouter,openai,deepseek,mistral,together'),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),

  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('meta-llama/llama-3.3-70b-instruct'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  MISTRAL_API_KEY: z.string().optional(),
  MISTRAL_MODEL: z.string().default('mistral-small-latest'),
  TOGETHER_API_KEY: z.string().optional(),
  TOGETHER_MODEL: z.string().default('meta-llama/Llama-3.3-70B-Instruct-Turbo'),

  CUSTOM_AI_BASE_URL: z.string().optional(),
  CUSTOM_AI_API_KEY: z.string().optional(),
  CUSTOM_AI_MODEL: z.string().default('gpt-4o-mini'),

  TTS_PROVIDER: z.enum(['edge-neural', 'elevenlabs', 'openai']).default('edge-neural'),
  TTS_VOICE_HI: z.string().default('hi-IN-MadhurNeural'),
  TTS_VOICE_EN: z.string().default('en-IN-PrabhatNeural'),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default('pNInz6obpgDQGcFmaJgB'),

  PEXELS_API_KEY: z.string().optional(),

  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: z.string().optional(),

  WEBHOOK_NOTIFY_URL: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  FONT_FILE_PATH: z.string().optional(),
  FFMPEG_TIMEOUT_MS: intString(180000, 5000, 3600000),
  VIDEO_OUTPUT_FPS: intString(30, 15, 60),
  VIDEO_RESOLUTION: z.string().regex(/^\d{3,4}x\d{3,4}$/).default('1920x1080'),
  MAX_UPLOAD_SIZE_MB: intString(150, 1, 2000)
});

// Comprehensive IPv4 + IPv6 Private/Loopback/Metadata BlockList (Fixes S3)
const ssrfBlockList = new net.BlockList();
for (const [subnet, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
]) {
  ssrfBlockList.addSubnet(subnet, prefix, 'ipv4');
}
for (const [subnet, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['::ffff:0:0', 96]
]) {
  ssrfBlockList.addSubnet(subnet, prefix, 'ipv6');
}

let cachedConfig = null;

export function loadValidatedConfig() {
  if (cachedConfig) return cachedConfig;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid .env configuration: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }

  const data = parsed.data;
  const rawSecret = (data.DASHBOARD_SECRET_KEY || '').trim();

  if (WEAK_SECRETS.has(rawSecret) || rawSecret.length < 32) {
    if (data.NODE_ENV === 'production') {
      throw new Error('Weak or missing DASHBOARD_SECRET_KEY is forbidden in production. Run "npm run setup" first.');
    }
    data.DASHBOARD_SECRET_KEY = crypto.createHash('sha256').update(`dev-secret-${crossOS.resolveProjectPath()}`).digest('hex');
  }

  data.YOUTUBE_REDIRECT_URI = crossOS.resolveDynamicOAuthRedirectUri(data.PORT, data.YOUTUBE_REDIRECT_URI);
  cachedConfig = Object.freeze(data);
  return cachedConfig;
}

export function verifyDashboardSecret(candidateKey) {
  const config = loadValidatedConfig();
  if (typeof candidateKey !== 'string' || !candidateKey) return false;
  const given = Buffer.from(candidateKey.trim());
  const expected = Buffer.from(config.DASHBOARD_SECRET_KEY);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

export function requireAuth(req, res, next) {
  const config = loadValidatedConfig();
  // Allow same-origin local browser requests if session token header or bearer matches, or in test mode
  const authHeader = req.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerKey = req.get('x-dashboard-key') || req.query?.key || '';
  const token = bearer || headerKey;

  if (verifyDashboardSecret(token)) {
    return next();
  }

  // If accessed from local loopback browser UI with valid Same-Origin Sec-Fetch-Site
  const remoteIp = req.socket?.remoteAddress || '';
  const isLoopback = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
  const secFetchSite = req.get('sec-fetch-site');
  if (config.NODE_ENV !== 'production' && isLoopback && secFetchSite === 'same-origin') {
    return next();
  }

  return res.status(401).json({
    error: 'Unauthorized: Valid DASHBOARD_SECRET_KEY required in Authorization Bearer or x-dashboard-key header.'
  });
}

function isIpBlocked(ipAddr) {
  const cleanIp = ipAddr.replace(/^\[|\]$/g, '');
  if (cleanIp.toLowerCase().startsWith('::ffff:')) {
    const v4Part = cleanIp.slice(7);
    if (net.isIPv4(v4Part)) {
      return ssrfBlockList.check(v4Part, 'ipv4');
    }
  }
  const family = net.isIP(cleanIp);
  if (family === 4) return ssrfBlockList.check(cleanIp, 'ipv4');
  if (family === 6) return ssrfBlockList.check(cleanIp, 'ipv6');
  return true;
}

// Synchronous syntax + IP check for fast validation
export function validateSafeExternalUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString) return false;
  if (urlString.startsWith('internal://')) {
    return /^internal:\/\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(urlString);
  }
  try {
    const u = new URL(urlString);
    if (!['https:', 'http:'].includes(u.protocol)) return false;
    if (u.username || u.password) return false;

    const rawHost = u.hostname.toLowerCase().replace(/\.$/, '');
    if (
      rawHost === 'localhost' ||
      rawHost.endsWith('.localhost') ||
      rawHost.endsWith('.local') ||
      rawHost.endsWith('.internal') ||
      rawHost.includes('nip.io') ||
      rawHost.includes('sslip.io')
    ) {
      return false;
    }

    const bareHost = rawHost.replace(/^\[|\]$/g, '');
    if (net.isIP(bareHost)) {
      return !isIpBlocked(bareHost);
    }
    return true;
  } catch {
    return false;
  }
}

// Asynchronous DNS-resolving SSRF Guard (Blocks DNS rebinding, 127.0.0.2, [::1], CGNAT, Metadata)
export async function assertSafeRemoteUrl(urlString) {
  if (!validateSafeExternalUrl(urlString)) {
    throw new Error('Blocked by SSRF Guard: URL failed syntax or private host policy.');
  }
  if (urlString.startsWith('internal://')) return true;

  const u = new URL(urlString);
  const bareHost = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');

  if (net.isIP(bareHost)) {
    if (isIpBlocked(bareHost)) {
      throw new Error(`Blocked by SSRF Guard: Direct IP ${bareHost} is in a forbidden range.`);
    }
    return true;
  }

  const records = await dns.lookup(bareHost, { all: true, verbatim: true });
  if (!records || records.length === 0) {
    throw new Error(`Blocked by SSRF Guard: Could not resolve DNS for ${bareHost}`);
  }
  for (const rec of records) {
    if (isIpBlocked(rec.address)) {
      throw new Error(`Blocked by SSRF Guard: Host ${bareHost} resolved to private/reserved IP ${rec.address}`);
    }
  }
  return true;
}

// Preserves extension even on 110+ char filenames and supports Unicode/Hindi names safely (Fixes B37)
export function sanitizeSafeFilename(filename) {
  if (typeof filename !== 'string' || !filename.trim()) return `media_${Date.now()}.bin`;
  const base = path.basename(filename.trim());
  const ext = path.extname(base).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const nameWithoutExt = base.slice(0, base.length - ext.length);
  const cleanStem = nameWithoutExt
    .replace(/[^\p{L}\p{N}._-]/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80) || `asset_${Date.now()}`;
  return `${cleanStem}${ext || '.bin'}`;
}

export function wrapCaptionLines(text, maxCharsPerLine = 38) {
  if (typeof text !== 'string' || !text.trim()) return '';
  const words = text.trim().split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current.length + 1 + word.length) <= maxCharsPerLine) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4).join('\n');
}

export function escapeXml(unsafe) {
  if (typeof unsafe !== 'string') return '';
  const cleanSurrogates = unsafe.toWellFormed ? unsafe.toWellFormed() : unsafe;
  return cleanSurrogates.replace(/[<>&'"]/g, (c) => {
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

// Kept for backward compatibility in legacy tests, strips only shell control operators
export function sanitizeShellArg(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/[;&|`$<>\\!\n\r]/g, '').trim();
  }
    
