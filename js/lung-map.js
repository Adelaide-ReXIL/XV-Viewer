/* ============================================================
   lung-map.js — SVG lobe coloring & tooltip
   ============================================================ */

function renderLungMap() {
  LOBES.forEach(lobe => {
    const el  = document.getElementById(`lobe-${lobe}`);
    if (!el) return;
    const on  = APP.active.has(lobe);
    const m   = APP.metrics[lobe]?.[APP.frame];
    const val = m?.[APP.metric] ?? null;
    el.style.fill = metricToColor(val, APP.metric, on);
    el.classList.toggle('lobe-off', !on);
  });
}

function renderColorLegend() {
  const cfg = METRIC_CFG[APP.metric];
  document.getElementById('legend-bar').style.background = legendGradient(APP.metric);
  document.getElementById('legend-title').textContent = `${cfg.label} — ${cfg.desc}`;
  document.getElementById('leg-lo').textContent  = `${cfg.min}${cfg.unit}`;
  document.getElementById('leg-mid').textContent =
    `${((cfg.min + cfg.max) / 2).toFixed(APP.metric === 'msv' ? 4 : 1)}${cfg.unit}`;
  document.getElementById('leg-hi').textContent  = `${cfg.max}${cfg.unit}`;
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
