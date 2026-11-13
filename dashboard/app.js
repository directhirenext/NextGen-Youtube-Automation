function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/[&<>"']/g, (char) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[char] || char;
  });
}

async function apiCall(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function renderMetrics(dbState, authStatus) {
  document.getElementById('metricVideos').textContent = dbState.videos?.length || 0;
  document.getElementById('metricSkills').textContent = dbState.mcpSkills?.length || 0;
  document.getElementById('metricEdls').textContent = dbState.edlProjects?.length || 0;
  document.getElementById('metricHealth').textContent = `${dbState.channelMetrics?.healthScore || 100}%`;

  const aiPill = document.getElementById('aiStatusPill');
  const osName = authStatus.osProfile?.osType || 'Host';
  aiPill.textContent = `AI (${authStatus.aiProvider}): ${authStatus.hasAiKey ? 'Connected' : 'Fallback'} • ${osName}`;

  const ytPill = document.getElementById('ytStatusPill');
  ytPill.textContent = `YouTube OAuth: ${authStatus.isYouTubeAuthorized ? 'Authorized' : 'Local Queue Mode'}`;
}

function renderMcpSkills(skills = []) {
  const box = document.getElementById('mcpSkillsList');
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
  if (!videos.length) {
    box.innerHTML = '<div class="muted">No video packages produced yet. Launch the pipeline above!</div>';
    return;
  }
  box.innerHTML = videos.map(v => `
    <div class="item-row">
      <div>
        <strong>${escapeHtml(v.title || v.topicHint || v.id)}</strong>
        <div class="muted">Status: ${escapeHtml(v.status)} • Scenes: ${Number(v.edlProject?.sceneCount || 0)} • Short: ${v.shortVariant ? 'Yes (9:16)' : 'No'}</div>
      </div>
      <span class="badge">${Number(v.seo?.seoScore || 95)} SEO</span>
    </div>
  `).join('');
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
    renderMetrics(data.state, data.auth);
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
  } catch (err) {
    alert(`Pipeline error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Launch Autonomous Pipeline';
  }
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

