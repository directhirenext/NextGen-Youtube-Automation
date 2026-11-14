import { refreshDashboard } from './app.js';

const sampleEdl = {
  title: 'Pan-India Direct Hiring Walk-In Drive 2026',
  aspectRatio: '16:9',
  fps: 30,
  manualStudio: {
    sourceVideoFile: null,
    voiceoverAudioFile: null,
    bgmAudioFile: null,
    overlayFile: null,
    muteOriginalVideoAudio: false,
    originalVideoVolume: 1.0,
    voiceoverVolume: 1.2,
    bgmVolume: 0.25,
    noiseCancellation: true,
    autoDucking: true,
    loudnessNormalization: true,
    removeSilence: false,
    visualFilter: 'cinematic',
    playbackSpeed: 1.0,
    startTrimSec: 0,
    endTrimSec: 0,
    chromaKeyGreen: false,
    burnSubtitles: true
  },
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

function bindRangeLabel(sliderId, labelId) {
  const slider = document.getElementById(sliderId);
  const label = document.getElementById(labelId);
  if (slider && label) {
    slider.addEventListener('input', () => {
      label.textContent = slider.value;
    });
  }
}

bindRangeLabel('origVolSlider', 'origVolVal');
bindRangeLabel('voiceVolSlider', 'voiceVolVal');
bindRangeLabel('bgmVolSlider', 'bgmVolVal');
bindRangeLabel('speedSlider', 'speedVal');

function readManualControlsIntoObject() {
  return {
    sourceVideoFile: document.getElementById('studioVideoSelect')?.value || null,
    voiceoverAudioFile: document.getElementById('studioVoiceSelect')?.value || null,
    bgmAudioFile: document.getElementById('studioBgmSelect')?.value || null,
    overlayFile: document.getElementById('studioOverlaySelect')?.value || null,
    muteOriginalVideoAudio: Boolean(document.getElementById('muteOrigAudioToggle')?.checked),
    originalVideoVolume: Number(document.getElementById('origVolSlider')?.value ?? 1.0),
    voiceoverVolume: Number(document.getElementById('voiceVolSlider')?.value ?? 1.2),
    bgmVolume: Number(document.getElementById('bgmVolSlider')?.value ?? 0.25),
    noiseCancellation: Boolean(document.getElementById('denoiseToggle')?.checked),
    autoDucking: Boolean(document.getElementById('autoDuckToggle')?.checked),
    loudnessNormalization: Boolean(document.getElementById('loudnormToggle')?.checked),
    removeSilence: Boolean(document.getElementById('removeSilenceToggle')?.checked),
    chromaKeyGreen: Boolean(document.getElementById('chromaKeyToggle')?.checked),
    visualFilter: document.getElementById('visualFilterSelect')?.value || 'none',
    playbackSpeed: Number(document.getElementById('speedSlider')?.value ?? 1.0),
    startTrimSec: Number(document.getElementById('startTrimInput')?.value ?? 0),
    endTrimSec: Number(document.getElementById('endTrimInput')?.value ?? 0),
    burnSubtitles: true
  };
}

function renderTimelinePreview(edl) {
  if (!edl?.scenes || !timelineStrip) return;
  timelineStrip.innerHTML = '';
  edl.scenes.forEach(s => {
    const chip = document.createElement('div');
    chip.className = 'scene-chip';
    chip.style.background = s.bgColor || '#0f172a';
    chip.style.color = s.textColor || '#38bdf8';

    const titleStrong = document.createElement('strong');
    titleStrong.textContent = `${String(s.type).toUpperCase()} (${Number(s.durationSec)}s)`;

    const capDiv = document.createElement('div');
    capDiv.style.fontSize = '0.7rem';
    capDiv.style.marginTop = '4px';
    capDiv.textContent = s.captionText || '';

    chip.appendChild(titleStrong);
    chip.appendChild(capDiv);
    timelineStrip.appendChild(chip);
  });
}

function loadSample() {
  if (!edlTextarea) return;
  edlTextarea.value = JSON.stringify(sampleEdl, null, 2);
  renderTimelinePreview(sampleEdl);
}

document.getElementById('loadSampleEdlBtn')?.addEventListener('click', loadSample);

document.getElementById('syncStudioToEdlBtn')?.addEventListener('click', () => {
  try {
    const current = JSON.parse(edlTextarea.value || '{}');
    current.manualStudio = readManualControlsIntoObject();
    edlTextarea.value = JSON.stringify(current, null, 2);
    renderTimelinePreview(current);
  } catch (err) {
    alert(`Invalid JSON in editor: ${err.message}`);
  }
});

document.getElementById('compileEdlBtn')?.addEventListener('click', async () => {
  try {
    const parsedEdl = JSON.parse(edlTextarea.value);
    parsedEdl.manualStudio = {
      ...(parsedEdl.manualStudio || {}),
      ...readManualControlsIntoObject()
    };
    edlTextarea.value = JSON.stringify(parsedEdl, null, 2);
    renderTimelinePreview(parsedEdl);

    const res = await fetch('/api/editor/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsedEdl)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Compilation failed');

    ffmpegBox.textContent =
      `[FFmpeg Multi-Track Command]:\n${data.compiled.ffmpegCommandPreview}\n\n` +
      `[Render Mode]: ${data.renderResult.mode}\n` +
      `[Output Video]: ${data.compiled.outputFile}\n` +
      `[Generated Subtitles]: ${data.compiled.srtFile}\n` +
      `[Auto YouTube Chapters]:\n${data.compiled.chaptersText}`;
    await refreshDashboard();
  } catch (err) {
    ffmpegBox.textContent = `❌ Studio Compilation Error: ${err.message}`;
  }
});

loadSample();
