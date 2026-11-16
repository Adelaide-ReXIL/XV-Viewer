/* ============================================================
   app.js: state, data loading, event wiring for index.html
   ============================================================ */

/* ── Global state ─────────────────────────────────────────── */
const APP = {
  lobeData: {},   // { lobe: [{frame,sv,x,y,z}], whole: [...] }
  metrics:  {},   // { lobe: { frameNum: {vdp,hvr,vh,msv,n} } }
  metric:   'vdp',
  frame:    6,
  active:   new Set(['RUL', 'RML', 'RLL', 'LUL', 'LLL']),
  nFrames:  7,
  label:    '',
  load:     null, // loadCSVFiles() result for the current upload (null for examples)
  colorMode:   'auto', // 'auto' | 'custom': colour scale of the lung map and metrics table
  autoRange:   {},     // { metric: [min, max] } spanning every lobe and frame of the loaded data
  customRange: {},     // { metric: [min, max] } set by the user, kept in this browser
};

/* ── Colour range (lung map + metrics table) ─────────────────
   Auto: covers every lobe and frame of the loaded data, so colours stay
   stable while frames play, but differ between datasets.
   Custom: the user's own [min, max] per metric, saved in this browser so
   several animals can be viewed on one scale. */
const RANGE_KEY = 'xv-viewer.colorRange';

function _validRange(r) {
  return Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[0] < r[1];
}

function colorRange(metric) {
  if (APP.colorMode === 'custom' && _validRange(APP.customRange[metric])) return APP.customRange[metric];
  if (_validRange(APP.autoRange[metric])) return APP.autoRange[metric];
  return [METRIC_CFG[metric].min, METRIC_CFG[metric].max];
}

function _computeAutoRanges() {
  APP.autoRange = {};
  for (const met of Object.keys(METRIC_CFG)) {
    const vals = [];
    for (const byFrame of Object.values(APP.metrics))
      for (const m of Object.values(byFrame)) if (m) vals.push(m[met]);
    APP.autoRange[met] = niceRange(vals);
  }
}

function _loadRangePrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(RANGE_KEY) || 'null');
    if (p && (p.mode === 'auto' || p.mode === 'custom')) {
      APP.colorMode   = p.mode;
      APP.customRange = p.custom && typeof p.custom === 'object' ? p.custom : {};
    }
  } catch (e) { /* storage unavailable: keep the defaults */ }
}

function _saveRangePrefs() {
  try { localStorage.setItem(RANGE_KEY, JSON.stringify({ mode: APP.colorMode, custom: APP.customRange })); }
  catch (e) { /* storage unavailable: the setting lasts for this page only */ }
}

function _renderMetricColors() {
  renderLungMap();
  renderColorLegend();
  renderMetricsTable();
}

/* ── Play animation state ─────────────────────────────────── */
let _playTimer = null;

function _setFrame(f) {
  APP.frame = f;
  const sl  = document.getElementById('scatter-slider');
  const val = document.getElementById('scatter-frame-val');
  const lbl = document.getElementById('scatter-frame-label');
  if (sl)  sl.value = f;
  if (val) val.textContent = f;
  if (lbl) lbl.textContent = f;
  document.getElementById('tbl-frame').textContent = f;
  renderOnFrameChange();
}

function _startPlay() {
  if (_playTimer) return;
  const btn = document.getElementById('play-btn');
  if (btn) btn.textContent = '⏸ Pause';
  _playTimer = setInterval(() => {
    _setFrame((APP.frame + 1) % APP.nFrames);
  }, 600);
}

function _stopPlay() {
  clearInterval(_playTimer);
  _playTimer = null;
  const btn = document.getElementById('play-btn');
  if (btn) btn.textContent = '▶ Play';
}

/* ── Data ingestion ───────────────────────────────────────── */
function ingestWholeLung(voxels) {
  APP.lobeData = assignLobesFromCoords(voxels);
  _finishLoad(voxels, false);
}

function ingestLobarFiles(lobeMap) {
  const whole = [];
  for (const v of Object.values(lobeMap)) whole.push(...v);
  APP.lobeData = { ...lobeMap, whole };
  APP.lobeData._lobarUpload = true;
  _finishLoad(whole, true);
}

function _finishLoad(allVoxels, isLobar) {
  APP.nFrames = new Set(allVoxels.map(v => v.frame)).size;
  APP.frame   = APP.nFrames - 1;
  APP.metrics = buildMetricsMap(APP.lobeData, APP.nFrames);
  _computeAutoRanges();

  _stopPlay();

  /* Sync scatter frame controls */
  const sl = document.getElementById('scatter-slider');
  if (sl) { sl.max = APP.nFrames - 1; sl.value = APP.frame; }
  const val = document.getElementById('scatter-frame-val');
  if (val) val.textContent = APP.frame;
  const lbl = document.getElementById('scatter-frame-label');
  if (lbl) lbl.textContent = APP.frame;

  document.getElementById('tbl-frame').textContent = APP.frame;
  const hint = document.getElementById('scatter-frame-hint');
  if (hint) hint.textContent = `(0 = start of inspiration → ${APP.nFrames - 1} = end)`;
  document.getElementById('lobe-note').textContent = lobeDefinitionText(isLobar);

  /* Info bar: per-frame files need not contain the same voxels, so show the range */
  const perFrame = new Map();
  for (const v of allVoxels) perFrame.set(v.frame, (perFrame.get(v.frame) || 0) + 1);
  const nLo = Math.min(...perFrame.values()), nHi = Math.max(...perFrame.values());
  const voxTxt = nLo === nHi ? nLo.toLocaleString()
                             : `${nLo.toLocaleString()} to ${nHi.toLocaleString()} per frame`;
  const info = document.getElementById('data-info');
  info.hidden = false;
  info.className = '';
  info.innerHTML =
    `<strong>${escapeHTML(APP.label)}</strong>
     <span class="info-pill">Frames: ${APP.nFrames}</span>
     <span class="info-pill">Voxels: ${voxTxt}</span>
     <span class="info-pill">Mode: ${isLobar ? 'lobar files' : 'auto-segmented'}</span>` +
    loadDetailsHTML(APP.load);

  document.getElementById('viz').hidden = false;
  renderAll();
}

/* ── Example loader ───────────────────────────────────────── */
function loadExample(type) {
  _loadSeq++;   // drop any upload still being parsed
  APP.label = type === 'cf' ? 'CF Patient (example)' : 'Healthy Control (example)';
  APP.load  = null;
  ingestWholeLung(parseRawArray(type === 'cf' ? SAMPLE_CF : SAMPLE_CTRL));
}

/* ── File upload ──────────────────────────────────────────── */
/* One or more CSVs: a _final.csv, per-frame files (…pp.00.csv … pp.04.csv)
   or lobar files; see loadCSVFiles() in common.js */
let _loadSeq = 0;

async function handleFiles(files) {
  const fa = [...files];
  if (!fa.length) return;
  const seq = ++_loadSeq;
  renderLoadStatus(fa.length);
  try {
    const res = await loadCSVFiles(fa);
    if (seq !== _loadSeq) return;   // superseded by a newer upload
    APP.label = res.label;
    APP.load  = res;
    if (res.isLobar) ingestLobarFiles(res.lobeMap); else ingestWholeLung(res.voxels);
  } catch (err) {
    if (seq !== _loadSeq) return;
    console.error(err);
    _stopPlay();
    renderLoadError(err);
  }
}

/* ── Event wiring ─────────────────────────────────────────── */
function initEvents() {
  /* Drop zone */
  const dz  = document.getElementById('drop-zone');
  const fin = document.getElementById('file-input');
  dz.addEventListener('click',     () => fin.click());
  fin.addEventListener('change',   e  => {
    const fa = [...e.target.files];
    e.target.value = '';            // so re-selecting the same files fires 'change' again
    handleFiles(fa);
  });
  dz.addEventListener('dragover',  e  => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop',      e  => {
    e.preventDefault(); dz.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });

  /* Metric tabs */
  document.getElementById('metric-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.mtab');
    if (!btn) return;
    document.querySelectorAll('#metric-tabs .mtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    APP.metric = btn.dataset.m;
    _renderMetricColors();
  });

  /* Colour range: Auto / Custom, and the custom min / max of the current metric */
  _loadRangePrefs();
  document.getElementById('range-mode').addEventListener('change', e => {
    APP.colorMode = e.target.value;
    /* start a custom range from what is on screen now */
    if (APP.colorMode === 'custom' && !_validRange(APP.customRange[APP.metric]))
      APP.customRange[APP.metric] = [...colorRange(APP.metric)];
    _saveRangePrefs();
    _renderMetricColors();
  });
  const onRangeEdit = () => {
    const lo = parseFloat(document.getElementById('range-min').value);
    const hi = parseFloat(document.getElementById('range-max').value);
    if (_validRange([lo, hi])) {
      APP.customRange[APP.metric] = [lo, hi];
      _saveRangePrefs();
    }
    _renderMetricColors();   // an invalid entry (e.g. min ≥ max) snaps back to the range in use
  };
  document.getElementById('range-min').addEventListener('change', onRangeEdit);
  document.getElementById('range-max').addEventListener('change', onRangeEdit);

  /* 3D scatter frame slider */
  document.getElementById('scatter-slider').addEventListener('input', e => {
    _stopPlay();
    _setFrame(+e.target.value);
  });

  /* Play / pause button */
  document.getElementById('play-btn').addEventListener('click', () => {
    if (_playTimer) _stopPlay(); else _startPlay();
  });

  /* Lobe toggles */
  document.getElementById('lobe-toggles').addEventListener('click', e => {
    const btn = e.target.closest('.ltog');
    if (!btn) return;
    const lobe = btn.dataset.lobe;
    if (APP.active.has(lobe)) APP.active.delete(lobe); else APP.active.add(lobe);
    btn.classList.toggle('active', APP.active.has(lobe));
    renderAll();
  });

  /* Distribution mode selector */
  document.getElementById('dist-mode').addEventListener('change', renderDistChart);

  /* Lung map hover */
  bindLungMapHover();
}

document.addEventListener('DOMContentLoaded', initEvents);
