import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  AI_PROVIDER: z.enum(['gemini', 'openai', 'anthropic']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: z.string().url().default('http://localhost:3000/oauth2callback'),
  MCP_ENABLED: z.string().default('true').transform((val) => val === 'true'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  VIDEO_OUTPUT_FPS: z.string().default('30').transform(Number),
  VIDEO_RESOLUTION: z.string().regex(/^\d+x\d+$/).default('1920x1080')
});

export function loadValidatedConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ [CRITICAL CONFIG ERROR]: Invalid .env configuration:', parsed.error.format());
    process.exit(1);
  }
  return parsed.data;
}

export function sanitizeShellArg(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/[;&|`$<>\\]/g, '');
}
