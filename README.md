# Autominer

Given the layout of an amethyst geode, Autominer computes the best way to mine it. The mining is done by **three automatic machines**, one per axis (X, Y, Z), which push slime/honey blocks to break the surrounding amethyst buds without mining by hand.

The project is inspired by the [Geodesy](https://github.com/kosmolot-mods/geodesy) mod (Fabric), which does the same in game through commands. Several constraints implemented here were confirmed against or taken from its source code: the 4-12 block range per group, the L-shape rule (required on the group being pushed, not on the machine), slime/honey alternation between adjacent groups, and the exact flying machine design (step 6).

## Planned pipeline

0. **Reconstruction from a photo** *(in progress, stage 1 in the app)*
   Start from a real Minecraft screenshot of a geode and rebuild the 3D position of its amethyst blocks, so that the later steps work on real data instead of a random geode.
   **Shortcut worth remembering:** if the screenshot is taken with Minecraft's debug screen open (**F3**, vanilla, no mods), the exact camera position and orientation can be read on screen; all this computer-vision calibration is only needed for photos taken WITHOUT F3.
   **Command to isolate the geode before the screenshot:** `/fill ~-15 ~-15 ~-15 ~14 ~14 ~14 air replace #p:clean` empties a 30×30×30 cube around the player and leaves only the geode (`#p:clean` is the datapack block tag with everything to remove).
   1. **Line detection with Canny + Hough** *(abandoned and removed)*: too noisy on the wall texture to find reliable vanishing points.
   2. **Automatic calibration** *(current approach, stage 1; no manual input)*: HSV purple mask → rough lines from the mask outlines → lines refined on the colour photo → camera (pitch/yaw/FOV) from the lines → cubes and lattice solved from the lines → cells chosen by a rule on the projection of each cell, checked against the texture learned from the photo. Details in the `js/CalibrationTools.js` entry below.

1. **Geode**: 3D map of the amethyst blocks.
   Comes from the photo shown in stage 1 (the cubes found, after the manual edits); "Generate a random geode" on the landing page makes one for demos.

2. **Borders and supports per axis** *(done on all 3 axes)*
   For each of the 3 axes: flattens the volume into a 2D plane, finds the air cells next to the amethyst ("tight borders"), finds the isolated areas, drops those too small or without a walkable L path, then merges nearby tight borders into wider contiguous structures by adding support blocks ("wide borders").
   **Minecraft constraint (size):** a piston can push at most **12 blocks**, so no merged group can exceed 12 blocks.
   **Minecraft constraint (material):** slime sticks to slime and honey to honey, but slime and honey do **not** stick to each other. Two final groups that touch must therefore use different materials, otherwise they would merge into one oversized group when a piston pushes. This is a **2-colouring** problem on the adjacency graph of the groups, not always solvable when 3+ groups touch each other (odd cycle).
   **Grouping algorithm** (`BuildingTools.js`): a known problem (partitioning a graph into connected components under a capacity limit, minimising the number of components), NP-hard by reduction from Steiner Tree. Two phases:
   1. **Approximate Steiner tree** (`computeAreaDistances` + `buildMSTForest`): multi-source BFS from each raw tight border through air cells only, to find the shortest distance (and path) to every other reachable border, not only those touching a single block. MST on these distances (the classic "metric closure MST", a 2-approximation of the Steiner tree).
   2. **Optimal tree partitioning** (`partitionForest`): greedy post-order DFS; each node tries to merge its children's subtrees (smallest first) while they stay under 12 blocks, otherwise it closes them as a group of their own. For this specific problem (fewest pieces of a tree under a weight limit) this is **optimal**, not a heuristic.
   The whole thing (`simulateGrouping`) runs **40 times** with random tie-breaks in the MST and keeps the best result: first those that can be 2-coloured (slime/honey), then those with fewer groups. If no attempt can be 2-coloured, it keeps the best anyway and reports it (`data_layers.support.bipartite`, `touchingConflicts`, `console.warn`).
   The randomness is **deterministic**: every run uses a seeded PRNG (`makePRNG` in `Tools.js`), so the same seed gives the same result (vein + grouping).
   **Oversized areas:** a single tight border already over 12 blocks before any merge is split into pieces <= 12 by `splitOversizedAreas()` (see the known wrong cases under Next steps); what still cannot be split is reported in `data_layers.support.oversizedAreas` (+ `console.warn`).

3. **The 3 machines** *(first version done, stage 7)*
   From the borders/supports of each axis, the physical machine that mines along that axis: one flying machine per final group, using the exact design of the Geodesy mod (`js/MachineTools.js`, `MACHINE_TEMPLATE` transcribed from the real `setBlock()` calls of `GeodesyCore.java::buildMachine()`, checked line by line against the source: a linear 20-block structure, 9×3×1 plus an air gap, not an L; the L required by the solver is on the *shape of the group* being pushed, not on the machine).
   **"Swappable axis" requirement:** *done*; "Build on the other side" (X/Y/Z) in Settings chooses on which side of the geode each axis's blueprint/machine is built.
   **"Return system" requirement:** *solved conceptually*; the machine is anchored between two fixed obsidian blocks; the one on the geode side is separated from the first piston by **one air block**, the room that piston needs to extend. The exact redstone sequence that fires the pistons has not been traced in detail, only the static block layout.
   **Known limit:** machines of nearby groups are not checked for overlaps.

4. **Slime block structure** *(to do)*
   From the machines, the slime/honey blocks needed to push and mine.

5. **Piston machine** *(to do)*
   The pistons that push the slime blocks, one machine per group defined in step 2.

6. **Full 3D model** *(to do)*
   Final result: viewable and buildable **layer by layer**, with **schematic export** (e.g. .schematic/.litematic).
   **Requirement:** also compute the **resource cost** (pistons, slime/honey blocks, etc.).

## Interface

- **Landing page**: scan a screenshot (click, drop it anywhere on the page or paste it with Ctrl+V), generate a random geode, or open a saved one (with "Resume" for the last one opened). The geode shown behind the panel turns slowly.
- **Saved geodes, autosaved** (`js/App.js`): every geode opened is a record in the browser's IndexedDB (database `autominer`, store `geodes`): name, source, step reached, the original screenshot, the manual cube edits, and the amethyst cells once the scan has found them (so a saved photo reopens straight on steps 2-7, without OpenCV). Every change is written within half a second, and right away when the tab is hidden or closed, so a timeout or a closed tab loses nothing. Saved per browser only; Settings → "Delete all" empties it.
- **Workspace**: full-screen view with a glass HUD: the geode name (editable) and save state top left, the card explaining the current step, the 7 steps as a dock at the bottom (`←`/`→` or `1`-`7`; a step that cannot run yet is greyed out: step 1 for a geode with no screenshot, steps 2-7 until the scan is done), the layer view, reset view and settings top right. Each step change frames the whole build. Step 1 shows the scan progress in plain words, then the number of blocks found and the block picker (click the photo, wheel = nearer/farther, `X` or the button adds/removes the block).
- **Settings**: machine distance from the geode and the side each axis's machines are built on (both remembered), the debug switch, delete all saved geodes.
- **Debug** (off by default, Settings → Debug tools, remembered): a panel under the step card with every developer control of the old interface (photo/synthetic scene selector, overlays, known FOV, recompute, the full stage-1 stats and probe diagnostics, pipeline stats, axes shown, vein export, the generator sliders and JSON import, which create a new saved geode), plus the 3 orthogonal per-axis views with the group numbers, the axes helper and the red marker cube. The slime/honey preference slider is there too, **UI only for now**, not yet wired into the grouping/colouring.
- **`index.html#dev`**: the old developer session, not saved: debug on, a random vein for stages 2-7, the built-in photo geode-01 on stage 1. The synthetic test tools (`reference/synthetic/tools/`) open this.

## Stages

The computation takes milliseconds, so the page always shows the final result; each phase can be inspected from the step dock or with the number keys:

- **1**: Photo + detected cubes (step 0): the screenshot with the refined lines (colour = axis), the cubes snapped to the lattice, and the panel with the overlays and the probe cube
- **2**: Geode (amethyst only)
- **3**: Tight borders (cells next to the amethyst, not yet filtered)
- **4**: Valid borders (after dropping areas too small or without an L path)
- **5**: Final groups of at most 12 blocks, each with its own colour (fixed palette of 8 colours, so nearby groups never get similar shades)
- **6**: Materials: the same grouping reduced to slime (green) / honey (yellow)
- **7**: Flying machines: one machine (Geodesy design, 19 blocks + gap) per final group, anchored at its centroid and extending outwards along the axis

Stage 1 replaces the 3D scene with a 2D canvas; the other stages use the Three.js scene. From stage 5 on, each group shows an id number (0, 1, 2...) in each of the 3 side views (debug only), in increasing area id order. For end users stage 1 shows only the detected cubes and the floor grid (plus the mask and lines while the scan runs); the other overlays and the probe's silhouette colours are debug only.

**Layer view (`l` key or the layers button)**: shows one Y level at a time instead of the whole scene, for stages 2-7, to build and check the result in Minecraft one horizontal layer at a time. The range runs from the first to the last level that actually contains something; levels already passed stay visible below, semi-transparent. Up/down arrows (or the ▲▼ buttons) change the level, `l` again goes back to the full view.

Other keys: stage 1: `x` adds/removes the probe cube, `0` resets the zoom, `Esc` removes the probe. Debug only: `r` creates a new random geode (with the generator settings), `e` copies vein + seed to the clipboard, `c` copies the probe report.

## Reproducibility (seed)

Every run (vein + grouping on the 3 axes) is driven by a single numeric seed: the same seed always gives the same result. `e` copies a compact JSON `{seed, size, ores}` (grid size + `[x,y,z]` of the amethyst cells only, 0-based) to the clipboard. To load it back: `let {seed, vein} = veinFromExport(json); processVein(vein, seed)`; the old dense `{seed, vein}` format is read too. For a random vein the `seed` alone regenerates it; `ores` is for veins that were not generated (a real geode).

## Current state

- Step 0 (reconstruction from a photo) works on 6 of the 7 test photos, ~1.5-3.5 s each (geode-07 fails, see open problem 2); steps 1-2 and a first version of step 3 (flying machines, stage 7) work. Stages 1-7, plus the layer view.
- Rendering with Three.js (stages 2-7): main camera + 3 orthographic cameras (one per axis). Stage 1 uses a separate 2D canvas.
- No build step: plain JS files loaded directly by `index.html`, no bundler or minified bundle. OpenCV.js (stage 1) comes from a CDN. GitHub Pages serves the repository as it is from `main`.
- Separate reference page (`flying-machine-templates.html`, open it directly in the browser): explorable 3D models of the piston mechanisms.
- Another separate page (`camera-calibration.html`): the old sandbox to tune the line-detection parameters (Canny/Hough) on a photo; no longer used by the app.

## Code structure

- `js/Blocks.js`: voxel/block type enum.
- `js/Matrix2D.js` / `js/Matrix3D.js`: 2D/3D matrix wrappers with helpers to iterate, read neighbours and clone (used for the stage snapshots).
- `js/Tools.js`: random geode generation (seeded) + deterministic PRNG (`makePRNG`), compact vein format (`veinToSparse`/`veinFromSparse`/`veinFromExport`).
- `js/BuildingTools.js`: all of step 2 (borders, areas, supports, grouping into 12 blocks with slime/honey 2-colouring, group centroids for the id numbers).
- `js/MachineTools.js`: step 3: `MACHINE_TEMPLATE` (Geodesy design) and `computeMachineBlocks()`, which places it for each final group.
- `js/CalibrationTools.js`: step 0, fully automatic and without any search: the lattice is solved with equations.
  - **Purple mask**: HSV window, adapted to each photo: `amethystHueShift` measures the amethyst hue peak (normally 132-135) and a warm or dark screenshot (survival, geode-05: 157) widens the window toward it, also past 179 (the pale pink texels wrap to hue 0-8). Works in dim light (V >= 20, saturation >= 70).
  - **Lines**: `extractMaskLines` finds the straight outlines of the mask (rough position); `refineLinesRGB` refines them on the colour photo (Fisher discriminant on R,G,B, sub-pixel step edge, robust line fit; lines with no colour step are chords across concavities between cubes and are dropped).
  - **Camera**: `cameraFromLines` estimates pitch, yaw and FOV from the refined lines. Minecraft has no roll, so the vertical edges of the blocks all cross the centre column of the image at the same height (the vertical vanishing point); given that height the pitch is a formula of the FOV, and only FOV and yaw are scanned (~20 ms). This estimate mainly says which of the 3 axes each line belongs to. Only with too few lines does it fall back on `autoCalibrate` (grid on the mask edges). The FOV is never assumed: survival has a lower FOV than creative (geode-05/06: ~82°, the others ~90°).
  - **Cubes and lattice**: with the camera known, a measured line is a plane through the camera and the cube edge lies in that plane, so **each line is a linear equation in the cube position**, and 3 lines are enough (`solveCubePosition`). Cubes are read in two ways: `posesOfIsolatedCubes` (a blob of a single cube) and `posesOfCornerCubes` (also inside a cluster: 3 consecutive outline sides of 3 different families joined by convex corners are 3 sides of one cube's hexagon). `latticeConsensus` keeps the reference cube most others agree with at integer offsets (2 are enough). `solveCameraOnLines` solves camera and origin together by bringing the lattice edges onto the lines (Levenberg-Marquardt); `solveLattice` repeats poses → consensus → solve until the camera stops moving. `finishLattice` alternates cell choice and a solve on all the lines of those cells.
  - **Cell choice** (`chooseCells` → `selectCellsByRay`): nearest first, a cell is taken when its silhouette is purple inside (>= 97%; pixels straddling the outline count as purple only if the texture matches >= 0.75), it explains purple not yet covered, and its visible faces match the texture. The texture template is learned from the photo itself (`learnTexture`, from the cubes read directly, or from the cells found if there are too few at first) and used only if `templateQuality` >= 0.5, with a threshold relative to the photo.
  - **Stage 1 panel** (debug panel): a selector of the screenshot of the open geode, the 7 test photos (`reference/screenshots/geode-01..07.png`, reduced copies in `js/PhotoData.js`) and of the synthetic test scenes (generated on first use, with the truth and the score shown).
  - **Probe cube**: once the run is done, a click on the photo puts a cube (green if the rule would take it, red if not) on the lattice cell crossed by the camera-mouse line; the wheel moves it along that line (up = farther), a click freezes it, Esc removes it. The panel shows every check of the cell choice on that cell (`explainCell`: same rule and thresholds as `selectCellsByRay`), and the silhouette is coloured free and purple / free not purple / covered by nearer cubes.
  - **Manual edits**: `x` (or the button) adds or removes the probe cube from the result; the manual choice wins over the automatic one, is saved by position, not by cell index (in the saved geode's record for an uploaded screenshot, in localStorage per photo for the built-in ones), added cubes are cyan and removed ones dashed.
  - The wireframes show only the visible edges (camera-to-edge ray not passing through any cube).
  - **Stages 2-7 work on the cubes of the photo** (after the manual edits). The lattice axes are a mirror image of Minecraft's, so x is flipped to keep the geode's handedness; j is up.
- `js/SceneTools.js`: Three.js scene/cameras on a transparent full-window canvas, sized from the window (`layout`, `setView`: the landing page moves the main view right of its panel, debug adds the 3 orthogonal views on the right third), `frame` to fit the camera to the build, voxel rendering (fixed palette per group at stage 5, 2 material colours at stage 6, machine blocks at stage 7), group id numbers projected on the side views, 3D scene on/off (`set3DVisible`) for stage 1.
- `js/App.js` + `app.css`: the app shell (landing page, saved geodes in IndexedDB with autosave, step dock and card, settings, debug switch, `#dev` session). Drives `main.js` (`newRun`, `processVein`, `loadCalibrationPhoto`, `renderStage`) and receives the scan result (`onPhotoVein`) and the manual edits (`editsFor`/`saveEdits`).
- `main.js`: orchestrator: builds the vein (from the photo, or random from a seed with the current settings), runs the pipeline with the per-stage snapshots, handles the keys and the settings/generator controls (`setupSettingsMenu()`), and the stage 1 view (overlay, probe cube, manual edits, the plain-words scan summary `updateScanSummary`).

## Next steps

Synthetic tests with known truth in `reference/synthetic/` (PNG images + JSON with the true cubes; tools in `reference/synthetic/tools/`, `node synth_run.js`). Current results (cells compared as integers up to a translation, ~1.5 s per scene end to end): far scenes recall 0.90 / precision 0.90 (seeds 1,2,3,5,6,7,9,10), close-up 1.00 / 0.99 (seeds 1-8), dark (0.35) 1.00 / 1.00 (seeds 4,11,12,13). Real photos: geode-01..06 give 28, 29, 28, 70, 70, 69 cubes, median texture match of the cells 0.97, 0.96, 0.80, 0.93, 0.89, 0.87; geode-07 finds no cubes (camera found, FOV 83.8°, but every block is covered by full-grown buds).

Open problems:
1. **Far cubes, depth ambiguity**: for a far cube, moving it one cell in depth changes its silhouette by less than a pixel, so the outer lines cannot tell the positions apart and the texture is too small to decide (far seeds 2 and 3: 0.50 and 0.69). Options: read the far areas on the full-resolution original (3840 px instead of the 1600 px copy), or use the shape of the geode (the amethyst lies on a spherical shell) to pick the depth consistent with the neighbours. Manual edits cover it for now.
2. **Amethyst buds hide the blocks**: in survival the geode cannot be fully cleared before the screenshot, because while you clear it and get into position the buds grow back, especially in a big geode. A bud growing from the block above covers part of the texture of the block below, whose texture match then drops under the threshold (geode-06: one block missed on the right this way). geode-07 is the extreme case: nearly every block wears grown clusters on all its visible faces, the purple silhouettes are spiky stars instead of hexagons, only 15 of 97 outline lines survive refinement and stage 1 finds no cubes. To be solved later: e.g. mask the buds (pale pink, thin, not cube-shaped) out of the texture comparison instead of counting them against the cell.
3. The back wall (blocks on the same lattice) is not used; the inner edges of the cubes (brightness steps between faces: 100/80/60/50%) are not used as lines yet.
4. Photos with texture packs.

Known wrong cases in the slime/honey grouping (steps 1-2), to pick up next time. The veins are in `saved-veins.json`: paste one entry (`seed`, `size`, `ores`) into the settings menu import (`M`) to reload it.
1. **Area bigger than 12 with no cut** (`1-xz-oversized`, XZ plane / axis y: ADJACENT blocks of 32 and 16 cells): the grouping can only cut between areas, so a single area over the piston limit stayed one oversized group. Fixed by `splitOversizedAreas()` (BFS bands, slime/honey alternate by band parity inside the area). Still open: a single BFS layer wider than 12 can't be cut this way, and the pieces are not always the minimum (32 -> 4 pieces, minimum 3).
2. **Groups not colorable with only slime and honey** (same vein, axis y, also before the split): 3+ groups end up touching each other. The colors are only checked at the end (`evaluateGrouping`, best of 40 random tries), not used while grouping, so merging a piece of a split area with an outside area can break the band alternation. Idea: make the grouping take the colors into account (e.g. refuse or penalize merges that create an odd cycle), instead of just scoring the result.

Open problems of the machines (step 3) and of the project (noted 2026-11-10, none done yet):
1. **Machines must not touch each other**: pistons of one machine break the neighbouring machine, so machines of different groups have to be built disconnected (a free gap between them). The placement in `computeMachineBlocks()` does not enforce it yet. This replaces the vague "overlaps between machines" item below.
2. **Obsidian blocks are placed in the wrong spot** and the machine does not start. Check the template against the Geodesy design.
3. **No ingredients list**: the total of blocks/items needed to build the machines (pistons, observers, slime, honey, obsidian, redstone...) is not shown.
4. **Observer and piston textures are wrong**: they use a single texture on every face, so you can't tell where they point. They need per-face textures (face, back, sides) oriented by the block's facing.
5. **Files are too big, code must be split**: several files are hundreds of lines (e.g. an 800-line one). Split into small modules, one job each, so that a finished piece is never touched again and a change only needs a few small files (also cheaper to read and edit for the assistant). Not a cosmetic point: it is a working rule for every future edit.
6. **Release build**: no minification, compression or bundling yet. Goal: everything in a single small file for GitHub Pages. This must be a build step that produces the release file, while the sources stay split (it conflicts with the current "no build step, plain files" design, which must be kept for development).

Then: step 4 (slime block structure as data, not only display) and step 5 (real pistons, redstone wiring between the machines).
