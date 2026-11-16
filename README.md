# XV Viewer: X-ray Velocimetry Clinical Dashboard

A browser-based visualisation tool for X-ray Velocimetry (XV) lung ventilation data. No server or installation required: it runs entirely in the browser and can be hosted on GitHub Pages.

---

## Live Demo

Deploy to GitHub Pages by pushing this folder to the `gh-pages` branch (or the root of any public repository with Pages enabled). The entry point is `index.html`.

---

## What is X-ray Velocimetry?

XV is a fluoroscopy-derived technique that measures lung ventilation from the divergence of a computed motion field. Each voxel in a `_final.csv` file carries a **Specific Ventilation (SV)** value (the local divergence of the displacement field) across multiple breath frames (typically 7, spanning one full inspiration).

---

## Features

### Dashboard (`index.html`)
- **3D Voxel Scatter**: interactive Plotly 3D plot coloured by SV; play button animates across frames at 600 ms/frame; drag to rotate; camera angle is preserved between frame changes
- **Ventilation Map**: anatomical SVG of lung lobes coloured by any of four clinical metrics; toggle individual lobes on/off. The colour range is **Auto** by default (0 to just above the highest value in the loaded dataset, so any dataset or unit fits) or **Custom** (your own min/max per metric, remembered by the browser, for viewing several datasets on the same scale)
- **Metrics Table**: per-lobe VDP, V_hip, VH, MSV for the selected frame with colour-coded cells
- **VDP & V_hip Trajectory**: two stacked line charts showing how metrics evolve across frames per lobe
- **SV Distribution**: violin plots grouped by lobe (at selected frame) or by frame (whole lung)
- **Two built-in examples**: synthetic CF patient and healthy control datasets

### K-Means View (`kmeans.html`)
- Cluster voxels by **spatial** (x, y, z), **functional** (SV per frame), or **combined** features
- Functional features: if a voxel has no value in some frame (possible with per-frame CSVs), that frame is filled by linear interpolation between the neighbouring frames, or copied from the nearest frame at the start/end of the series
- Configurable K (2 to 8); uses K-means++ initialisation
- 3D scatter can be coloured by cluster, SV value, or auto-detected lobe
- Cluster-level metrics table and temporal SV profiles per cluster

---

## Input File Format

The tool auto-detects headers: column names are matched case-insensitively and units in parentheses are stripped before matching.

### Supported header variants

| Column | Accepted names | Notes |
| --- | --- | --- |
| Frame index | `frame`, `Frame` | Optional. If absent, the file holds one frame (see [per-frame CSVs](#upload-modes)) |
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
| Per-frame `….insp.pp.NN.csv` | absent (frame `NN` from the filename) | `Specific Ventilation (mL/mL)` | `x (mm)`, `y (mm)`, `z (mm)` |

### Upload modes

**Single whole-lung CSV**: all voxels from all lobes in one file. The tool auto-segments into five lobes using coordinate-based rules (see [Lobe Assignment](#lobe-assignment)).

**Multiple per-frame CSVs**: one file per breath frame, without a `Frame` column, e.g.
`24.specific_ventilation.insp.pp.00.csv` … `24.specific_ventilation.insp.pp.04.csv`. Select or drop them together; they are combined into one multi-frame dataset and auto-segmented like a whole-lung file.

- The frame order comes from the filename: the number after `pp`, `phase_point`, `phase`, `frame`, `fr` or `tp` (e.g. `pp.03`, `frame_3`). If no file has such a token, the last number in the name is used (`sv_1`, `sv_2`, `sv_10`), and failing that, alphabetical order.
- Frame numbers are re-indexed from 0, so `pp.05` to `pp.09` become frames 0 to 4.
- Each file may contain a different set of voxels. The voxel count is shown as a range, and in the 3D views a voxel with no value in the current frame is drawn grey (`no data in this frame` on hover) rather than as zero.
- Files that can't be used are listed under **file(s) skipped** in the info bar. Examples: histogram CSVs, non-CSV files, or a frame-less file such as `24.specificVentilation.csv` that has no frame number among a set of `pp` files.
- The mapping of frames to files is shown under **frames read from … per-frame files** in the info bar.
- Mixing a file that has a `Frame` column (e.g. `24.mesh_data.csv`) with per-frame files, or giving two files the same frame number, is rejected with an error message instead of guessed.

**Multiple lobar CSVs**: one file per lobe, filenames must contain the lobe code: `RUL`, `RML`, `RLL`, `LUL`, or `LLL`. No auto-segmentation is performed; lobes come directly from the filenames. Each lobe can also be a set of per-frame files (e.g. `S1_RUL_pp00.csv`, `S1_RUL_pp01.csv`, …); frames with the same number are aligned across lobes.

---

## Clinical Metrics

Metrics are computed per frame from the SV values in the file. VDP and V_hip thresholds are multiples of the **whole-lung mean SV of that frame**, and this holds for the lobe rows too. As a result, each voxel is either a defect or not whatever lobe it falls in, and the lobar values, weighted by lobe size, add up to the whole-lung value. VH and MSV describe the region itself (its own IQR and mean).

| Metric | Formula | Interpretation |
|--------|---------|---------------|
| **VDP** (Ventilation Defect %) | `fraction(SV < 0.6 × lung mean) × 100` | Poorly ventilated voxels; **lower is better**. 60% of mean SV is the XV convention |
| **V_hip** (High-Ventilation %) | `fraction(SV > 1.674 × lung mean) × 100` | Compensatory hyper-ventilation; elevated in disease |
| **VH** (Ventilation Heterogeneity) | `(IQR / mean) × 100` of the region | Spread of SV within the region; lower = more uniform |
| **MSV** (Mean Specific Ventilation) | `mean(SV)` of the region | In the file's SV units |

`lung mean` = mean SV of all voxels in the same frame.

### Scale

VDP, V_hip and VH are ratios to a mean, so they don't depend on the absolute scale of SV. The 3D views colour voxels by SV ÷ the file's global mean (all frames, all voxels), so 1 = average ventilation.

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
- `loadCSVFiles(files)`: parses one or more CSVs and decides whole-lung / per-frame / lobar mode; returns voxels plus the frame ← file mapping and skipped files (used by both pages)
- `frameKeyFromName(filename)`: frame number encoded in a per-frame filename (`…pp.03.csv` → 3)
- `parseCSVResult(papaResult)`: normalises headers and extracts frame/sv/x/y/z columns
- `normalizeVoxels(voxels)`: divides all SV by global mean
- `assignLobesFromCoords(voxels)`: coordinate-percentile lobe segmentation
- `computeMetrics(voxels, refMean)`: returns `{ vdp, hvr, vh, msv, iqr, n }` for a voxel set; VDP/V_hip thresholds use `refMean` (default: the set's own mean)
- `buildMetricsMap(lobeData, nFrames)`: builds `{ lobe: { frame: metrics } }` map, passing the whole-lung mean of each frame as `refMean`
- `metricToColor / lerpHex / contrastText / legendGradient`: colour utilities

**`charts.js`**
- `renderMetricsTable()`: populates the HTML metrics table
- `renderTrajectoryChart()`: two-subplot Plotly line chart (VDP top, V_hip bottom)
- `renderDistChart()`: violin plots by lobe or by frame
- `initScatter3D()`: full 3D scatter initialisation; subsamples to ≤ 3000 points and caches coordinates
- `updateScatter3DColors(frame)`: fast path that only restyles `marker.color`, preserving camera angle
- `renderAll()`: calls all render functions (used on data load or lobe toggle)
- `renderOnFrameChange()`: fast path called on frame slider change

**`app.js`**
- `APP`: global state object `{ lobeData, metrics, metric, frame, active, nFrames, label, load }`
- `handleFiles(files)`: runs `loadCSVFiles()` and shows the result or the error in the info bar
- `ingestWholeLung(voxels)` / `ingestLobarFiles(lobeMap)`: normalise then load data
- `_setFrame(f)`: updates `APP.frame`, syncs all UI controls, calls `renderOnFrameChange()`
- `_startPlay()` / `_stopPlay()`: 600 ms interval animation

---

## GitHub Pages Deployment

1. Push the `xv-viewer/` folder contents to a GitHub repository.
2. Go to **Settings → Pages** and set the source branch/folder.
3. The site is live at `https://<username>.github.io/<repo>/`.

No build step, no dependencies to install: all libraries (Plotly 2.27, PapaParse 5.4) are loaded from CDN.

---

## Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| [Plotly.js](https://plotly.com/javascript/) | 2.27.0 | All interactive charts (3D scatter, violin, line) |
| [PapaParse](https://www.papaparse.com/) | 5.4.1 | In-browser CSV parsing |

Both are loaded via CDN, so no npm or bundler is required.
