# Development

## Run it

Open `index.html` directly in the browser (file://): no server, no build, no install. The files are plain scripts loaded with `<script defer>`, sharing one global scope (not ES modules, which browsers block under file://). three.js comes from unpkg through an importmap, OpenCV.js (the scan) from docs.opencv.org, loaded in the background.

Under file:// every image that is drawn to a canvas or used as a texture must be inlined as a data URI: see `js/TextureData.js` and `js/PhotoData.js`.

- **Debug tools**: Settings → Debug tools (remembered). A panel under the step card with every developer control: photo / synthetic scene selector, overlays, known FOV, recompute, the full scan stats and the block marker diagnostics, pipeline stats, axes shown, vein export and import, generator sliders; plus the 3 orthogonal per-axis views with the group numbers.
- **`index.html#dev`**: developer session, not saved: debug on, a random geode for steps 2-7, the built-in photo geode-01 on step 1. Debug-only keys: `R` new random geode, `E` copy vein + seed, `C` copy the block marker report.

## Code layout

Keep files small, one job each, so a finished piece never needs to be reopened: split a file when it passes ~150-200 lines. A new script goes into `index.html` in load order (the release build follows that order).

| Folder / file | What |
|---|---|
| `js/scan/` | the scan: screenshot → camera + lattice + cells ([HOW-IT-WORKS.md](HOW-IT-WORKS.md)) |
| `js/stage1/` | step 1 view: photo and zoom, running the scan, overlay, block marker, manual edits, stats panel, synthetic scenes (debug) |
| `js/building/` | borders, areas, splitting, grouping, supports, group/material views |
| `js/MachineTools.js` | the flying machine template and its placement |
| `js/scene/` | three.js: the `SceneTools` class (`scene-tools.js`, single instance `ST`; the other files add methods to it), cameras and framing, meshes, group labels |
| `js/app/` + `app.css` | the app shell: one `App` object (state in `app.js`, the other files add functions): saved geodes (IndexedDB), autosave, landing, steps HUD, settings, start-up |
| `js/main/` | the pipeline (`pipeline.js`), `render-stage.js`, settings menu, `boot.js` (start-up and keys, loaded last) |
| `js/Tools.js`, `js/Matrix2D.js`, `js/Matrix3D.js`, `js/Blocks.js` | random geode generation, seeded PRNG, vein formats; matrix helpers; block types |
| `flying-machine-templates.html` | standalone page: explorable 3D models of the piston mechanisms |

## Geode format and seed

Every run (geode + grouping on the 3 axes) is driven by one numeric seed: the same seed gives the same result. The vein export is a compact JSON `{seed, size, ores}`: grid size + `[x,y,z]` of the amethyst cells, 0-based. Load it back from the debug panel (Import JSON), or in code: `let {seed, vein} = veinFromExport(json); processVein(vein, seed)`. The old dense `{seed, vein}` format is read too. For a random geode the seed alone regenerates it; `ores` is for geodes that were not generated (a real one).

## Tests

No test suite. The scan is measured on synthetic scenes with known truth (`reference/synthetic/`, PNG + JSON) and on the test photos (`reference/screenshots/geode-01..07.png`, kept on disk, not in the repo). The tools in `reference/synthetic/tools/` (see its README.txt) drive the app in headless Chromium with Playwright, installed outside the repo: `node synth_run.js photos`, `node synth_run.js 1,2,3 1` (far scenes), `node synth_run.js 1,2,3 1 '{"DR":[6,10],"RR":[3.5,5]}'` (close-up). Test through file://, not a local server: some bugs only show there.

## Release build

```
npm install      # once: esbuild + three, exact versions, dev only
npm run build    # writes docs/index.html
```

`tools/build.js` writes the whole app as one file, `docs/index.html` (~690 KB, ~190 KB gzipped): the scripts of `index.html` joined in page order and minified with esbuild (top-level names kept: they are the shared globals), three.js bundled in (only the classes used), `app.css` inlined, `llms.txt` copied next to it. Debug-only data is left out (`DEV_ONLY` in the script: the built-in photos and the synthetic scene generator), so the release has no built-in photos. OpenCV.js stays on its CDN.

GitHub Pages serves `main` / `/docs`: rebuild and commit `docs/` before publishing.
