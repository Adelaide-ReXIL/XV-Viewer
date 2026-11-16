/* ============================================================
   XV Viewer: shared utilities
   ============================================================ */

const LOBES = ['RUL', 'RML', 'RLL', 'LUL', 'LLL'];

const LOBE_META = {
  RUL: { label: 'Right Upper', color: '#3b82f6' },
  RML: { label: 'Right Middle', color: '#10b981' },
  RLL: { label: 'Right Lower', color: '#f59e0b' },
  LUL: { label: 'Left Upper', color: '#8b5cf6' },
  LLL: { label: 'Left Lower', color: '#ef4444' },
  whole: { label: 'Whole Lung', color: '#1e293b' },
};

/* Thresholds as multiples of the mean SV.
   VDP: SV below 60% of the mean is a ventilation defect, the XV convention
   (4DMedical XV/CT LVAS; Mathew, Thomen et al.; XV mouse and rat studies). */
const VDP_THRESHOLD  = 0.6;
const VHIP_THRESHOLD = 1.674;

const METRIC_CFG = {
  vdp: { label: 'VDP %',  desc: 'Ventilation Defect %',       unit: '%',  lo: '#22c55e', hi: '#ef4444', min: 0, max: 50  },
  vh:  { label: 'VH %',   desc: 'Ventilation Heterogeneity',  unit: '%',  lo: '#22c55e', hi: '#ef4444', min: 0, max: 160 },
  msv: { label: 'MSV',    desc: 'Mean Specific Ventilation',  unit: '',   lo: '#dbeafe', hi: '#1e40af', min: 0, max: 0.12 },
  hvr: { label: 'V_hip %', desc: 'High-Ventilation %',        unit: '%',  lo: '#f5f3ff', hi: '#6d28d9', min: 0, max: 30  },
};
/* min / max above are only a fallback: the colour scale normally comes from the loaded
   data (niceRange) or from a range the user sets on the dashboard. */

/* ── CSV parsing ─────────────────────────────────────────── */
/*
  Supported header variants (case-insensitive, units in parens stripped):

  Frame:   "frame"                              | absent → all rows = frame 0
  SV:      "divergence.0, 0", "divergence…"    | clinical (_final.csv)
           "Specific Ventilation (mL/mL)"       | animal (.specificVentilation.csv)
           "sv"                                 | generic
  X:       "position.x", "positionx", "x", "x (mm)"
  Y:       "position.y", "positiony", "y", "y (mm)"
  Z:       "position.z", "positionz", "z", "z (mm)"
*/
function parseCSVResult(papaResult) {
  return parseCSVMeta(papaResult).voxels;
}

/* Same as parseCSVResult, plus what the loader needs to know about the file:
   { voxels, hasFrame (file has its own Frame column), recognised (headers matched) } */
function parseCSVMeta(papaResult) {
  const raw = papaResult.data;
  const unrecognised = { voxels: [], hasFrame: false, recognised: false };
  if (!raw || !raw.length) return unrecognised;

  // Normalise: lowercase, strip quotes/spaces, strip (units)
  const headers = raw[0].map(h => String(h).trim()
    .toLowerCase().replace(/["' ]/g, '').replace(/\(.*?\)/g, '').trim());

  const fi = headers.findIndex(h => h === 'frame');
  const si = headers.findIndex(h =>
    h.startsWith('divergence') ||
    h === 'sv' ||
    h.startsWith('specificventilation') ||
    h.startsWith('specificvent'));
  const xi = headers.findIndex(h => h === 'position.x' || h === 'positionx' || h === 'x');
  const yi = headers.findIndex(h => h === 'position.y' || h === 'positiony' || h === 'y');
  const zi = headers.findIndex(h => h === 'position.z' || h === 'positionz' || h === 'z');

  /* SV and coordinates are required; Frame is optional (single-frame files) */
  if ([si, xi, yi, zi].some(i => i < 0)) {
    console.warn('Header not recognised:', headers); return unrecognised;
  }

  const singleFrame = fi < 0;

  const out = [];
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r];
    if (!row || row.length < 4) continue;
    const frame = singleFrame ? 0 : parseInt(row[fi]);
    const sv    = parseFloat(row[si]);
    const x     = parseFloat(row[xi]);
    const y     = parseFloat(row[yi]);
    const z     = parseFloat(row[zi]);
    if ([sv, x, y, z].some(isNaN)) continue;
    if (!singleFrame && isNaN(frame)) continue;
    out.push({ frame, sv, x, y, z });
  }
  return { voxels: out, hasFrame: !singleFrame, recognised: true };
}

/* ── Frame index from a per-frame filename ───────────────── */
/*
  Per-frame exports carry the breath frame in the filename:
    24.specific_ventilation.insp.pp.03.csv  → 3      (pp = phase point)
  Recognised tokens (case-insensitive): pp, phase_point, phase, frame, fr, tp,
  optionally followed by . _ - or a space, then digits. The last token wins.
  Returns null when the name has no such token.
*/
const FRAME_TOKEN = '(?:pp|phase[._\\- ]?point|phase|frame|fr|tp)';
const FRAME_TOKEN_RE = new RegExp(`(?:^|[^a-z])${FRAME_TOKEN}[._\\- ]?(\\d+)`, 'gi');

function frameKeyFromName(filename) {
  const hits = [...filename.replace(/\.csv$/i, '').matchAll(FRAME_TOKEN_RE)];
  return hits.length ? parseInt(hits[hits.length - 1][1], 10) : null;
}

function _lastNumberInName(filename) {
  const m = filename.replace(/\.csv$/i, '').match(/(\d+)(?!.*\d)/);
  return m ? parseInt(m[1], 10) : null;
}

const _natCmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/* ── Loading one or more CSV files ───────────────────────── */
/*
  Accepted selections:
    • one file with a Frame column (clinical _final.csv, mesh_data.csv)
    • one single-frame file (e.g. .specificVentilation.csv) → frame 0
    • several single-frame files, one per breath frame
      (e.g. …insp.pp.00.csv … …insp.pp.04.csv) → frame order from the filenames
    • lobar files (filename contains RUL/RML/RLL/LUL/LLL); each lobe may be one
      file with a Frame column, or its own set of per-frame files

  Resolves to { isLobar, voxels, lobeMap, label, nFiles, frameSources, skipped }:
    frameSources: [{ frame, key, names }] for per-frame uploads, else null
    skipped:      [{ name, reason }] for files that were left out
  Rejects with a user-facing Error when the selection is ambiguous.
*/
function _parseCSVFile(file) {
  return new Promise(resolve => {
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: r => resolve({ name: file.name, ...parseCSVMeta(r) }),
      error:    e => resolve({ name: file.name, voxels: [], hasFrame: false, recognised: false,
                               error: (e && e.message) || String(e) }),
    });
  });
}

async function loadCSVFiles(fileList) {
  const skipped = [];
  const csvFiles = [];
  for (const f of fileList) {
    if (/\.csv$/i.test(f.name)) csvFiles.push(f);
    else skipped.push({ name: f.name, reason: 'not a .csv file' });
  }

  let files = [];
  for (const p of await Promise.all(csvFiles.map(_parseCSVFile))) {
    if (p.error)               skipped.push({ name: p.name, reason: `could not be read (${p.error})` });
    else if (!p.recognised)    skipped.push({ name: p.name, reason: 'SV / x / y / z columns not found' });
    else if (!p.voxels.length) skipped.push({ name: p.name, reason: 'no valid data rows' });
    else files.push({ ...p, lobe: detectLobeFromName(p.name) });
  }
  const fail = msg => { const e = new Error(msg); e.skipped = skipped; return e; };
  if (!files.length) throw fail('None of the selected files contain XV data.');

  /* Lobar upload: a file without a lobe code would be double-counted in the whole lung */
  const isLobar = files.some(f => f.lobe);
  if (isLobar) {
    for (const f of files) if (!f.lobe)
      skipped.push({ name: f.name, reason: 'no lobe code in filename, but other files are lobar' });
    files = files.filter(f => f.lobe);
  }

  const multi  = files.filter(f => f.hasFrame);
  const single = files.filter(f => !f.hasFrame);
  if (multi.length && single.length) {
    throw fail(`Can't combine ${multi[0].name} (has a Frame column) with single-frame files ` +
               `such as ${single[0].name}. Load one kind at a time.`);
  }

  const groups = {};   // 'whole' or lobe code → files
  for (const f of files) (groups[f.lobe || 'whole'] = groups[f.lobe || 'whole'] || []).push(f);
  const groupName = g => (g === 'whole' ? 'the whole lung' : g);

  let frameSources = null;
  if (multi.length) {
    for (const [g, fs] of Object.entries(groups)) if (fs.length > 1) {
      throw fail(`${fs.length} files with a Frame column were given for ${groupName(g)} ` +
                 `(${fs.map(f => f.name).join(', ')}). Load one at a time.`);
    }
  } else if (Object.values(groups).some(fs => fs.length > 1)) {
    frameSources = _assignFramesFromNames(groups, skipped, fail, groupName);
  }
  /* otherwise: one single-frame file per group → everything stays frame 0 */

  const voxels = [], lobeMap = {}, used = [];
  for (const [g, fs] of Object.entries(groups)) {
    for (const f of fs) {
      used.push(f.name);
      if (isLobar) lobeMap[g] = lobeMap[g] || [];
      for (const v of f.voxels) { voxels.push(v); if (isLobar) lobeMap[g].push(v); }
    }
  }
  if (!voxels.length) throw fail('None of the selected files could be placed in a frame.');

  return { isLobar, voxels, lobeMap, label: _labelFromNames(used), nFiles: used.length,
           frameSources, skipped };
}

/* Per-frame files: set each voxel's frame from its filename. Frame keys are
   re-indexed to 0…N-1 across all groups, so RUL.pp.02 and LUL.pp.02 stay aligned. */
function _assignFramesFromNames(groups, skipped, fail, groupName) {
  const all = Object.values(groups).flat();

  /* 1. explicit token: pp.03, frame_3, phase-3 … */
  const keyOf = new Map(all.map(f => [f, frameKeyFromName(f.name)]));
  if (![...keyOf.values()].some(k => k != null)) {
    /* 2. no tokens anywhere: last number in the name, if it tells files apart */
    all.forEach(f => keyOf.set(f, _lastNumberInName(f.name)));
    const distinct = Object.values(groups).every(fs => {
      const ks = fs.map(f => keyOf.get(f));
      return ks.every(k => k != null) && new Set(ks).size === ks.length;
    });
    /* 3. otherwise plain filename order */
    if (!distinct) for (const fs of Object.values(groups))
      [...fs].sort((a, b) => _natCmp(a.name, b.name)).forEach((f, i) => keyOf.set(f, i));
  }

  for (const g of Object.keys(groups)) {
    groups[g] = groups[g].filter(f => {
      if (keyOf.get(f) != null) return true;
      skipped.push({ name: f.name, reason: 'no frame number in filename (expected e.g. "pp.03")' });
      return false;
    });
    const seen = new Map();
    for (const f of groups[g]) {
      const k = keyOf.get(f);
      if (seen.has(k)) throw fail(`${seen.get(k)} and ${f.name} both look like frame ${k} of ${groupName(g)}.`);
      seen.set(k, f.name);
    }
  }

  const keys = [...new Set(Object.values(groups).flat().map(f => keyOf.get(f)))].sort((a, b) => a - b);
  const index = new Map(keys.map((k, i) => [k, i]));
  const sources = keys.map((key, frame) => ({ frame, key, names: [] }));
  for (const f of Object.values(groups).flat()) {
    const frame = index.get(keyOf.get(f));
    for (const v of f.voxels) v.frame = frame;
    sources[frame].names.push(f.name);
  }
  sources.forEach(s => s.names.sort(_natCmp));
  return sources;
}

/* Display name for a set of files: their shared prefix minus any trailing frame token,
   e.g. 24.specific_ventilation.insp.pp.00 … .04 → "24.specific_ventilation.insp" */
function _labelFromNames(names) {
  if (names.length === 1) return names[0].replace(/(_final)?\.csv$/i, '');
  let p = names[0];
  for (const n of names) while (!n.startsWith(p)) p = p.slice(0, -1);
  if (/\d$/.test(p) && /^\d/.test(names[0].slice(p.length))) p = p.replace(/\d+$/, '');
  p = p.replace(/[._\- ]+$/, '')
       .replace(new RegExp(`(?:^|[._\\- ])${FRAME_TOKEN}$`, 'i'), '')
       .replace(/[._\- ]+$/, '');
  return p || names[0].replace(/\.csv$/i, '');
}

/* ── Load status in the #data-info bar (shared by both pages) ── */
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _skippedHTML(skipped) {
  if (!skipped || !skipped.length) return '';
  const rows = skipped.map(s => `<li>${escapeHTML(s.name)}: ${escapeHTML(s.reason)}</li>`).join('');
  return `<details class="info-details info-warn"><summary>${skipped.length} file(s) skipped</summary>` +
         `<ul>${rows}</ul></details>`;
}

/* Extra info-bar content after a file load: frame ← file mapping, skipped files */
function loadDetailsHTML(res) {
  if (!res) return '';
  let html = '';
  if (res.frameSources) {
    const rows = res.frameSources.map(s =>
      `<li>Frame ${s.frame} ← ${s.names.map(escapeHTML).join(', ')}</li>`).join('');
    html += `<details class="info-details"><summary>${res.frameSources.length} frames read from ` +
            `${res.nFiles} per-frame files</summary><ul>${rows}</ul></details>`;
  }
  return html + _skippedHTML(res.skipped);
}

function renderLoadStatus(nFiles) {
  const info = document.getElementById('data-info');
  info.hidden = false;
  info.className = 'is-loading';
  info.textContent = `Reading ${nFiles} file${nFiles === 1 ? '' : 's'}…`;
}

function renderLoadError(err) {
  const info = document.getElementById('data-info');
  info.hidden = false;
  info.className = 'is-error';
  info.innerHTML = `<strong>Could not load files.</strong> ${escapeHTML(err.message || err)}` +
                   _skippedHTML(err.skipped);
  document.getElementById('viz').hidden = true;
}

/* Convert embedded sample array [[frame,sv,x,y,z],...] */
function parseRawArray(arr) {
  return arr.map(r => ({ frame: r[0], sv: r[1], x: r[2], y: r[3], z: r[4] }));
}

/* One sentence on where the lobes come from; shown wherever lobes are displayed */
function lobeDefinitionText(isLobar) {
  if (isLobar) return 'Lobes are taken from the uploaded filenames (RUL / RML / RLL / LUL / LLL), not computed by the viewer.';
  return 'Lobes are not anatomical: they are approximated from voxel coordinates with a human five-lobe rule ' +
         '(right/left lung split at the median x; RUL = upper third of the right lung by z, RML / RLL = front / back ' +
         'half of the rest by y; LUL / LLL = upper / lower half of the left lung by z), so they do not match mouse ' +
         'anatomy (one left lobe, four right lobes).';
}

/* ── Lobe detection from filename ────────────────────────── */
function detectLobeFromName(filename) {
  const u = filename.toUpperCase();
  for (const lobe of LOBES) if (u.includes(lobe)) return lobe;
  return null;
}

/* ── Spatial lobe assignment from whole-lung CSV ─────────── */
/*
   Coordinate convention found in real data:
     x < 0  → right lung,  x >= 0  → left lung
     z: more-negative = superior (upper lobes have lower z)
     y: more-negative = anterior (RML is anterior to RLL)
*/
function assignLobesFromCoords(voxels) {
  const f0 = voxels.filter(v => v.frame === 0);
  if (!f0.length) return { RUL: [], RML: [], RLL: [], LUL: [], LLL: [], whole: voxels };

  /* x median → left/right split */
  const xSorted = f0.map(v => v.x).sort((a, b) => a - b);
  const xMed    = xSorted[Math.floor(xSorted.length / 2)];

  const rightF0 = f0.filter(v => v.x < xMed);
  const leftF0  = f0.filter(v => v.x >= xMed);

  /* Right lung: z 33rd percentile → RUL vs lower; then y median → RML vs RLL */
  const rZ     = rightF0.map(v => v.z).sort((a, b) => a - b);
  const z33R   = rZ[Math.floor(rZ.length * 0.33)];

  const rLower   = rightF0.filter(v => v.z >= z33R);
  const rLowerY  = rLower.map(v => v.y).sort((a, b) => a - b);
  const yMedRL   = rLowerY[Math.floor(rLowerY.length / 2)];

  /* Left lung: z median → LUL (lower z = upper) vs LLL */
  const lZ   = leftF0.map(v => v.z).sort((a, b) => a - b);
  const zMedL = lZ[Math.floor(lZ.length / 2)];

  function lobOf(v) {
    if (v.x < xMed) {
      if (v.z < z33R) return 'RUL';
      return v.y < yMedRL ? 'RML' : 'RLL';
    }
    return v.z < zMedL ? 'LUL' : 'LLL';
  }

  const result = { RUL: [], RML: [], RLL: [], LUL: [], LLL: [], whole: voxels };
  for (const v of voxels) result[lobOf(v)].push(v);
  return result;
}

/* ── Metric computation ──────────────────────────────────── */
/*
   refMean: the mean SV that sets the VDP / V_hip thresholds. For a lobe this is the
   whole-lung mean of the same frame (see buildMetricsMap); if omitted, the voxel set's
   own mean is used. VH and MSV always describe the voxel set itself.
*/
function computeMetrics(voxels, refMean) {
  const sv = voxels.map(v => v.sv).filter(v => isFinite(v));
  const n  = sv.length;
  if (!n) return null;

  const sum  = sv.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const sorted = [...sv].sort((a, b) => a - b);
  const q25  = sorted[Math.floor(n * 0.25)];
  const q75  = sorted[Math.floor(n * 0.75)];
  const iqr  = q75 - q25;

  const ref = isFinite(refMean) ? refMean : mean;
  const vdp = sv.filter(v => v < VDP_THRESHOLD  * ref).length / n * 100;
  const hvr = sv.filter(v => v > VHIP_THRESHOLD * ref).length / n * 100;
  const vh  = mean > 1e-9 ? (iqr / mean) * 100 : 0;

  return { vdp, hvr, vh, msv: mean, iqr, n };
}

/* Build metrics map: { lobe: { frame: metrics } }
   Every lobe's VDP / V_hip is judged against the whole-lung mean SV of that frame
   ("60% of the mean SV for that animal"), so a voxel is a defect or not regardless
   of which lobe it falls in, and the size-weighted lobar values add up to the
   whole-lung row. */
function buildMetricsMap(lobeData, nFrames) {
  const lungMean = {};
  for (let f = 0; f < nFrames; f++) {
    const sv = (lobeData.whole || []).filter(v => v.frame === f && isFinite(v.sv)).map(v => v.sv);
    lungMean[f] = sv.length ? sv.reduce((a, b) => a + b, 0) / sv.length : NaN;
  }

  const map = {};
  for (const [lobe, voxels] of Object.entries(lobeData)) {
    if (!voxels || !voxels.length) continue;
    map[lobe] = {};
    for (let f = 0; f < nFrames; f++) {
      map[lobe][f] = computeMetrics(voxels.filter(v => v.frame === f), lungMean[f]);
    }
  }
  return map;
}

/* ── Colour utilities ────────────────────────────────────── */
/* range: [min, max] of the colour scale (values outside it take the end colour);
   defaults to the metric's fallback range in METRIC_CFG */
function metricToColor(val, metric, active = true, range = null) {
  if (!active) return '#e2e8f0';
  if (val == null || !isFinite(val)) return '#cbd5e1';
  const cfg = METRIC_CFG[metric];
  if (!cfg) return '#cbd5e1';
  const [lo, hi] = range || [cfg.min, cfg.max];
  const t = hi > lo ? Math.min(Math.max((val - lo) / (hi - lo), 0), 1) : 0;
  return lerpHex(cfg.lo, cfg.hi, t);
}

/* Colour range from 0 (or the lowest value, if negative) up to the highest value,
   widened to round numbers so the legend reads cleanly, e.g. max 57.9 → [0, 60],
   max 0.386 → [0, 0.4]. Starting at 0 keeps "green = little or none" meaningful
   whatever the dataset. null if there are no values. */
function niceRange(values) {
  const v = values.filter(x => x != null && isFinite(x));
  if (!v.length) return null;
  let lo = Math.min(0, ...v), hi = Math.max(...v);
  if (hi - lo < 1e-12) { const pad = Math.abs(lo) * 0.1 || 1; lo -= pad; hi += pad; }
  const raw  = (hi - lo) / 5;
  const mag  = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
  return [fmtNum(Math.floor(lo / step) * step), fmtNum(Math.ceil(hi / step) * step)].map(Number);
}

/* Short number for legends / inputs without float noise: 0.30000000000000004 → "0.3" */
function fmtNum(x) {
  return String(+(+x).toPrecision(4));
}

function lerpHex(hex1, hex2, t) {
  const a = hexRgb(hex1), b = hexRgb(hex2);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function hexRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function contrastText(rgbStr) {
  const m = rgbStr.match(/\d+/g);
  if (!m) return '#000';
  const lum = (0.299*+m[0] + 0.587*+m[1] + 0.114*+m[2]) / 255;
  return lum > 0.55 ? '#1e293b' : '#ffffff';
}

function legendGradient(metric) {
  const cfg = METRIC_CFG[metric];
  if (!cfg) return '';
  return `linear-gradient(to right, ${cfg.lo}, ${cfg.hi})`;
}

/* ── SV normalisation ────────────────────────────────────── */
/*
   Divide every SV value by the global mean (all frames, all voxels).
   After normalisation: global mean ≈ 1.0, so VDP/V_hip thresholds
   (VDP_THRESHOLD × mean and VHIP_THRESHOLD × mean) are consistent across different files.
*/
function normalizeVoxels(voxels) {
  const finite = voxels.map(v => v.sv).filter(isFinite);
  if (!finite.length) return voxels;
  const globalMean = finite.reduce((a, b) => a + b, 0) / finite.length;
  if (Math.abs(globalMean) < 1e-12) return voxels;
  return voxels.map(v => ({ ...v, sv: v.sv / globalMean }));
}

/* ── Unique voxels (by coordinate, collapse frames) ─────── */
function uniqueVoxels(voxels) {
  const map = new Map();
  for (const v of voxels) {
    const key = `${v.x},${v.y},${v.z}`;
    if (!map.has(key)) map.set(key, { x: v.x, y: v.y, z: v.z, svByFrame: {} });
    map.get(key).svByFrame[v.frame] = v.sv;
  }
  return [...map.values()];
}

/* ── Formatting ──────────────────────────────────────────── */
function fmt(val, metric) {
  if (val == null || !isFinite(val)) return 'n/a';
  if (metric === 'msv') return val.toFixed(4);
  return val.toFixed(1);
}
