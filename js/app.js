/* ============================================================
   app.js — state, data loading, event wiring for index.html
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
};

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

  _stopPlay();

  /* Sync scatter frame controls */
  const sl = document.getElementById('scatter-slider');
  if (sl) { sl.max = APP.nFrames - 1; sl.value = APP.frame; }
  const val = document.getElementById('scatter-frame-val');
  if (val) val.textContent = APP.frame;
  const lbl = document.getElementById('scatter-frame-label');
  if (lbl) lbl.textContent = APP.frame;

  document.getElementById('tbl-frame').textContent = APP.frame;

  /* Info bar */
  const nV   = allVoxels.filter(v => v.frame === 0).length;
  const info = document.getElementById('data-info');
  info.hidden = false;
  info.innerHTML =
    `<strong>${APP.label}</strong>
     <span class="info-pill">Frames: ${APP.nFrames}</span>
     <span class="info-pill">Voxels: ${nV.toLocaleString()}</span>
     <span class="info-pill">Mode: ${isLobar ? 'lobar files' : 'auto-segmented'}</span>`;

  document.getElementById('viz').hidden = false;
  renderAll();
}

/* ── Example loader ───────────────────────────────────────── */
function loadExample(type) {
  APP.label = type === 'cf' ? 'CF Patient (example)' : 'Healthy Control (example)';
  ingestWholeLung(parseRawArray(type === 'cf' ? SAMPLE_CF : SAMPLE_CTRL));
}

/* ── File upload ──────────────────────────────────────────── */
function handleFiles(files) {
  const fa = [...files];
  APP.label = fa[0].name.replace(/_final\.csv$/i, '');

  if (fa.some(f => detectLobeFromName(f.name))) {
    const res = {}, pending = { n: fa.length };
    fa.forEach(file => {
      const lobe = detectLobeFromName(file.name) || 'whole';
      Papa.parse(file, {
        complete(r) {
          res[lobe] = parseCSVResult(r);
          if (--pending.n === 0) ingestLobarFiles(res);
        },
        skipEmptyLines: true,
      });
    });
  } else {
    Papa.parse(fa[0], {
      complete(r) { ingestWholeLung(parseCSVResult(r)); },
      skipEmptyLines: true,
    });
  }
}

/* ── Event wiring ─────────────────────────────────────────── */
function initEvents() {
  /* Drop zone */
  const dz  = document.getElementById('drop-zone');
  const fin = document.getElementById('file-input');
  dz.addEventListener('click',     () => fin.click());
  fin.addEventListener('change',   e  => handleFiles(e.target.files));
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
    renderLungMap();
    renderColorLegend();
    renderMetricsTable();
  });

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
