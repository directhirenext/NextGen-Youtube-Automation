import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { loadValidatedConfig } from '../config/security-validator.js';
import { crossOS } from './cross-os-adapter.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

export class NeuralTTSService {
  constructor() {
    this.config = loadValidatedConfig();
    this.audioOutDir = crossOS.resolveProjectPath('editor', 'uploads', 'audio');
    crossOS.ensureDirectories([this.audioOutDir]);
  }

  _containsDevanagari(text = '') {
    return /[\u0900-\u097F]/.test(text);
  }

  async synthesizeNarration(narrationText, options = {}) {
    crossOS.ensureDirectories([this.audioOutDir]);
    const cleanText = String(narrationText || '').trim();
    if (!cleanText) {
      throw new Error('Cannot synthesize empty narration text.');
    }

    const isHindi = this._containsDevanagari(cleanText);
    const voice = options.voice || (isHindi ? this.config.TTS_VOICE_HI : this.config.TTS_VOICE_EN);
    const provider = options.provider || this.config.TTS_PROVIDER;
    const id = `tts_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

    // 1. Try ElevenLabs Multilingual v2 Humanized Voice if configured
    if ((provider === 'elevenlabs' || this.config.ELEVENLABS_API_KEY) && this.config.ELEVENLABS_API_KEY && !this.config.ELEVENLABS_API_KEY.includes('your_')) {
      try {
        const filename = `${id}.mp3`;
        const fullPath = path.join(this.audioOutDir, filename);
        await this._synthesizeElevenLabs(cleanText, fullPath);
        logger.success('NeuralTTS', `Synthesized ElevenLabs humanized voiceover: ${filename}`);
        return { filename, fullPath, engine: 'elevenlabs-multilingual-v2', voice: this.config.ELEVENLABS_VOICE_ID };
      } catch (err) {
        logger.warn('NeuralTTS', `ElevenLabs TTS failed (${err.message}), trying next neural engine...`);
      }
    }

    // 2. Try OpenAI HD Neural TTS (tts-1-hd) if configured
    if ((provider === 'openai' || this.config.OPENAI_API_KEY) && this.config.OPENAI_API_KEY && !this.config.OPENAI_API_KEY.includes('your_')) {
      try {
        const filename = `${id}.mp3`;
        const fullPath = path.join(this.audioOutDir, filename);
        await this._synthesizeOpenAI(cleanText, fullPath);
        logger.success('NeuralTTS', `Synthesized OpenAI tts-1-hd neural voiceover: ${filename}`);
        return { filename, fullPath, engine: 'openai-tts-1-hd', voice: 'onyx' };
      } catch (err) {
        logger.warn('NeuralTTS', `OpenAI TTS failed (${err.message}), trying Edge Neural CLI...`);
      }
    }

    // 3. Try Microsoft Edge Neural TTS CLI (edge-tts) if installed on system
    try {
      const filename = `${id}.mp3`;
      const fullPath = path.join(this.audioOutDir, filename);
      await execFileAsync('edge-tts', [
        '--voice', voice,
        '--rate=+4%',
        '--text', cleanText,
        '--write-media', fullPath
      ], { timeout: 25000 });
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 256) {
        logger.success('NeuralTTS', `Synthesized Edge Neural voiceover (${voice}): ${filename}`);
        return { filename, fullPath, engine: 'edge-neural-tts', voice };
      }
    } catch {
      // edge-tts binary not installed or offline; try free Google Neural TTS HTTP stream
    }

    // 4. Try Free Google Translate Neural Hindi/Indian-English MP3 Stream
    try {
      const filename = `${id}.mp3`;
      const fullPath = path.join(this.audioOutDir, filename);
      const lang = isHindi ? 'hi' : 'en-IN';
      await this._synthesizeGoogleTranslateStream(cleanText, lang, fullPath);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 256) {
        logger.success('NeuralTTS', `Synthesized Google Neural (${lang}) voiceover: ${filename}`);
        return { filename, fullPath, engine: `google-neural-${lang}`, voice: lang };
      }
    } catch (err) {
      logger.warn('NeuralTTS', `Online neural stream unavailable (${err.message}). Generating local acoustic WAV track...`);
    }

    // 5. Offline Guaranteed Fallback: Generate clean speech-cadence WAV file so video NEVER renders silent
    const wavFilename = `${id}.wav`;
    const wavPath = path.join(this.audioOutDir, wavFilename);
    const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
    const durationSec = Math.max(4, Math.min(90, Math.ceil(wordCount / 2.6)));
    this._generateCadenceWavFile(wavPath, durationSec);
    logger.info('NeuralTTS', `Generated local ${durationSec}s speech-cadence audio track: ${wavFilename}`);
    return { filename: wavFilename, fullPath: wavPath, engine: 'local-cadence-wav', voice: 'offline-synth', durationSec };
  }

  async _synthesizeElevenLabs(text, outputPath) {
    const voiceId = this.config.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.config.ELEVENLABS_API_KEY
        },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.48, similarity_boost: 0.82, style: 0.35, use_speaker_boost: true }
        })
      });
      if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      fs.writeFileSync(outputPath, Buffer.from(arrayBuf), { mode: 0o600 });
    } finally {
      clearTimeout(timer);
    }
  }

  async _synthesizeOpenAI(text, outputPath) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.OPENAI_API_KEY}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'tts-1-hd',
          voice: 'onyx',
          input: text
        })
      });
      if (!res.ok) throw new Error(`OpenAI TTS HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      fs.writeFileSync(outputPath, Buffer.from(arrayBuf), { mode: 0o600 });
    } finally {
      clearTimeout(timer);
    }
  }

  async _synthesizeGoogleTranslateStream(text, lang, outputPath) {
    const chunks = [];
    const sentences = text.match(/[^.!?।]+[.!?।]?/g) || [text];
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;
      const slice = trimmed.slice(0, 180);
      const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(slice)}&tl=${encodeURIComponent(lang)}&client=tw-ob`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        chunks.push(buf);
      } finally {
        clearTimeout(timer);
      }
    }
    if (!chunks.length) throw new Error('No audio chunks downloaded');
    fs.writeFileSync(outputPath, Buffer.concat(chunks), { mode: 0o600 });
  }

  _generateCadenceWavFile(outputPath, durationSec = 8) {
    const sampleRate = 24000;
    const numSamples = sampleRate * durationSec;
    const buffer = Buffer.alloc(44 + numSamples * 2);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + numSamples * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(numSamples * 2, 40);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const syllableEnvelope = Math.max(0, Math.sin(2 * Math.PI * 3.2 * t));
      const carrier =
        0.6 * Math.sin(2 * Math.PI * 165 * t) +
        0.3 * Math.sin(2 * Math.PI * 330 * t) +
        0.1 * Math.sin(2 * Math.PI * 495 * t);
      const sample = Math.round(carrier * syllableEnvelope * 6500);
      buffer.writeInt16LE(sample, 44 + i * 2);
    }

    fs.writeFileSync(outputPath, buffer, { mode: 0o600 });
  }
}

export const ttsService = new NeuralTTSService();
                                    
