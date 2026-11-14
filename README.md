# 🚀 NextGen YouTube Automation v3.0 (Enterprise Studio Edition)

![Version](https://img.shields.io/badge/version-3.0.0--Enterprise-38bdf8?style=for-the-badge)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-4ade80?style=for-the-badge)
![Architecture](https://img.shields.io/badge/Architecture-6--Layer%20Zero--Trust-facc15?style=for-the-badge)
![AI](https://img.shields.io/badge/AI-Universal%20Multi--LLM%20Router-a855f7?style=for-the-badge)
![MCP](https://img.shields.io/badge/MCP-Browser%20Connectable-3b82f6?style=for-the-badge)
![Security](https://img.shields.io/badge/Vulnerabilities-0%20Verified-22c55e?style=for-the-badge)

An enterprise-grade **Autonomous Multi-Agent YouTube Production System** combined with a **KineMaster/PowerDirector-Style Manual Multi-Track Media Studio**, **Claude-Style Code-Driven Video Editor (EDL)**, **Universal Third-Party AI Failover Router**, and **Browser-Connectable MCP Skill Hub**. Engineered with a strict zero-vulnerability architecture that runs seamlessly across **Android Termux, GitHub Codespaces, Linux, Windows, and macOS**.

---

## ✨ Enterprise v3.0 Key Capabilities

* **🤖 7 Autonomous Micro-Agents:** Decoupled agents for Content Strategy, Scriptwriting, Enterprise SEO (with Auto-Chapters & A/B CTR Simulation), XML-Safe SVG Thumbnail Design, End-to-End Production, 24/7 Cron Scheduling, and Channel Analytics.
* **🎛️ Manual Media Studio:**
  * **Local Media Upload Vault:** Upload raw `.mp4/.webm/.mov` videos, `.mp3/.wav/.m4a` voiceovers/BGM, and `.png/.jpg/.mp4` PiP or green-screen overlays directly from your browser.
  * **Multi-Track Audio Mastering:** 1-click **Mute Original Video Audio**, independent volume sliders for Video/Voiceover/BGM, **AI/DSP Noise Cancellation (`afftdn`)**, **Auto-Ducking** (lowers BGM when speaking), **Smart Silence Remover (`silenceremove`)**, and **YouTube `-14 LUFS` Loudness Normalization (`loudnorm`)**.
  * **Visual Filters & Chroma Key:** Apply presets (*Cinematic, Warm Glow, Cyberpunk, Noir B&W, Ultra Sharp*), custom Brightness/Contrast/Saturation, Playback Speed (`0.5x`–`2.0x`), Start/End Trimming, and **Green Screen Chroma Key (`chromakey`)**.
* **🎬 Claude-Style Code-Driven Video Editor (EDL Studio):** Edit videos declaratively via JSON Edit Decision Lists or sync manual studio sliders directly into zero-injection `FFmpeg` multi-track filter graphs.
* **🌐 Universal Third-Party AI Gateway & Auto-Failover:** Native and OpenAI-compatible support for **Google Gemini, OpenAI, Anthropic Claude, OpenRouter, Groq, DeepSeek, Mistral, Together AI**, or any custom LLM endpoint with automatic failover switching and live token/latency telemetry.
* **📝 Auto-Subtitles (`.srt`) & YouTube Timestamp Chapters:** Automatically generates downloadable `.srt` closed captions and formatted `00:00` YouTube description chapters for every project.
* **🔌 Browser MCP Skill Hub (Zero-SSRF):** Connect or disconnect internal and external Model Context Protocol (`MCP`) JSON-RPC skills directly from the web UI.
* **🛡️ Zero-Vulnerability & Cross-OS Core:** Strict `Zod` validation, shell metacharacter sanitization, SSRF private-IP blocking, DOM XSS/XML escaping, mutex-locked atomic JSON database with `.bak` auto-recovery, and dynamic Cloud/Codespaces OAuth redirect resolution.

---

## 🏗️ Clean 6-Layer Enterprise Architecture

```text
NextGen-Youtube-Automation/
├── config/
│   └── security-validator.js         # Layer 2: Zod Env Validation, SSRF, XSS & Shell Sanitizers
├── database/
│   └── db.js                         # Layer 6: Mutex-Locked Atomic Vault + Auto .bak Recovery
├── utils/
│   ├── cross-os-adapter.js           # Cross-OS Detector (Termux/Codespaces/Win/Linux/macOS)
│   ├── ai-text-service.js            # Universal Multi-LLM Gateway + Auto-Failover & Telemetry
│   ├── media-studio-service.js       # Local Media Upload Vault, SRT & Chapters, Webhook/TG Alerts
│   ├── ffmpeg.js                     # Layer 5: Multi-Track Manual & Code Video Editor (FFmpeg)
│   ├── shorts-repurposing-service.js # Automated 16:9 to 9:16 Vertical Shorts Converter
│   ├── credential-manager.js         # Dynamic OAuth2 & Strict 0600 Token Manager
│   └── logger.js                     # Real-Time Event & SSE Telemetry Streamer
├── mcp/
│   ├── mcp-hub.js                    # Layer 4: SSRF-Guarded Browser MCP Skill Router
│   └── content-strategy-agent.mcp.json
├── agents/                           # Layer 3: 7 Specialized Autonomous AI Agents
│   ├── content-strategy-agent.js
│   ├── script-writer-agent.js
│   ├── seo-optimizer-agent.js        # Includes A/B Title CTR Simulator & Auto-Chapters
│   ├── thumbnail-designer-agent.js
│   ├── production-management-agent.js
│   ├── publishing-scheduling-agent.js
│   └── analytics-optimization-agent.js
├── dashboard/                        # Layer 1: Mobile & Desktop Dark-Mode Web Studio
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── enhance.js
├── schedules/
│   └── daily-automation.js           # 24/7 Autonomous Cron Scheduler
├── index.js                          # Hardened Express API Gateway & SSE Server
├── setup.js                          # Cross-OS Bootstrapper & 256-Bit Secret Generator
└── test.js                           # 8-Point Zero-Vulnerability & Studio Verification Suite
```

---

## ⚡ Quickstart (GitHub Codespaces / Android Termux / Local PC)

### 1. Clone & Install Dependencies
```bash
git clone [https://github.com/directhirenext/NextGen-Youtube-Automation.git](https://github.com/directhirenext/NextGen-Youtube-Automation.git)
cd NextGen-Youtube-Automation
npm install
```

### 2. Run Cross-OS Security & Directory Bootstrapper
```bash
npm run setup
```
*Automatically creates all required upload/render directories and generates a cryptographic 256-bit `DASHBOARD_SECRET_KEY` inside `.env` with `0600` file permissions.*

### 3. Run the 8-Point Verification Audit Suite
```bash
npm test
```

### 4. Launch the Enterprise Web Studio
```bash
npm start
```
Open **`http://localhost:3000`** in your browser to use the 1-Click Autonomous Pipeline, Universal AI Router, and KineMaster-Style Manual Studio!

---

## 🎛️ Using the KineMaster-Style Manual & Code Studio

1. **Upload Media:** In the dashboard, select **Raw Video**, **Voiceover/BGM**, or **Overlay** and upload your file from mobile or desktop.
2. **Configure Multi-Track Mixing:**
   * Toggle **🔇 Mute Original Video Audio** to silence noisy camera audio.
   * Select your uploaded **Voiceover** and **BGM**, then enable **🎙️ AI/DSP Noise Cancellation**, **📉 Auto-Duck BGM**, **✂️ Smart Silence Remover**, and **🔊 -14 LUFS Mastering**.
   * Choose a **Visual Filter Preset** (e.g., *Cinematic Contrast*) and adjust **Playback Speed** or **Start/End Trim**.
3. **Sync & Compile:** Click **🔗 Sync Manual Controls to EDL Code Below** and then **🛠️ Compile Studio EDL, Subtitles (.SRT) & FFmpeg Render**.

---

## 📄 License
MIT License — Built for autonomous creators, media engineers, and enterprise workflows.
