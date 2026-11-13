# 🚀 NextGen YouTube Automation v2.0 (10x Advanced Edition)

![Version](https://img.shields.io/badge/version-2.0.0-38bdf8?style=for-the-badge)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-4ade80?style=for-the-badge)
![Architecture](https://img.shields.io/badge/Architecture-6--Layer%20Clean-facc15?style=for-the-badge)
![MCP](https://img.shields.io/badge/MCP-Browser%20Connectable-3b82f6?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-ffffff?style=for-the-badge)

An enterprise-grade, autonomous **Multi-Agent YouTube Channel Management & Production System** featuring a **Browser-Connectable MCP (Model Context Protocol) Hub** and a **Claude-Style Code-Driven Video Editor (EDL Studio)**. Built with a strict zero-bug, zero-vulnerability architecture that runs effortlessly on Cloud IDEs (GitHub Codespaces) and Mobile environments.

---

## ✨ Key Highlights & 10x Upgrades

* **🤖 7 Autonomous Micro-Agents:** Decoupled agents for Content Strategy, Scriptwriting, YouTube SEO, SVG Thumbnail Design, End-to-End Production, 24/7 Scheduling, and Analytics Optimization.
* **🎬 Claude-Style Code-Driven Video Editor:** Edit videos programmatically using declarative JSON Edit Decision Lists (`EDL`). Automatically compiles scene timings, dynamic captions, color grading, and transitions into zero-injection `FFmpeg` filter graphs.
* **🔌 Browser-Based MCP Skill Hub:** Connect or disconnect external & internal Model Context Protocol (`MCP`) skills (Video Editors, Voiceover Engines, SEO Analyzers) directly from the web dashboard UI.
* **📱 1-Click Shorts Repurposer:** Automatically converts 16:9 long-form video EDL timelines into 9:16 vertical YouTube Shorts.
* **🛡️ Zero-Vulnerability Core:** Strict `Zod` schema validation, shell argument sanitization, Helmet security headers, API rate limiting, and atomic JSON state persistence (`database/vault.json`).

---

## 🏗️ Clean 6-Layer Architecture

```text
NextGen-Youtube-Automation/
├── config/
│   └── security-validator.js       # Layer 2: Zod Env Validation & Shell Sanitizer
├── database/
│   └── db.js                       # Layer 6: Atomic Zero-Crash Local JSON Vault
├── utils/
│   ├── logger.js                   # Real-time Event & SSE Telemetry Logger
│   ├── credential-manager.js       # YouTube OAuth2 & Multi-LLM Key Manager
│   ├── ai-text-service.js          # Gemini / OpenAI Service with Resilient Fallback
│   ├── ffmpeg.js                   # Layer 5: Claude-Style Code-Driven Video Editor
│   └── shorts-repurposing-service.js # Automated 16:9 to 9:16 Shorts Converter
├── mcp/
│   ├── mcp-hub.js                  # Layer 4: Browser-Connectable MCP Skill Router
│   └── content-strategy-agent.mcp.json
├── agents/                         # Layer 3: 7 Specialized Autonomous AI Agents
│   ├── content-strategy-agent.js
│   ├── script-writer-agent.js
│   ├── seo-optimizer-agent.js
│   ├── thumbnail-designer-agent.js
│   ├── production-management-agent.js
│   ├── publishing-scheduling-agent.js
│   └── analytics-optimization-agent.js
├── dashboard/                      # Layer 1: Mobile-First Responsive Web Studio
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── enhance.js
├── schedules/
│   └── daily-automation.js         # 24/7 Cron Automation Runner
├── index.js                        # Express API Gateway & SSE Server
├── setup.js                        # Environment & Directory Initializer
└── test.js                         # Automated Zero-Bug Verification Suite
