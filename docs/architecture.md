# XV Viewer — Developer Architecture Notes

## Data flow

```
CSV file(s)
    │
    ▼
PapaParse → parseCSVResult()        # raw [{frame,sv,x,y,z}]
    │
    ▼
normalizeVoxels()                   # sv = sv / globalMean
    │
    ▼
assignLobesFromCoords()             # → { RUL,RML,RLL,LUL,LLL,whole: voxel[] }
  or
ingestLobarFiles()                  # filenames already encode lobe
    │
    ▼
buildMetricsMap()                   # { lobe: { frame: {vdp,hvr,vh,msv,n} } }
    │
    ▼
APP.lobeData / APP.metrics          # global state
    │
    ▼
renderAll()                         # initial full render
```

On every frame slider change: `renderOnFrameChange()` (fast path — skips trajectory rebuild).

---

## Global state (`APP` in `app.js`)

```js
APP = {
  lobeData: { RUL, RML, RLL, LUL, LLL, whole },  // normalised voxel arrays
  metrics:  { lobe: { frameIndex: { vdp, hvr, vh, msv, iqr, n } } },
  metric:   string,       // active metric tab: 'vdp' | 'hvr' | 'vh' | 'msv'
  frame:    number,       // active frame index (0-based)
  active:   Set<string>,  // lobe codes currently toggled on
  nFrames:  number,
  label:    string,       // display name for the loaded file
}
```

---

## 3D scatter performance

The full voxel array (all frames) can be large. To keep Plotly responsive:

1. **Subsample once** at `initScatter3D()`: keep every N-th voxel from frame 0 so the point count stays ≤ 3 000. Cache these as `_scatter3dPts`.
2. On frame change, build an `(x,y,z) → sv` map for that frame and remap colours with `Plotly.restyle`. The coordinates never change so Plotly does not re-layout the scene and the camera angle is preserved.

If you need higher fidelity, increase the `3000` cap in `initScatter3D()` — it trades render speed for detail.

---

## Metric colour scale

Each metric has a `lo` (best) and `hi` (worst) hex colour in `METRIC_CFG` inside `common.js`. `metricToColor(val, metric)` linearly interpolates between them using the metric's `[min, max]` range. Out-of-range values are clamped. `null` / non-finite values render as a neutral grey (`#cbd5e1`).

---

## Adding a new metric

1. Add an entry to `METRIC_CFG` in `common.js`:
   ```js
   newmet: { label: 'Label', desc: 'Description', unit: '%', lo: '#hex', hi: '#hex', min: 0, max: 100 }
   ```
2. Compute and return it in `computeMetrics()`.
3. Add a `<button class="mtab" data-m="newmet">` in `index.html`.
4. Add a column header `<th>` in the metrics table and a corresponding `fmt()` call in `renderMetricsTable()`.

---

## Adding a new page

Each additional analysis page (like `kmeans.html`) should:
- Load `js/samples.js`, `js/common.js` before any page-specific scripts
- Define its own state object (do **not** share `APP`)
- Re-use `parseCSVResult`, `normalizeVoxels`, `assignLobesFromCoords`, and colour utilities from `common.js`

---

## Coordinate convention

From real XV data (verified against lobar-labelled ground truth):

| Axis | Positive direction | Clinical meaning |
|------|--------------------|-----------------|
| x    | Right→Left         | x < 0 = right lung, x ≥ 0 = left lung |
| y    | Posterior→Anterior | more negative = anterior (RML anterior to RLL) |
| z    | Inferior→Superior  | more negative = superior (upper lobes have lower z) |

The auto-segmentation thresholds (x median, z 33rd percentile for right upper, z median for left) were validated against per-lobe labelled files and achieve > 95% spatial overlap.

---

## Browser compatibility

Requires ES2020 (optional chaining `?.`, nullish coalescing `??`, spread in `for...of`). All modern browsers (Chrome 85+, Firefox 78+, Safari 14+, Edge 85+) are supported. No IE support.
