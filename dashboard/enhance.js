import { refreshDashboard } from './app.js';

const sampleEdl = {
  title: 'Pan-India Direct Hiring Walk-In Drive 2026',
  aspectRatio: '16:9',
  fps: 30,
  scenes: [
    {
      sceneId: 'scene_hook',
      type: 'hook',
      durationSec: 4,
      captionText: '5 Verified Companies Hiring Freshers Direct Walk-In!',
      bgColor: '#0f172a',
      textColor: '#38bdf8',
      transition: 'fade'
    },
    {
      sceneId: 'scene_details',
      type: 'body',
      durationSec: 8,
      captionText: 'Noida, Gurugram, Bengaluru & Remote Roles - Salary 4.5 to 9 LPA',
      bgColor: '#1e1b4b',
      textColor: '#facc15',
      transition: 'slide'
    },
    {
      sceneId: 'scene_cta',
      type: 'cta',
      durationSec: 4,
      captionText: 'Apply Link in Description • Subscribe for Daily Alerts!',
      bgColor: '#090d16',
      textColor: '#4ade80',
      transition: 'cut'
    }
  ]
};

const edlTextarea = document.getElementById('edlCodeTextarea');
const ffmpegBox = document.getElementById('ffmpegOutputBox');
const timelineStrip = document.getElementById('sceneTimelinePreview');

function renderTimelinePreview(edl) {
  if (!edl?.scenes) return;
  timelineStrip.innerHTML = edl.scenes.map(s => `
    <div class="scene-chip" style="background:${s.bgColor}; color:${s.textColor};">
      <strong>${s.type.toUpperCase()} (${s.durationSec}s)</strong>
      <div style="font-size:0.7rem; margin-top:4px;">${s.captionText}</div>
    </div>
  `).join('');
}

function loadSample() {
  if (!edlTextarea) return;
  edlTextarea.value = JSON.stringify(sampleEdl, null, 2);
  renderTimelinePreview(sampleEdl);
}

document.getElementById('loadSampleEdlBtn')?.addEventListener('click', loadSample);

document.getElementById('compileEdlBtn')?.addEventListener('click', async () => {
  try {
    const parsedEdl = JSON.parse(edlTextarea.value);
    renderTimelinePreview(parsedEdl);

    const res = await fetch('/api/editor/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsedEdl)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Compilation failed');

    ffmpegBox.textContent = `${data.compiled.ffmpegCommandPreview}\n\n[Render Mode]: ${data.renderResult.mode}\n[Output File]: ${data.compiled.outputFile}`;
    await refreshDashboard();
  } catch (err) {
    ffmpegBox.textContent = `❌ EDL Compilation Error: ${err.message}`;
  }
});

loadSample();
