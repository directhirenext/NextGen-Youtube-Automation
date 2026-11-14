import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { google } from 'googleapis';
import { loadValidatedConfig } from '../config/security-validator.js';
import { crossOS } from './cross-os-adapter.js';
import { logger } from './logger.js';

const CONFIG_DIR = crossOS.resolveProjectPath('config');
const TOKEN_PATH = path.join(CONFIG_DIR, 'token.json');

export class CredentialManager {
  constructor() {
    this.config = loadValidatedConfig();
    this.oauth2Client = null;
    this.pendingOAuthStates = new Map();
    crossOS.ensureDirectories([CONFIG_DIR]);
    this._initOAuth();
  }

  _initOAuth() {
    if (
      this.config.YOUTUBE_CLIENT_ID &&
      this.config.YOUTUBE_CLIENT_SECRET &&
      !this.config.YOUTUBE_CLIENT_ID.includes('your_')
    ) {
      this.oauth2Client = new google.auth.OAuth2(
        this.config.YOUTUBE_CLIENT_ID,
        this.config.YOUTUBE_CLIENT_SECRET,
        this.config.YOUTUBE_REDIRECT_URI
      );

      this.oauth2Client.on('tokens', (newTokens) => {
        try {
          const existing = fs.existsSync(TOKEN_PATH)
            ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'))
            : {};
          const merged = { ...existing, ...newTokens };
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2), { encoding: 'utf-8', mode: 0o600 });
          logger.info('CredentialManager', 'Auto-refreshed and persisted YouTube OAuth2 token.');
        } catch (err) {
          logger.warn('CredentialManager', `Failed to persist refreshed token: ${err.message}`);
        }
      });

      if (fs.existsSync(TOKEN_PATH)) {
        try {
          const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
          this.oauth2Client.setCredentials(token);
          logger.success('CredentialManager', 'Loaded saved YouTube OAuth2 token.');
        } catch {
          logger.warn('CredentialManager', 'Could not parse saved token.json');
        }
      }
    }
  }

  getDynamicRedirectUri() {
    return this.config.YOUTUBE_REDIRECT_URI;
  }

  getAuthStatus() {
    const hasValidAiKey = Boolean(
      (this.config.GEMINI_API_KEY && !this.config.GEMINI_API_KEY.includes('your_')) ||
      (this.config.OPENAI_API_KEY && !this.config.OPENAI_API_KEY.includes('your_')) ||
      (this.config.ANTHROPIC_API_KEY && !this.config.ANTHROPIC_API_KEY.includes('your_')) ||
      (this.config.OPENROUTER_API_KEY && !this.config.OPENROUTER_API_KEY.includes('your_')) ||
      (this.config.GROQ_API_KEY && !this.config.GROQ_API_KEY.includes('your_')) ||
      (this.config.DEEPSEEK_API_KEY && !this.config.DEEPSEEK_API_KEY.includes('your_')) ||
      (this.config.MISTRAL_API_KEY && !this.config.MISTRAL_API_KEY.includes('your_')) ||
      (this.config.TOGETHER_API_KEY && !this.config.TOGETHER_API_KEY.includes('your_'))
    );

    const ffmpegCheck = crossOS.resolveFFmpegBinary(this.config.FFMPEG_PATH);
    const ffprobeCheck = crossOS.resolveFFprobeBinary(this.config.FFPROBE_PATH);
    const fontPath = crossOS.resolveDevanagariFontPath(this.config.FONT_FILE_PATH);

    return {
      aiProvider: this.config.AI_PROVIDER,
      hasAiKey: hasValidAiKey,
      hasYouTubeCredentials: Boolean(this.oauth2Client),
      isYouTubeAuthorized: Boolean(this.oauth2Client && (this.oauth2Client.credentials?.access_token || this.oauth2Client.credentials?.refresh_token)),
      resolvedRedirectUri: this.config.YOUTUBE_REDIRECT_URI,
      ffmpegAvailable: ffmpegCheck.available,
      ffprobeAvailable: ffprobeCheck.available,
      devanagariFontReady: Boolean(fontPath),
      osProfile: crossOS.getEnvironmentProfile()
    };
  }

  generateYouTubeAuthUrl() {
    if (!this.oauth2Client) {
      throw new Error('YouTube Client ID & Secret are not configured in .env');
    }
    const state = crypto.randomBytes(24).toString('hex');
    const redirectUri = this.getDynamicRedirectUri();
    this.pendingOAuthStates.set(state, {
      redirectUri,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      state,
      redirect_uri: redirectUri,
      scope: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube.force-ssl',
        'https://www.googleapis.com/auth/youtube.readonly'
      ]
    });
  }

  async saveOAuthCode(code, state) {
    if (!this.oauth2Client) throw new Error('OAuth2 client not initialized');
    if (!state || !this.pendingOAuthStates.has(state)) {
      throw new Error('Invalid or expired OAuth state parameter (CSRF protection). Please start authorization again from the dashboard.');
    }
    const stateData = this.pendingOAuthStates.get(state);
    this.pendingOAuthStates.delete(state);
    if (Date.now() > stateData.expiresAt) {
      throw new Error('OAuth state expired. Please try again.');
    }

    const { tokens } = await this.oauth2Client.getToken({
      code,
      redirect_uri: stateData.redirectUri
    });
    this.oauth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), { encoding: 'utf-8', mode: 0o600 });
    logger.success('CredentialManager', 'YouTube OAuth2 tokens verified and saved securely (0600 mode).');
    return tokens;
  }

  getYouTubeClient() {
    if (!this.oauth2Client) return null;
    return google.youtube({ version: 'v3', auth: this.oauth2Client });
  }
}

export const credentialManager = new CredentialManager();
