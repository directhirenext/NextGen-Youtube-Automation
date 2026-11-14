function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/[&<>"']/g, (char) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[char] || char;
  });
}

export async function apiCall(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function renderMetrics(dbState, authStatus, aiGateway, mediaAssets) {
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
  ytPill.textContent = `YouTube OAuth: ${authStatus.isYouTubeAuthorized ? 'Authorized' : 'Local Queue Mode'}`;
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
      <button class="btn outline" data-disconnect="${escapeHtml(s.id)}">Disconnect</button>
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
    const abWinner = v.seo?.abTesting?.winner || 'Variant A';
    const srtFile = v.edlProject?.srtFile || v.seo?.srtSubtitleFile || 'Ready';
    return `
      <div class="item-row">
        <div>
          <strong>${escapeHtml(v.title || v.topicHint || v.id)}</strong>
          <div class="muted">Status: ${escapeHtml(v.status)} • Scenes: ${Number(v.edlProject?.sceneCount || 0)} • A/B Winner: ${escapeHtml(abWinner)} • SRT: ${escapeHtml(srtFile)}</div>
        </div>
        <span class="badge">${Number(v.seo?.seoScore || 98)} SEO</span>
      </div>
    `;
  }).join('');
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
  btn.textContent = '⏳ Running Enterprise Pipeline...';
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
    alert('✅ Universal AI Provider configured and active!');
  } catch (err) {
    alert(`AI Config Error: ${err.message}`);
  }
});

document.getElementById('uploadMediaBtn')?.addEventListener('click', async () => {
  const fileInput = document.getElementById('mediaFileInput');
  const category = document.getElementById('uploadCategorySelect').value;
  const file = fileInput?.files?.[0];
  if (!file) {
    alert('Please select a video, audio, or overlay file first.');
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

refreshDashboard();
initLiveLogs();
  
