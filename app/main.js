// App controller: state machine, analysis loop, UI wiring (spec §6, §7).
import { startRearCamera, classifyCameraError, CAMERA_ERROR_TEXT } from './camera.js';
import { detectCandidates } from './detector.js';
import { classifyMarkers } from './geometry.js';
import { loadRatios, DEFAULT_SELECTED } from './levels.js';
import { render } from './render.js';
import { markerTag } from './markerTag.js';
import { createMarkerLock } from './lock.js';

const CV_SRC = 'vendor/opencv-4.13.0.js';
const CV_SLOW_MS = 30000; // after this, tell the user it is slow but keep waiting

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const TEST = params.has('test');

const $ = (id) => document.getElementById(id);
const els = {
  view: $('view'), video: $('video'), status: $('status'),
  start: $('startPanel'), startBtn: $('startBtn'), cvNote: $('cvNote'),
  error: $('errorPanel'), errorText: $('errorText'), retryBtn: $('retryBtn'),
  levels: $('levels'), allBtn: $('allBtn'), noneBtn: $('noneBtn'), reBtn: $('reanalyzeBtn'), tag: $('markerTag'),
  testRow: $('testRow'), testInput: $('testInput'),
  debug: $('debugPanel'), mask: $('maskPreview'),
};

// mode: idle | requesting | live | test | error
const app = {
  mode: 'idle',
  cv: null, cvState: 'loading', // loading | ready | failed
  cfg: null, ratios: [], selected: new Set(DEFAULT_SELECTED),
  stream: null, busy: false,
  session: 0, // bumped on every camera start/stop; stale frame callbacks exit
  src: document.createElement('canvas'), // current frame at source resolution
  result: null, // {markers?, reason, candidates, rejected, maskPreview?}
  errorKind: null, // camera error kind or 'cv' / 'config'
  lock: createMarkerLock(), // live mode: hold markers once stably recognized
  lockState: { state: 'searching', markers: null, progress: 0 },
};
const srcCtx = app.src.getContext('2d', { willReadFrequently: true });

// ---------- OpenCV.js loading (with retry) ----------
function loadCv() {
  if (app.cvState === 'loading' && document.querySelector('script[data-cv]')) return;
  app.cvState = 'loading';
  app.cvSlow = false;
  updateUi();
  return new Promise((resolve, reject) => {
    const done = () => {
      clearInterval(poll); clearTimeout(timer);
      // Never resolve with `cv` itself: the Emscripten module is a thenable.
      resolve();
    };
    window.Module = { onRuntimeInitialized: done };
    const s = document.createElement('script');
    s.src = CV_SRC;
    s.async = true;
    s.onerror = () => { clearInterval(poll); clearTimeout(timer); reject(new Error('script load failed')); };
    document.querySelector(`script[data-cv]`)?.remove();
    s.dataset.cv = '1';
    document.head.appendChild(s);
    const poll = setInterval(() => { if (window.cv?.Mat && window.cv?.findContours) done(); }, 200);
    // A slow network is not a failure: keep polling and accept a late success.
    const timer = setTimeout(() => { app.cvSlow = true; updateUi(); }, CV_SLOW_MS);
  }).then(() => {
    app.cv = window.cv;
    app.cvState = 'ready';
    updateUi();
    if (app.mode === 'test' && app.src.width) analyzeCurrent();
  }, (err) => {
    console.error('[opencv]', err);
    app.cvState = 'failed';
    updateUi();
  });
}

// ---------- Camera ----------
async function startCamera() {
  stopCamera();
  const session = app.session;
  app.mode = 'requesting';
  updateUi();
  try {
    const stream = await startRearCamera();
    if (session !== app.session) { for (const t of stream.getTracks()) t.stop(); return; }
    app.stream = stream;
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => {
      if (app.stream === stream) fail('ended');
    });
    els.video.srcObject = stream;
    await els.video.play();
    app.mode = 'live';
    app.result = null;
    resetLock();
    updateUi();
    scheduleFrame(session);
  } catch (err) {
    console.error('[camera]', err);
    stopCamera();
    fail(classifyCameraError(err, window.isSecureContext));
  }
}

function stopCamera() {
  app.session++; // invalidates any pending requestVideoFrameCallback chain
  if (app.stream) for (const t of app.stream.getTracks()) t.stop();
  app.stream = null;
  els.video.srcObject = null;
}

function fail(kind) {
  stopCamera();
  app.mode = 'error';
  app.errorKind = kind;
  app.result = null;
  updateUi();
}

// ---------- Analysis loop ----------
function scheduleFrame(session) {
  if (session !== app.session) return;
  if (app.mode !== 'live') return;
  const v = els.video;
  const next = () => onFrame(session);
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(next);
  else requestAnimationFrame(next);
}

function onFrame(session) {
  if (session !== app.session) return; // callback from a previous camera session
  if (app.mode === 'live' && !app.busy) {
    app.busy = true;
    try {
      const v = els.video;
      if (v.videoWidth && v.videoHeight) {
        // Re-read dimensions every frame: they can change on rotation.
        if (app.src.width !== v.videoWidth || app.src.height !== v.videoHeight) {
          app.src.width = v.videoWidth;
          app.src.height = v.videoHeight;
        }
        srcCtx.drawImage(v, 0, 0);
        if (app.lockState.state === 'locked') {
          draw(); // keep the live video; markers stay locked, no detection
        } else {
          analyzeCurrent();
          app.lockState = app.lock.update(app.result, app.src.height);
          if (app.lockState.state === 'locked') { draw(); updateStatus(); syncMarkerTag(); syncReanalyze(); }
        }
      }
    } catch (err) {
      console.error('[analyze]', err);
      app.result = null; // never keep stale positions after a failed frame
      draw();
    } finally {
      app.busy = false;
    }
  }
  scheduleFrame(session);
}

/** Detect + classify on app.src. Invalid frames clear the result entirely. */
function analyzeCurrent() {
  if (app.cvState !== 'ready' || !app.cfg) {
    app.result = null;
    draw();
    updateStatus();
    return;
  }
  const { width, height } = app.src;
  const image = srcCtx.getImageData(0, 0, width, height);
  const det = detectCandidates(app.cv, image, app.cfg, { debug: DEBUG });
  const cls = classifyMarkers(det.candidates, height, app.cfg.minVerticalGapFrac);
  app.result = { ...det, markers: cls.ok ? cls.markers : null, reason: cls.ok ? 'ok' : cls.reason };
  draw();
  updateStatus();
  syncMarkerTag();
  if (DEBUG) updateDebug();
}

// ---------- Rendering ----------
function selectedLevels() {
  return app.ratios.filter((l) => app.selected.has(l.name));
}

function draw() {
  if (app.mode === 'live' && app.lockState.state === 'locked') {
    render(els.view, app.src, { markers: app.lockState.markers }, selectedLevels(), {});
  } else if (app.mode === 'live' || app.mode === 'test') {
    render(els.view, app.src.width ? app.src : null, app.result, selectedLevels(), { debug: DEBUG });
  } else {
    render(els.view, null, null, []);
  }
}

// ---------- UI ----------
const REASON_TEXT = {
  too_few: '마커 3개(C7, 좌·우 PSIS)가 모두 보이도록 촬영하세요',
  too_many: '빨간 후보가 너무 많습니다 — 주변의 빨간 물체를 치우거나 화면에서 빼주세요',
  bad_layout: 'C7이 위, PSIS 2개가 아래에 오도록 등 뒤에서 똑바로 촬영하세요',
};

// Floating toast over the camera view. It never takes layout space, so the
// frame size does not change when the message length changes. Hidden while
// recognition succeeds (the marker tag already says 3/3).
function setStatus(text, tone) {
  if (els.status.textContent !== text) els.status.textContent = text;
  els.status.dataset.tone = tone;
  els.status.classList.toggle('show', tone !== 'ok' && text !== '');
}

function updateStatus() {
  switch (app.mode) {
    case 'idle': return setStatus('카메라를 시작하세요', 'idle');
    case 'requesting': return setStatus('카메라 권한을 요청하는 중…', 'idle');
    case 'error': return setStatus('오류', 'error');
  }
  if (app.cvState === 'loading') return setStatus(app.cvSlow ? '인식 엔진을 불러오는 중… 네트워크가 느립니다. 잠시 기다려 주세요.' : '인식 엔진(OpenCV) 불러오는 중…', 'idle');
  if (app.cvState === 'failed') return setStatus('인식 엔진을 불러오지 못했습니다', 'error');
  if (app.mode === 'live' && app.lockState.state === 'locked') return setStatus('위치 고정됨 — 다시 분석하려면 [다시 분석]', 'ok');
  if (!app.result) return setStatus(app.mode === 'test' ? '테스트 이미지를 선택하세요' : '인식 대기 중…', 'warn');
  if (app.result.markers) return setStatus(app.mode === 'test' ? '인식 성공 (테스트 이미지)' : '● 인식 중', 'ok');
  return setStatus(REASON_TEXT[app.result.reason] ?? '마커를 인식하지 못했습니다', 'warn');
}

function updateUi() {
  const m = app.mode;
  els.start.hidden = m !== 'idle' || TEST;
  els.cvNote.textContent = app.cvState === 'loading' ? '인식 엔진을 불러오는 중입니다. 카메라는 먼저 시작할 수 있습니다.' : '';

  const cvFailed = app.cvState === 'failed';
  const showError = m === 'error' || cvFailed;
  els.error.hidden = !showError;
  if (showError) {
    els.errorText.textContent = m === 'error'
      ? (CAMERA_ERROR_TEXT[app.errorKind] ?? CAMERA_ERROR_TEXT.unknown)
      : '인식 엔진(OpenCV.js)을 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.';
    els.retryBtn.dataset.target = m === 'error' ? 'camera' : 'cv';
  }

  syncMarkerTag();
  syncReanalyze();
  document.body.dataset.mode = m;
  updateStatus();
  draw();
}

// Top-left glass tag: how many markers the current frame has (n/3).
function syncMarkerTag() {
  const show = (app.mode === 'live' || app.mode === 'test') && app.cvState === 'ready';
  els.tag.hidden = !show;
  if (!show) return;
  const { text, tone } = markerTag(app.result, app.mode === 'live' ? app.lockState.state : 'searching');
  els.tag.textContent = text;
  els.tag.dataset.tone = tone;
}

// ---------- Lock / re-analyze ----------
function resetLock() {
  app.lock.reset();
  app.lockState = app.lock.state();
  app.result = null;
  syncReanalyze();
}

function reanalyze() {
  resetLock();
  updateUi();
}

function syncReanalyze() {
  els.reBtn.disabled = !(app.mode === 'live' && app.lockState.state === 'locked');
}

function buildLevelChips() {
  els.levels.replaceChildren(...app.ratios.map((lv) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = lv.name;
    b.title = `${lv.ratio}%`;
    b.setAttribute('aria-pressed', String(app.selected.has(lv.name)));
    b.addEventListener('click', () => {
      if (app.selected.has(lv.name)) app.selected.delete(lv.name); else app.selected.add(lv.name);
      b.setAttribute('aria-pressed', String(app.selected.has(lv.name)));
      draw();
    });
    return b;
  }));
}

function setAll(on) {
  app.selected = new Set(on ? app.ratios.map((l) => l.name) : []);
  for (const b of els.levels.children) b.setAttribute('aria-pressed', String(on));
  draw();
}

function updateDebug() {
  const r = app.result;
  if (!r) return;
  const lines = [
    `frame ${app.src.width}×${app.src.height}`,
    `candidates ${r.candidates.length} → ${r.reason}`,
    ...r.candidates.map((c, i) => `  #${i} (${c.x.toFixed(0)}, ${c.y.toFixed(0)}) A=${c.area.toFixed(0)} circ=${c.circularity.toFixed(2)}${c.hsv ? ` HSV=${c.hsv.join('/')}` : ''}`),
    `rejected ${r.rejected.length}`,
    ...r.rejected.slice(0, 8).map((c) => `  ${c.why} (${c.x.toFixed(0)}, ${c.y.toFixed(0)}) A=${c.area.toFixed(0)} circ=${c.circularity.toFixed(2)}${c.hsv ? ` HSV=${c.hsv.join('/')}` : ''}`),
  ];
  els.debug.textContent = lines.join('\n');
  if (r.maskPreview) {
    const { width, height, data } = r.maskPreview;
    els.mask.width = width;
    els.mask.height = height;
    els.mask.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
  }
}

async function onTestImage(file) {
  if (!file) return;
  const bmp = await createImageBitmap(file);
  app.src.width = bmp.width;
  app.src.height = bmp.height;
  srcCtx.drawImage(bmp, 0, 0);
  bmp.close();
  app.mode = 'test';
  app.result = null;
  analyzeCurrent();
  updateUi();
}

// ---------- Boot ----------
async function boot() {
  els.debug.hidden = !DEBUG;
  els.mask.hidden = !DEBUG;
  els.testRow.hidden = !TEST;
  if (TEST) app.mode = 'test';

  els.startBtn.addEventListener('click', startCamera);
  els.retryBtn.addEventListener('click', () => {
    if (els.retryBtn.dataset.target === 'cv') loadCv(); else startCamera();
  });
  els.allBtn.addEventListener('click', () => setAll(true));
  els.noneBtn.addEventListener('click', () => setAll(false));
  els.reBtn.addEventListener('click', reanalyze);
  els.testInput.addEventListener('change', () => onTestImage(els.testInput.files[0]));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.stream && els.video.paused) {
      els.video.play().catch((err) => console.warn('[camera] resume play failed', err));
    }
  });
  window.addEventListener('resize', draw);
  window.addEventListener('orientationchange', draw);

  loadCv();
  try {
    const [ratios, cfg] = await Promise.all([
      loadRatios(),
      fetch('config/detection.json', { cache: 'no-cache' }).then((r) => {
        if (!r.ok) throw new Error(`detection.json ${r.status}`);
        return r.json();
      }),
    ]);
    app.ratios = ratios.levels;
    app.cfg = cfg;
    buildLevelChips();
    els.startBtn.disabled = false;
  } catch (err) {
    console.error('[config]', err);
    setStatus('설정 파일을 불러오지 못했습니다. 새로고침하세요.', 'error');
    els.startBtn.disabled = true;
    return;
  }
  updateUi();
}

boot();
