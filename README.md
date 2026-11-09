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
   Comes from the photo shown in stage 1 (the cubes found, after the manual edits); `r` still generates a random one for demos.

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
   **"Swappable axis" requirement:** *done*; the "Invert axis" checkboxes in the settings menu choose on which side of the geode each axis's blueprint/machine is built.
   **"Return system" requirement:** *solved conceptually*; the machine is anchored between two fixed obsidian blocks; the one on the geode side is separated from the first piston by **one air block**, the room that piston needs to extend. The exact redstone sequence that fires the pistons has not been traced in detail, only the static block layout.
   **Known limit:** machines of nearby groups are not checked for overlaps.

4. **Slime block structure** *(to do)*
   From the machines, the slime/honey blocks needed to push and mine.

5. **Piston machine** *(to do)*
   The pistons that push the slime blocks, one machine per group defined in step 2.

6. **Full 3D model** *(to do)*
   Final result: viewable and buildable **layer by layer**, with **schematic export** (e.g. .schematic/.litematic).
   **Requirement:** also compute the **resource cost** (pistons, slime/honey blocks, etc.).

## Interface requirements

- **Generation settings menu** *(done, `m` key)*: ore density, range (shell thickness), machine distance from the geode, per-axis inversion, JSON import (sparse or dense), Generate button (uses the pasted JSON if any, otherwise a random vein from the sliders). Also a slime/honey preference slider (0 = honey .. 100 = slime, default 100), **UI only for now**, not yet wired into the grouping/colouring.
- Menu to start a new build from a photo and to open one saved in **local storage** *(to do; today only the built-in photos and JSON import)*.

## Stages

The computation takes milliseconds, so the page always shows the final result; each phase can be inspected with the number keys:

- **1**: Photo + detected cubes (step 0): the screenshot with the refined lines (colour = axis), the cubes snapped to the lattice, and the panel with the overlays and the probe cube
- **2**: Geode (amethyst only)
- **3**: Tight borders (cells next to the amethyst, not yet filtered)
- **4**: Valid borders (after dropping areas too small or without an L path)
- **5**: Final groups of at most 12 blocks, each with its own colour (fixed palette of 8 colours, so nearby groups never get similar shades)
- **6**: Materials: the same grouping reduced to slime (green) / honey (yellow)
- **7**: Flying machines: one machine (Geodesy design, 19 blocks + gap) per final group, anchored at its centroid and extending outwards along the axis

Stage 1 replaces the 3D scene with a 2D canvas; the other stages use the Three.js scene. From stage 5 on, each group shows an id number (0, 1, 2...) in each of the 3 side views, in increasing area id order.

**Layer view (`l` key)**: shows one Y level at a time instead of the whole scene, for stages 2-7, to build and check the result in Minecraft one horizontal layer at a time. The range runs from the first to the last level that actually contains something; levels already passed stay visible below, semi-transparent. Up/down arrows change the level, `l` again goes back to the full view.

Other keys: `r` generates a new random vein (with the current settings), `e` copies vein + seed to the clipboard, `i` shows/hides the debug panel, `m` shows/hides the settings menu. Stage 1: `x` adds/removes the probe cube, `c` copies the probe report, `0` resets the zoom, `Esc` removes the probe.

## Reproducibility (seed)

Every run (vein + grouping on the 3 axes) is driven by a single numeric seed: the same seed always gives the same result. `e` copies a compact JSON `{seed, size, ores}` (grid size + `[x,y,z]` of the amethyst cells only, 0-based) to the clipboard. To load it back: `let {seed, vein} = veinFromExport(json); processVein(vein, seed)`; the old dense `{seed, vein}` format is read too. For a random vein the `seed` alone regenerates it; `ores` is for veins that were not generated (a real geode).

## Current state

- Step 0 (reconstruction from a photo) works on the 6 test photos, ~1.5-3.5 s each; steps 1-2 and a first version of step 3 (flying machines, stage 7) work. Stages 1-7, plus the layer view.
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
  - **Stage 1 panel**: a selector of the 6 test photos (`reference/screenshots/geode-01..06.png`, reduced copies in `js/PhotoData.js`) and of the synthetic test scenes (generated on first use, with the truth and the score shown).
  - **Probe cube**: once the run is done, a click on the photo puts a cube (green if the rule would take it, red if not) on the lattice cell crossed by the camera-mouse line; the wheel moves it along that line (up = farther), a click freezes it, Esc removes it. The panel shows every check of the cell choice on that cell (`explainCell`: same rule and thresholds as `selectCellsByRay`), and the silhouette is coloured free and purple / free not purple / covered by nearer cubes.
  - **Manual edits**: `x` (or the button) adds or removes the probe cube from the result; the manual choice wins over the automatic one, is saved in the browser per photo (by position, not by cell index), added cubes are cyan and removed ones dashed.
  - The wireframes show only the visible edges (camera-to-edge ray not passing through any cube).
  - **Stages 2-7 work on the cubes of the photo** (after the manual edits). The lattice axes are a mirror image of Minecraft's, so x is flipped to keep the geode's handedness; j is up. `r` still generates a random vein, which stays until the next photo result.
- `js/SceneTools.js`: Three.js scene/cameras, voxel rendering (fixed palette per group at stage 5, 2 material colours at stage 6, machine blocks at stage 7), group id numbers projected on the side views, 3D scene on/off (`set3DVisible`) for stage 1.
- `main.js`: orchestrator: builds the vein (from the photo, or random from a seed with the current settings), runs the pipeline with the per-stage snapshots, handles the keys and the settings menu (`setupSettingsMenu()`), and the stage 1 view (overlay, probe cube, manual edits).

## Next steps

Synthetic tests with known truth in `reference/synthetic/` (PNG images + JSON with the true cubes; tools in `reference/synthetic/tools/`, `node synth_run.js`). Current results (cells compared as integers up to a translation, ~1.5 s per scene end to end): far scenes recall 0.90 / precision 0.90 (seeds 1,2,3,5,6,7,9,10), close-up 1.00 / 0.99 (seeds 1-8), dark (0.35) 1.00 / 1.00 (seeds 4,11,12,13). Real photos: geode-01..06 give 28, 29, 28, 70, 70, 69 cubes, median texture match of the cells 0.97, 0.96, 0.80, 0.93, 0.89, 0.87.

Open problems:
1. **Far cubes, depth ambiguity**: for a far cube, moving it one cell in depth changes its silhouette by less than a pixel, so the outer lines cannot tell the positions apart and the texture is too small to decide (far seeds 2 and 3: 0.50 and 0.69). Options: read the far areas on the full-resolution original (3840 px instead of the 1600 px copy), or use the shape of the geode (the amethyst lies on a spherical shell) to pick the depth consistent with the neighbours. Manual edits cover it for now.
2. **Amethyst buds hide the blocks**: in survival the geode cannot be fully cleared before the screenshot, because while you clear it and get into position the buds grow back, especially in a big geode. A bud growing from the block above covers part of the texture of the block below, whose texture match then drops under the threshold (geode-06: one block missed on the right this way). To be solved later: e.g. mask the buds (pale pink, thin, not cube-shaped) out of the texture comparison instead of counting them against the cell.
3. The back wall (blocks on the same lattice) is not used; the inner edges of the cubes (brightness steps between faces: 100/80/60/50%) are not used as lines yet.
4. Photos with texture packs.

Known wrong cases in the slime/honey grouping (steps 1-2), to pick up next time. The veins are in `saved-veins.json`: paste one entry (`seed`, `size`, `ores`) into the settings menu import (`M`) to reload it.
1. **Area bigger than 12 with no cut** (`1-xz-oversized`, XZ plane / axis y: ADJACENT blocks of 32 and 16 cells): the grouping can only cut between areas, so a single area over the piston limit stayed one oversized group. Fixed by `splitOversizedAreas()` (BFS bands, slime/honey alternate by band parity inside the area). Still open: a single BFS layer wider than 12 can't be cut this way, and the pieces are not always the minimum (32 -> 4 pieces, minimum 3).
2. **Groups not colorable with only slime and honey** (same vein, axis y, also before the split): 3+ groups end up touching each other. The colors are only checked at the end (`evaluateGrouping`, best of 40 random tries), not used while grouping, so merging a piece of a split area with an outside area can break the band alternation. Idea: make the grouping take the colors into account (e.g. refuse or penalize merges that create an odd cycle), instead of just scoring the result.

Then: overlaps between machines of nearby groups (step 3), step 4 (slime block structure as data, not only display) and step 5 (real pistons, redstone wiring between the machines).
