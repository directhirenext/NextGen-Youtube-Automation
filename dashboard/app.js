let currentPasskey = localStorage.getItem('nextgen_passkey') || '';

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/[&<>"']/g, (char) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[char] || char;
  });
}

export async function apiCall(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(currentPasskey ? { 'x-dashboard-key': currentPasskey } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

document.getElementById('savePasskeyBtn')?.addEventListener('click', () => {
  const val = document.getElementById('passkeyInput')?.value?.trim() || '';
  if (!val) {
    alert('Please enter a valid passkey.');
    return;
  }
  currentPasskey = val;
  localStorage.setItem('nextgen_passkey', val);
  refreshDashboard();
  alert('🔐 Passkey saved and studio unlocked!');
});

function renderMetrics(dbState, authStatus, aiGateway, mediaAssets) {
  const authPill = document.getElementById('authStatusPill');
  if (authPill) {
    authPill.textContent = currentPasskey ? 'Unlocked (Key Active)' : 'Locked (Enter Passkey)';
    authPill.className = currentPasskey ? 'pill' : 'pill warning';
  }

  const totalAssets =
    (mediaAssets?.videos?.length || 0) +
    (mediaAssets?.audio?.length || 0) +
    (mediaAssets?.overlays?.length || 0);

  document.getElementById('metricVideos').textContent = dbState.videos?.length || 0;
  document.getElementById('metricAssets').textContent = totalAssets;
  document.getElementById('metricSkills').textContent = dbState.mcpSkills?.length || 0;
  document.getElementById('metricEdls').textContent = dbState.edlProjects?.length || 0;
  document.getElementById('metricHealth').textContent = `${dbState.channelMetrics?.healthScore || 100}%`;

  const aiPill = document.getElementById('aiStatusPill');
  const osName = authStatus.osProfile?.osType || 'Host';
  const activeProv = aiGateway?.activeProvider || authStatus.aiProvider;
  aiPill.textContent = `AI (${activeProv}): ${authStatus.hasAiKey || aiGateway?.hasCustomRuntimeKey ? 'Live' : 'Fallback'} • ${osName}`;

  const tokenPill = document.getElementById('tokenStatusPill');
  if (tokenPill && aiGateway?.telemetry) {
    tokenPill.textContent = `Tokens: ${aiGateway.telemetry.estimatedTokensUsed} (${aiGateway.telemetry.lastLatencyMs}ms)`;
  }

  const ytPill = document.getElementById('ytStatusPill');
  ytPill.textContent = `YouTube: ${authStatus.isYouTubeAuthorized ? 'Authorized' : 'Queue Mode'}`;
}

function populateMediaDropdowns(mediaAssets = {}) {
  const videoSelect = document.getElementById('studioVideoSelect');
  const voiceSelect = document.getElementById('studioVoiceSelect');
  const bgmSelect = document.getElementById('studioBgmSelect');
  const overlaySelect = document.getElementById('studioOverlaySelect');

  if (videoSelect) {
    const prev = videoSelect.value;
    videoSelect.innerHTML = '<option value="">-- Use AI Scene Canvas --</option>' +
      (mediaAssets.videos || []).map(v => `<option value="${escapeHtml(v.filename)}">${escapeHtml(v.filename)}</option>`).join('');
    videoSelect.value = prev;
  }

  const audioOptions = (mediaAssets.audio || []).map(a => `<option value="${escapeHtml(a.filename)}">${escapeHtml(a.filename)}</option>`).join('');
  if (voiceSelect) {
    const prev = voiceSelect.value;
    voiceSelect.innerHTML = '<option value="">-- None --</option>' + audioOptions;
    voiceSelect.value = prev;
  }
  if (bgmSelect) {
    const prev = bgmSelect.value;
    bgmSelect.innerHTML = '<option value="">-- None --</option>' + audioOptions;
    bgmSelect.value = prev;
  }

  if (overlaySelect) {
    const prev = overlaySelect.value;
    overlaySelect.innerHTML = '<option value="">-- None --</option>' +
      (mediaAssets.overlays || []).map(o => `<option value="${escapeHtml(o.filename)}">${escapeHtml(o.filename)}</option>`).join('');
    overlaySelect.value = prev;
  }

  const listBox = document.getElementById('uploadedMediaList');
  if (listBox) {
    const all = [
      ...(mediaAssets.videos || []),
      ...(mediaAssets.audio || []),
      ...(mediaAssets.overlays || [])
    ];
    if (!all.length) {
      listBox.innerHTML = '<div class="muted">No custom media files uploaded yet.</div>';
      return;
    }
    listBox.innerHTML = all.map(item => `
      <div class="item-row">
        <div>
          <strong>${escapeHtml(item.filename)}</strong> <span class="badge">${escapeHtml(item.category)}</span>
          <div class="muted">${(item.sizeBytes / 1024).toFixed(1)} KB</div>
        </div>
        <button class="btn outline" data-del-cat="${escapeHtml(item.category)}" data-del-file="${escapeHtml(item.filename)}">Delete</button>
      </div>
    `).join('');

    listBox.querySelectorAll('[data-del-file]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await apiCall(`/api/media/${encodeURIComponent(btn.dataset.delCat)}/${encodeURIComponent(btn.dataset.delFile)}`, {
          method: 'DELETE'
        });
        await refreshDashboard();
      });
    });
  }
}

function renderMcpSkills(skills = []) {
  const box = document.getElementById('mcpSkillsList');
  if (!box) return;
  box.innerHTML = skills.map(s => `
    <div class="item-row">
      <div>
        <strong>${escapeHtml(s.name)}</strong> <span class="badge">${escapeHtml(s.type)}</span>
        <div class="muted">${escapeHtml(s.id)} • ${escapeHtml(s.endpoint)}</div>
      </div>
      ${!s.builtIn ? `<button class="btn outline" data-disconnect="${escapeHtml(s.id)}">Disconnect</button>` : '<span class="badge">Built-in</span>'}
    </div>
  `).join('');

  box.querySelectorAll('[data-disconnect]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await apiCall(`/api/mcp/skills/${encodeURIComponent(btn.dataset.disconnect)}`, { method: 'DELETE' });
      await refreshDashboard();
    });
  });
}

function renderVideoJobs(videos = []) {
  const box = document.getElementById('videoJobsList');
  if (!box) return;
  if (!videos.length) {
    box.innerHTML = '<div class="muted">No video packages produced yet. Launch the pipeline above!</div>';
    return;
  }

  box.innerHTML = videos.map(v => {
    const isRendered = Boolean(v.renderResult?.rendered && v.edlProject?.outputFile);
    const videoUrl = isRendered ? `/renders/${encodeURIComponent(v.edlProject.outputFile)}` : '';
    const srtUrl = v.edlProject?.srtFile ? `/renders/subtitles/${encodeURIComponent(v.edlProject.srtFile)}` : '';
    const abWinner = v.seo?.abTesting?.winner || 'Variant A';
    const seoScore = Number(v.seo?.seoScore || 95);

    return `
      <div class="video-job-box" data-job-id="${escapeHtml(v.id)}">
        <div class="item-row" style="background:transparent; border:none; padding:0;">
          <div>
            <strong>${escapeHtml(v.title || v.topicHint || v.id)}</strong>
            <div class="muted">Status: <span class="badge">${escapeHtml(v.status)}</span> • SEO: ${seoScore}/100 • A/B Winner: ${escapeHtml(abWinner)}</div>
          </div>
          <div style="display:flex; gap:8px;">
            ${isRendered ? `<a href="${videoUrl}" download class="btn outline">📥 Download MP4</a>` : ''}
            ${srtUrl ? `<a href="${srtUrl}" download class="btn outline">📝 Download SRT</a>` : ''}
            <button class="btn primary" data-publish-id="${escapeHtml(v.id)}">🚀 Publish to YouTube</button>
          </div>
        </div>

        ${isRendered ? `
          <div class="video-preview-wrapper">
            <video controls preload="metadata" src="${videoUrl}"></video>
          </div>
        ` : `<div class="muted">Video render pending or FFmpeg missing (${escapeHtml(v.renderResult?.mode || 'dry-run')})</div>`}

        <details>
          <summary style="cursor:pointer; font-size:0.825rem; font-weight:600; color:var(--accent-primary);">🛠️ AI Revision & Manual Edit Studio (Click to Expand)</summary>
          <div class="form-stack" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border-color);">
            <label>AI Revision Feedback Prompt (Tell AI what to fix or change)
              <input type="text" class="rev-feedback" placeholder="e.g., Make the hook punchier, update tone, or fix scene 2" />
            </label>
            <div class="row">
              <label>Manual Title Override
                <input type="text" class="rev-title" value="${escapeHtml(v.seo?.optimizedTitle || v.title || '')}" />
              </label>
              <button class="btn secondary rev-submit-btn" data-revise-id="${escapeHtml(v.id)}" style="align-self:flex-end;">🔄 Revise & Re-Render</button>
            </div>
          </div>
        </details>
      </div>
    `;
  }).join('');

  // Attach event listeners for publish and revise
  box.querySelectorAll('[data-publish-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const jobId = btn.dataset.publishId;
      btn.disabled = true;
      btn.textContent = '🚀 Publishing to YouTube...';
      try {
        const res = await apiCall(`/api/publish/${encodeURIComponent(jobId)}`, { method: 'POST' });
        alert(`✅ Successfully published to YouTube! Video ID: ${res.job.youtubeVideoId}`);
        await refreshDashboard();
      } catch (err) {
        alert(`Publish error: ${err.message}`);
        btn.disabled = false;
        btn.textContent = '🚀 Publish to YouTube';
      }
    });
  });

  box.querySelectorAll('.rev-submit-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const jobId = btn.dataset.reviseId;
      const boxEl = btn.closest('.video-job-box');
      const feedbackPrompt = boxEl.querySelector('.rev-feedback')?.value || '';
      const manualTitle = boxEl.querySelector('.rev-title')?.value || '';

      btn.disabled = true;
      btn.textContent = '⏳ Re-rendering...';
      try {
        await apiCall('/api/production/revise', {
          method: 'POST',
          body: JSON.stringify({ jobId, feedbackPrompt, manualTitle, regenerateTarget: 'all' })
        });
        await refreshDashboard();
        alert('✅ Video successfully revised and re-rendered with new audio/visuals!');
      } catch (err) {
        alert(`Revision error: ${err.message}`);
        btn.disabled = false;
        btn.textContent = '🔄 Revise & Re-Render';
      }
    });
  });
}

function appendLogEntry(entry) {
  const box = document.getElementById('liveLogsBox');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'item-row';
  const strong = document.createElement('strong');
  strong.textContent = `[${entry.module}] `;
  const msgSpan = document.createElement('span');
  msgSpan.appendChild(strong);
  msgSpan.appendChild(document.createTextNode(entry.message || ''));

  const timeSpan = document.createElement('span');
  timeSpan.className = 'muted';
  timeSpan.textContent = new Date(entry.timestamp).toLocaleTimeString();

  div.appendChild(msgSpan);
  div.appendChild(timeSpan);
  box.prepend(div);
}

export async function refreshDashboard() {
  try {
    const data = await apiCall('/api/state');
    renderMetrics(data.state, data.auth, data.aiGateway, data.mediaAssets);
    populateMediaDropdowns(data.mediaAssets);
    renderMcpSkills(data.state.mcpSkills);
    renderVideoJobs(data.state.videos);
  } catch (err) {
    console.error('Dashboard refresh error:', err.message);
  }
}

document.getElementById('productionForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('runPipelineBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Running Multi-Agent Pipeline...';
  try {
    await apiCall('/api/production/run', {
      method: 'POST',
      body: JSON.stringify({
        niche: document.getElementById('nicheInput').value,
        topicHint: document.getElementById('topicInput').value,
        aspectRatio: document.getElementById('aspectInput').value,
        generateShort: document.getElementById('autoShortInput').checked
      })
    });
    document.getElementById('topicInput').value = '';
    await refreshDashboard();
    alert('✅ Autonomous pipeline finished successfully!');
  } catch (err) {
    alert(`Pipeline error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Launch Autonomous Pipeline';
  }
});

document.getElementById('universalAiForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await apiCall('/api/ai/config', {
      method: 'POST',
      body: JSON.stringify({
        provider: document.getElementById('aiProviderSelect').value,
        model: document.getElementById('aiModelInput').value.trim() || undefined,
        baseUrl: document.getElementById('aiBaseUrlInput').value.trim() || undefined,
        apiKey: document.getElementById('aiApiKeyInput').value.trim() || undefined
      })
    });
    document.getElementById('aiApiKeyInput').value = '';
    await refreshDashboard();
    alert('✅ Universal AI Provider configured successfully!');
  } catch (err) {
    alert(`AI Config Error: ${err.message}`);
  }
});

document.getElementById('uploadMediaBtn')?.addEventListener('click', async () => {
  const fileInput = document.getElementById('mediaFileInput');
  const category = document.getElementById('uploadCategorySelect').value;
  const file = fileInput?.files?.[0];
  if (!file) {
    alert('Please select a file first.');
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      await apiCall('/api/media/upload', {
        method: 'POST',
        body: JSON.stringify({
          category,
          originalName: file.name,
          base64Data: reader.result
        })
      });
      fileInput.value = '';
      await refreshDashboard();
      alert('✅ File uploaded successfully to studio vault!');
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    }
  };
  reader.readAsDataURL(file);
});

document.getElementById('mcpForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await apiCall('/api/mcp/skills', {
      method: 'POST',
      body: JSON.stringify({
        id: document.getElementById('mcpId').value.trim(),
        name: document.getElementById('mcpName').value.trim(),
        type: document.getElementById('mcpType').value,
        endpoint: document.getElementById('mcpEndpoint').value.trim(),
        capabilities: ['browser-connected']
      })
    });
    e.target.reset();
    await refreshDashboard();
  } catch (err) {
    alert(`MCP Connection Error: ${err.message}`);
  }
});

function initLiveLogs() {
  const evtSource = new EventSource('/api/logs/stream');
  evtSource.onmessage = (event) => {
    try {
      const entry = JSON.parse(event.data);
      appendLogEntry(entry);
    } catch {}
  };
}

if (currentPasskey) {
  refreshDashboard();
  initLiveLogs();
          }
          
