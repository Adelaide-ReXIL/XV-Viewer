/* ============================================================
   XV Viewer — shared utilities
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

const METRIC_CFG = {
  vdp: { label: 'VDP %',  desc: 'Ventilation Defect %',       unit: '%',  lo: '#22c55e', hi: '#ef4444', min: 0, max: 35  },
  vh:  { label: 'VH %',   desc: 'Ventilation Heterogeneity',  unit: '%',  lo: '#22c55e', hi: '#ef4444', min: 0, max: 160 },
  msv: { label: 'MSV',    desc: 'Mean Specific Ventilation',  unit: '',   lo: '#dbeafe', hi: '#1e40af', min: 0, max: 0.12 },
  hvr: { label: 'HVR %',  desc: 'High-Ventilation Region %',  unit: '%',  lo: '#f5f3ff', hi: '#6d28d9', min: 0, max: 30  },
};

/* ── CSV parsing ─────────────────────────────────────────── */
function parseCSVResult(papaResult) {
  const raw = papaResult.data;
  if (!raw || raw.length < 2) return [];

  // Normalize header
  const headers = raw[0].map(h => String(h).trim()
    .toLowerCase().replace(/["' ]/g, '').replace(/\(.*\)/, ''));

  const fi = headers.findIndex(h => h === 'frame');
  const si = headers.findIndex(h => h.startsWith('divergence') || h === 'sv');
  const xi = headers.findIndex(h => h === 'position.x' || h === 'positionx' || h === 'x');
  const yi = headers.findIndex(h => h === 'position.y' || h === 'positiony' || h === 'y');
  const zi = headers.findIndex(h => h === 'position.z' || h === 'positionz' || h === 'z');

  if ([fi, si, xi, yi, zi].some(i => i < 0)) {
    console.warn('Header not recognised:', headers); return [];
  }

  const out = [];
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r];
    if (!row || row.length < 5) continue;
    const frame = parseInt(row[fi]);
    const sv    = parseFloat(row[si]);
    const x     = parseFloat(row[xi]);
    const y     = parseFloat(row[yi]);
    const z     = parseFloat(row[zi]);
    if ([frame, sv, x, y, z].some(isNaN)) continue;
    out.push({ frame, sv, x, y, z });
  }
  return out;
}

/* Convert embedded sample array [[frame,sv,x,y,z],...] */
function parseRawArray(arr) {
  return arr.map(r => ({ frame: r[0], sv: r[1], x: r[2], y: r[3], z: r[4] }));
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
function computeMetrics(voxels) {
  const sv = voxels.map(v => v.sv).filter(v => isFinite(v));
  const n  = sv.length;
  if (!n) return null;

  const sum  = sv.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const sorted = [...sv].sort((a, b) => a - b);
  const q25  = sorted[Math.floor(n * 0.25)];
  const q75  = sorted[Math.floor(n * 0.75)];
  const iqr  = q75 - q25;

  const vdp = sv.filter(v => v < 0.3 * mean).length / n * 100;
  const hvr = sv.filter(v => v > 1.674 * mean).length / n * 100;
  const vh  = mean > 1e-9 ? (iqr / mean) * 100 : 0;

  return { vdp, hvr, vh, msv: mean, iqr, n };
}

/* Build metrics map: { lobe: { frame: metrics } } */
function buildMetricsMap(lobeData, nFrames) {
  const map = {};
  for (const [lobe, voxels] of Object.entries(lobeData)) {
    if (!voxels || !voxels.length) continue;
    map[lobe] = {};
    for (let f = 0; f < nFrames; f++) {
      map[lobe][f] = computeMetrics(voxels.filter(v => v.frame === f));
    }
  }
  return map;
}

/* ── Colour utilities ────────────────────────────────────── */
function metricToColor(val, metric, active = true) {
  if (!active) return '#e2e8f0';
  if (val == null || !isFinite(val)) return '#cbd5e1';
  const cfg = METRIC_CFG[metric];
  if (!cfg) return '#cbd5e1';
  const t = Math.min(Math.max((val - cfg.min) / (cfg.max - cfg.min), 0), 1);
  return lerpHex(cfg.lo, cfg.hi, t);
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
   (0.3 × mean and 1.674 × mean) are consistent across different files.
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
  if (val == null || !isFinite(val)) return '—';
  if (metric === 'msv') return val.toFixed(4);
  return val.toFixed(1);
}
