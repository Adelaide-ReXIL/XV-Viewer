# XV Viewer — X-ray Velocimetry Clinical Dashboard

A browser-based visualisation tool for X-ray Velocimetry (XV) lung ventilation data. No server or installation required — runs entirely in the browser and can be hosted on GitHub Pages.

---

## Live Demo

Deploy to GitHub Pages by pushing this folder to the `gh-pages` branch (or the root of any public repository with Pages enabled). The entry point is `index.html`.

---

## What is X-ray Velocimetry?

XV is a fluoroscopy-derived technique that measures lung ventilation from the divergence of a computed motion field. Each voxel in a `_final.csv` file carries a **Specific Ventilation (SV)** value — the local divergence of the displacement field — across multiple breath frames (typically 7, spanning one full inspiration).

---

## Features

### Dashboard (`index.html`)
- **3D Voxel Scatter** — interactive Plotly 3D plot coloured by SV; play button animates across frames at 600 ms/frame; drag to rotate; camera angle is preserved between frame changes
- **Ventilation Map** — anatomical SVG of lung lobes coloured by any of four clinical metrics; toggle individual lobes on/off
- **Metrics Table** — per-lobe VDP, V_hip, VH, MSV for the selected frame with colour-coded cells
- **VDP & V_hip Trajectory** — two stacked line charts showing how metrics evolve across frames per lobe
- **SV Distribution** — violin plots grouped by lobe (at selected frame) or by frame (whole lung)
- **Two built-in examples** — synthetic CF patient and healthy control datasets

### K-Means View (`kmeans.html`)
- Cluster voxels by **spatial** (x, y, z), **functional** (SV per frame), or **combined** features
- Configurable K (2–8); uses K-means++ initialisation
- 3D scatter can be coloured by cluster, SV value, or auto-detected lobe
- Cluster-level metrics table and temporal SV profiles per cluster

---

## Input File Format

The tool auto-detects headers — column names are matched case-insensitively and units in parentheses are stripped before matching.

### Supported header variants

| Column | Accepted names | Notes |
| --- | --- | --- |
| Frame index | `frame`, `Frame` | Optional — absent means single-timepoint (all rows = frame 0) |
| SV / divergence | `divergence.0, 0`, any `divergence…` | Clinical `_final.csv` |
| SV / divergence | `Specific Ventilation (mL/mL)` | Animal `.specificVentilation.csv` |
| SV / divergence | `sv` | Generic |
| x coordinate | `position.x`, `positionx`, `x`, `x (mm)` | |
| y coordinate | `position.y`, `positiony`, `y`, `y (mm)` | |
| z coordinate | `position.z`, `positionz`, `z`, `z (mm)` | |

### Known file formats

| Format | Frame col | SV col | Coord cols |
| --- | --- | --- | --- |
| Clinical `_final.csv` | `Frame` | `divergence.0, 0` | `position.x`, `position.y`, `position.z` |
| Animal `.specificVentilation.csv` | absent (single frame) | `Specific Ventilation (mL/mL)` | `x (mm)`, `y (mm)`, `z (mm)` |

### Upload modes

**Single whole-lung CSV** — all voxels from all lobes in one file. The tool auto-segments into five lobes using coordinate-based rules (see [Lobe Assignment](#lobe-assignment)).

**Multiple lobar CSVs** — one file per lobe, filenames must contain the lobe code: `RUL`, `RML`, `RLL`, `LUL`, or `LLL`. No auto-segmentation is performed; lobes come directly from the filenames.

---

## Clinical Metrics

All metrics are computed **after normalising SV by the global mean** (across all voxels and all frames), so values are comparable across different files and acquisition settings.

| Metric | Formula | Interpretation |
|--------|---------|---------------|
| **VDP** — Ventilation Defect % | `fraction(SV < 0.3 × mean) × 100` | Poorly ventilated voxels; **lower is better** |
| **V_hip** — High-Ventilation % | `fraction(SV > 1.674 × mean) × 100` | Compensatory hyper-ventilation; elevated in disease |
| **VH** — Ventilation Heterogeneity | `(IQR / mean) × 100` | Spread of SV distribution; lower = more uniform |
| **MSV** — Mean Specific Ventilation | `mean(SV)` after normalisation | ≈ 1.0 for a normalised file |

### SV Normalisation

Before any metric is computed, every SV value is divided by the **global mean SV** of that file (all frames, all voxels):

```
SV_norm = SV_raw / mean(SV_raw)
```

This ensures VDP and V_hip thresholds (which are multiples of the mean) remain consistent regardless of the absolute scale of the raw divergence values.

---

## Lobe Assignment (auto-segmentation)

When a single whole-lung CSV is uploaded the tool assigns each voxel to a lobe using coordinate percentiles computed from frame 0:

```
x < x_median  →  Right lung
x ≥ x_median  →  Left lung

Right lung:
  z < z_33rd_pct          →  RUL (upper)
  z ≥ z_33rd_pct, y < y_med_lower  →  RML (middle, anterior)
  z ≥ z_33rd_pct, y ≥ y_med_lower  →  RLL (lower, posterior)

Left lung:
  z < z_median  →  LUL (upper)
  z ≥ z_median  →  LLL (lower)
```

Coordinate convention assumed: x < 0 = right lung, z more negative = superior, y more negative = anterior.

---

## File Structure

```
xv-viewer/
├── index.html          # Main dashboard
├── kmeans.html         # K-Means clustering view
├── css/
│   └── style.css       # All styles (CSS variables, layout, components)
└── js/
    ├── samples.js      # Built-in example datasets (SAMPLE_CF, SAMPLE_CTRL)
    ├── common.js       # Shared utilities: CSV parsing, metrics, lobe assignment, colours
    ├── lung-map.js     # SVG lobe rendering and colour legend
    ├── charts.js       # All Plotly chart rendering (trajectory, violin, 3D scatter)
    └── app.js          # Global state (APP), data ingestion, event wiring
```

### Module responsibilities

**`common.js`**
- `parseCSVResult(papaResult)` — normalises headers and extracts frame/sv/x/y/z columns
- `normalizeVoxels(voxels)` — divides all SV by global mean
- `assignLobesFromCoords(voxels)` — coordinate-percentile lobe segmentation
- `computeMetrics(voxels)` — returns `{ vdp, hvr, vh, msv, iqr, n }` for a voxel set
- `buildMetricsMap(lobeData, nFrames)` — builds `{ lobe: { frame: metrics } }` map
- `metricToColor / lerpHex / contrastText / legendGradient` — colour utilities

**`charts.js`**
- `renderMetricsTable()` — populates the HTML metrics table
- `renderTrajectoryChart()` — two-subplot Plotly line chart (VDP top, V_hip bottom)
- `renderDistChart()` — violin plots by lobe or by frame
- `initScatter3D()` — full 3D scatter initialisation; subsamples to ≤ 3000 points and caches coordinates
- `updateScatter3DColors(frame)` — fast path: only restyles `marker.color`, preserving camera angle
- `renderAll()` — calls all render functions (used on data load or lobe toggle)
- `renderOnFrameChange()` — fast path called on frame slider change

**`app.js`**
- `APP` — global state object: `{ lobeData, metrics, metric, frame, active, nFrames, label }`
- `ingestWholeLung(voxels)` / `ingestLobarFiles(lobeMap)` — normalise then load data
- `_setFrame(f)` — updates `APP.frame`, syncs all UI controls, calls `renderOnFrameChange()`
- `_startPlay()` / `_stopPlay()` — 600 ms interval animation

---

## GitHub Pages Deployment

1. Push the `xv-viewer/` folder contents to a GitHub repository.
2. Go to **Settings → Pages** and set the source branch/folder.
3. The site is live at `https://<username>.github.io/<repo>/`.

No build step, no dependencies to install — all libraries (Plotly 2.27, PapaParse 5.4) are loaded from CDN.

---

## Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| [Plotly.js](https://plotly.com/javascript/) | 2.27.0 | All interactive charts (3D scatter, violin, line) |
| [PapaParse](https://www.papaparse.com/) | 5.4.1 | In-browser CSV parsing |

Both are loaded via CDN — no npm or bundler required.
