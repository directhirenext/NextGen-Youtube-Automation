import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { loadValidatedConfig } from '../config/security-validator.js';
import { logger } from './logger.js';

const TOKEN_PATH = path.resolve('config/token.json');

export class CredentialManager {
  constructor() {
    this.config = loadValidatedConfig();
    this.oauth2Client = null;
    this._initOAuth();
  }

  _initOAuth() {
    if (this.config.YOUTUBE_CLIENT_ID && this.config.YOUTUBE_CLIENT_SECRET) {
      this.oauth2Client = new google.auth.OAuth2(
        this.config.YOUTUBE_CLIENT_ID,
        this.config.YOUTUBE_CLIENT_SECRET,
        this.config.YOUTUBE_REDIRECT_URI
      );

      if (fs.existsSync(TOKEN_PATH)) {
        try {
          const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
          this.oauth2Client.setCredentials(token);
          logger.success('CredentialManager', 'Loaded saved YouTube OAuth2 token.');
        } catch (err) {
          logger.warn('CredentialManager', 'Could not parse saved token.json');
        }
      }
    }
  }

  getAuthStatus() {
    return {
      aiProvider: this.config.AI_PROVIDER,
      hasAiKey: Boolean(
        this.config.GEMINI_API_KEY || this.config.OPENAI_API_KEY || this.config.ANTHROPIC_API_KEY
      ),
      hasYouTubeCredentials: Boolean(this.config.YOUTUBE_CLIENT_ID && this.config.YOUTUBE_CLIENT_SECRET),
      isYouTubeAuthorized: Boolean(this.oauth2Client && this.oauth2Client.credentials?.access_token)
    };
  }

  generateYouTubeAuthUrl() {
    if (!this.oauth2Client) {
      throw new Error('YouTube Client ID & Secret are not configured in .env');
    }
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/yt-analytics.readonly'
      ]
    });
  }

  async saveOAuthCode(code) {
    if (!this.oauth2Client) throw new Error('OAuth2 client not initialized');
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
    logger.success('CredentialManager', 'YouTube OAuth2 tokens saved successfully.');
    return tokens;
  }

  getYouTubeClient() {
    if (!this.oauth2Client) return null;
    return google.youtube({ version: 'v3', auth: this.oauth2Client });
  }
}

export const credentialManager = new CredentialManager();
      
