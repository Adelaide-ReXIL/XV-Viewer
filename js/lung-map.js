/* ============================================================
   lung-map.js: SVG lobe coloring & tooltip
   ============================================================ */

function renderLungMap() {
  LOBES.forEach(lobe => {
    const el  = document.getElementById(`lobe-${lobe}`);
    if (!el) return;
    const on  = APP.active.has(lobe);
    const m   = APP.metrics[lobe]?.[APP.frame];
    const val = m?.[APP.metric] ?? null;
    el.style.fill = metricToColor(val, APP.metric, on, colorRange(APP.metric));
    el.classList.toggle('lobe-off', !on);
  });
}

function renderColorLegend() {
  const cfg = METRIC_CFG[APP.metric];
  const [lo, hi] = colorRange(APP.metric);
  document.getElementById('legend-bar').style.background = legendGradient(APP.metric);
  document.getElementById('legend-title').textContent = `${cfg.label}: ${cfg.desc}`;
  document.getElementById('leg-lo').textContent  = `${fmtNum(lo)}${cfg.unit}`;
  document.getElementById('leg-mid').textContent = `${fmtNum((lo + hi) / 2)}${cfg.unit}`;
  document.getElementById('leg-hi').textContent  = `${fmtNum(hi)}${cfg.unit}`;

  /* Colour-range controls show the range in use; editable only in Custom mode */
  const custom = APP.colorMode === 'custom';
  document.getElementById('range-mode').value = APP.colorMode;
  for (const [id, v] of [['range-min', lo], ['range-max', hi]]) {
    const el = document.getElementById(id);
    el.value    = fmtNum(v);
    el.disabled = !custom;
  }
  document.getElementById('range-unit').textContent = cfg.unit;
}

function bindLungMapHover() {
  document.getElementById('lung-svg').addEventListener('mouseover', e => {
    const el = e.target.closest('.lobe-shape');
    if (!el) return;
    const lobe = el.dataset.lobe;
    const m = APP.metrics[lobe]?.[APP.frame];
    if (!m) return;
    el.title = `${LOBE_META[lobe]?.label ?? lobe}\n` +
      `VDP: ${fmt(m.vdp,'vdp')}%   V_hip: ${fmt(m.hvr,'hvr')}%   VH: ${fmt(m.vh,'vh')}%   MSV: ${fmt(m.msv,'msv')}`;
  });
}
