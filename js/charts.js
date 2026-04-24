/* ============================================================
   charts.js — all Plotly chart rendering for index.html
   ============================================================ */

const PLOTLY_BASE = {
  paper_bgcolor: 'white', plot_bgcolor: 'white',
  font: { family: 'system-ui, sans-serif', size: 12 },
  margin: { l: 56, r: 16, t: 28, b: 44 },
};

/* Right lung: blue family  |  Left lung: purple/red family */
const LOBE_COLORS_TRAJ = {
  RUL:   '#0ea5e9',  // sky
  RML:   '#10b981',  // emerald
  RLL:   '#3b82f6',  // blue
  LUL:   '#f59e0b',  // amber
  LLL:   '#ef4444',  // red
  whole: '#1e293b',  // near-black
};

/* ── 1. Metrics table ─────────────────────────────────────── */
function renderMetricsTable() {
  document.getElementById('tbl-frame').textContent = APP.frame;
  const tbody = document.getElementById('metrics-body');
  tbody.innerHTML = '';

  ['whole', ...LOBES].forEach(lobe => {
    const on = lobe === 'whole' || APP.active.has(lobe);
    const m  = APP.metrics[lobe]?.[APP.frame];
    const tr = document.createElement('tr');
    tr.className = lobe === 'whole' ? 'row-whole' : (on ? '' : 'row-dimmed');

    const dot = lobe !== 'whole'
      ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;
           background:${LOBE_META[lobe].color};margin-right:5px;flex-shrink:0"></span>` : '';

    tr.innerHTML = `<td>${dot}${LOBE_META[lobe]?.label ?? lobe}</td>` +
      ['vdp', 'hvr', 'vh', 'msv'].map(met => {
        const v   = m?.[met] ?? null;
        const col = on ? metricToColor(v, met) : '#f1f5f9';
        const txt = contrastText(col);
        return `<td><span class="cell-val" style="background:${col};color:${txt}">${fmt(v, met)}</span></td>`;
      }).join('') +
      `<td style="color:var(--muted)">${m ? m.n.toLocaleString() : '—'}</td>`;

    tbody.appendChild(tr);
  });
}

/* ── 2. VDP + V_hip trajectory ─────────────────────────────
   Two stacked subplots sharing the x-axis.
   Top   → VDP %  (ventilation defect trajectory)
   Bottom → V_hip % (high-ventilation trajectory)
   Visual style: solid lines, lung-family colors, clear markers.
   ─────────────────────────────────────────────────────────── */
function renderTrajectoryChart() {
  const frames = Array.from({ length: APP.nFrames }, (_, i) => i);
  const vdpTraces = [], vhipTraces = [];

  const lobeList = ['whole', ...LOBES.filter(l => APP.active.has(l))];
  lobeList.forEach(lobe => {
    if (!APP.metrics[lobe]) return;
    const color = LOBE_COLORS_TRAJ[lobe];
    const width = lobe === 'whole' ? 3   : 2;
    const size  = lobe === 'whole' ? 9   : 7;
    const sym   = lobe === 'whole' ? 'diamond' : 'circle';
    const name  = LOBE_META[lobe]?.label ?? lobe;

    const vdp  = frames.map(f => APP.metrics[lobe][f]?.vdp ?? null);
    const vhip = frames.map(f => APP.metrics[lobe][f]?.hvr ?? null);

    const base = {
      mode: 'lines+markers',
      line:   { color, width, dash: 'solid' },
      marker: { color, size, symbol: sym, line: { color: 'white', width: 1 } },
      showlegend: true,
    };

    vdpTraces.push({  ...base, x: frames, y: vdp,  name, xaxis: 'x',  yaxis: 'y'  });
    vhipTraces.push({ ...base, x: frames, y: vhip, name, showlegend: false, xaxis: 'x2', yaxis: 'y2' });
  });

  const xRange = [-0.3, APP.nFrames - 0.7];

  Plotly.react('chart-trajectory', [...vdpTraces, ...vhipTraces], {
    ...PLOTLY_BASE,
    margin: { l: 60, r: 20, t: 40, b: 52 },
    grid: { rows: 2, columns: 1, pattern: 'independent', roworder: 'top to bottom' },
    /* Top subplot */
    xaxis: {
      showticklabels: false, range: xRange, dtick: 1,
      gridcolor: '#f1f5f9', zeroline: false,
    },
    yaxis: {
      title: { text: 'VDP %', font: { size: 12 } },
      gridcolor: '#f1f5f9', zeroline: false,
    },
    /* Bottom subplot */
    xaxis2: {
      title: { text: 'Frame  (0 = start of inspiration → 6 = end)', font: { size: 11 } },
      range: xRange, dtick: 1, gridcolor: '#f1f5f9', zeroline: false,
    },
    yaxis2: {
      title: { text: 'V_hip %', font: { size: 12 } },
      gridcolor: '#f1f5f9', zeroline: false,
    },
    /* Subplot titles as annotations */
    annotations: [
      {
        text: '▲ VDP — Ventilation Defect % <span style="color:#64748b;font-size:10px">(lower = better)</span>',
        xref: 'paper', yref: 'paper', x: 0.01, y: 1.03,
        xanchor: 'left', yanchor: 'bottom', showarrow: false,
        font: { size: 11, color: '#475569' },
      },
      {
        text: '▲ V_hip — High-Ventilation % <span style="color:#64748b;font-size:10px">(compensatory hyper-ventilation)</span>',
        xref: 'paper', yref: 'paper', x: 0.01, y: 0.48,
        xanchor: 'left', yanchor: 'bottom', showarrow: false,
        font: { size: 11, color: '#475569' },
      },
    ],
    legend: {
      orientation: 'h', y: -0.20, font: { size: 11 },
      bgcolor: 'rgba(255,255,255,0)', bordercolor: 'rgba(0,0,0,0)',
    },
    hovermode: 'x unified',
    shapes: _trajCursorShapes(APP.frame),
  }, { responsive: true, displayModeBar: false });
}

/* ── 3. SV distribution — violin per lobe or per frame ────── */
function renderDistChart() {
  const mode   = document.getElementById('dist-mode').value;
  const FCOLS  = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316'];
  const traces = [];

  if (mode === 'frames') {
    for (let f = 0; f < APP.nFrames; f++) {
      const sv = (APP.lobeData.whole || []).filter(v => v.frame === f).map(v => v.sv);
      if (!sv.length) continue;
      traces.push({
        type: 'violin', y: sv, name: `Frame ${f}`,
        box: { visible: true }, meanline: { visible: true },
        line: { color: FCOLS[f % 7] }, opacity: 0.75, points: false,
      });
    }
  } else {
    LOBES.forEach(lobe => {
      if (!APP.active.has(lobe) || !APP.lobeData[lobe]) return;
      const sv = APP.lobeData[lobe].filter(v => v.frame === APP.frame).map(v => v.sv);
      if (!sv.length) return;
      traces.push({
        type: 'violin', y: sv, name: LOBE_META[lobe].label,
        box: { visible: true }, meanline: { visible: true },
        line: { color: LOBE_META[lobe].color }, opacity: 0.75, points: false,
      });
    });
  }

  Plotly.react('chart-dist', traces, {
    ...PLOTLY_BASE,
    margin: { l: 56, r: 16, t: 16, b: 56 },
    yaxis: { title: 'Normalised SV', zeroline: true, zerolinecolor: '#cbd5e1' },
    legend: { orientation: 'h', y: -0.32, font: { size: 11 } },
    violinmode: 'group',
  }, { responsive: true, displayModeBar: false });
}

/* ── 4. 3D scatter — INIT (full redraw on data load) ────────
   Cached subsampled voxel positions — coords never change
   between frames, so subsequent frame changes only restyle
   the marker colours, preserving camera angle.
   ─────────────────────────────────────────────────────────── */
let _scatter3dPts = null;   // cached on first init
let _scatter3dNorm = null;  // normalised SV map keyed by "x,y,z,frame"

function _buildNormSvMap(all) {
  /* Normalise raw SV by global mean for the colorscale only */
  const finite = all.map(v => v.sv).filter(isFinite);
  const globalMean = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : 1;
  const map = new Map();
  all.forEach(v => map.set(`${v.x},${v.y},${v.z},${v.frame}`, v.sv / globalMean));
  return map;
}

function initScatter3D() {
  const all = APP.lobeData.whole || [];
  const f0  = all.filter(v => v.frame === 0);

  /* Subsample once — same spatial pts for all frames */
  const step = Math.max(1, Math.floor(f0.length / 3000));
  _scatter3dPts  = f0.filter((_, i) => i % step === 0);
  _scatter3dNorm = _buildNormSvMap(all);

  const trace = _buildScatterTrace(_scatter3dPts, APP.frame);

  Plotly.react('chart-3d', [trace], _scatter3dLayout(), {
    responsive: true, displayModeBar: true, displaylogo: false,
    modeBarButtonsToRemove: ['toImage'],
  });
}

function updateScatter3DColors(frame) {
  if (!_scatter3dPts) { initScatter3D(); return; }
  const colors = _scatter3dPts.map(v => _scatter3dNorm.get(`${v.x},${v.y},${v.z},${frame}`) ?? 0);
  /* Restyle only — camera angle is preserved */
  Plotly.restyle('chart-3d', { 'marker.color': [colors] }, [0]);
}

function _buildScatterTrace(pts, frame) {
  const colors = pts.map(v => _scatter3dNorm.get(`${v.x},${v.y},${v.z},${frame}`) ?? 0);
  /* Fixed colorscale anchored at 0–3× mean (mean=1 after normalisation) */
  return {
    type: 'scatter3d', mode: 'markers',
    x: pts.map(v => v.x), y: pts.map(v => v.y), z: pts.map(v => v.z),
    marker: {
      size: 2.8, opacity: 0.8,
      color: colors,
      colorscale: 'Viridis',
      cmin: 0, cmax: 3,
      colorbar: {
        title: { text: 'Norm. SV', side: 'right' },
        thickness: 14, len: 0.6,
        tickvals: [0, 1, 2, 3],
        ticktext: ['0', '1× mean', '2×', '3×'],
      },
      showscale: true,
    },
    hovertemplate: 'x:%{x:.1f}  y:%{y:.1f}  z:%{z:.1f}<br>Norm. SV:%{marker.color:.3f}<extra></extra>',
  };
}

function _scatter3dLayout() {
  return {
    paper_bgcolor: 'white',
    scene: {
      uirevision: 'locked',   // preserves camera rotation/zoom between re-renders
      bgcolor: '#f8fafc',
      xaxis: { title: '← R  |  L →', backgroundcolor: '#f1f5f9', gridcolor: '#e2e8f0', showspikes: false },
      yaxis: { title: 'Y', backgroundcolor: '#f1f5f9', gridcolor: '#e2e8f0', showspikes: false },
      zaxis: { title: 'Z', backgroundcolor: '#f1f5f9', gridcolor: '#e2e8f0', showspikes: false, autorange: 'reversed' },
      camera: { eye: { x: 0.2, y: -2.0, z: 0.5 } },  // anterior view: y<0 = looking from front
    },
    margin: { l: 0, r: 0, t: 0, b: 0 },
    font: { family: 'system-ui, sans-serif', size: 12 },
  };
}

/* ── Render all ────────────────────────────────────────────── */
function renderAll() {
  renderLungMap();
  renderColorLegend();
  renderMetricsTable();
  renderTrajectoryChart();
  renderDistChart();
  initScatter3D();       // full init on new data
}

function _trajCursorShapes(frame) {
  const style = { type: 'line', x0: frame, x1: frame, y0: 0, y1: 1,
                  line: { color: '#94a3b8', width: 1.5, dash: 'dash' } };
  return [
    { ...style, xref: 'x',  yref: 'y domain'  },
    { ...style, xref: 'x2', yref: 'y2 domain' },
  ];
}

/* Frame-change fast path: restyle scatter, update map/table */
function renderOnFrameChange() {
  renderLungMap();
  renderMetricsTable();
  renderDistChart();
  updateScatter3DColors(APP.frame);
  /* Move cursor via relayout — does not affect y-axis auto-range */
  if (document.getElementById('chart-trajectory')?.data?.length) {
    Plotly.relayout('chart-trajectory', { shapes: _trajCursorShapes(APP.frame) });
  }
}
