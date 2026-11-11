# How it works

The pipeline: **scan** (screenshot → 3D map of the budding amethyst) → per axis: **borders** → **reachable areas** → **groups of at most 12** → **slime/honey** → **flying machines**. Everything after the scan takes milliseconds, so the app always shows the final result and each step is a view of one phase.

## 1. Scan: from a screenshot to the blocks (`js/scan/`)

Fully automatic and without any search: the camera and the block lattice are solved with equations.

- **Purple mask** (`purple-mask.js`): an HSV window adapted to each photo. `amethystHueShift` measures the amethyst hue peak (normally 132-135); a warm or dark screenshot (survival, geode-05: 157) widens the window toward it, also past 179 (the pale pink texels wrap to hue 0-8). Works in dim light (V >= 20, saturation >= 70).
- **Lines** (`mask-lines.js`, `refine-lines.js`): `extractMaskLines` finds the straight outlines of the mask (rough position); `refineLinesRGB` refines them on the colour photo (Fisher discriminant on R,G,B, sub-pixel step edge, robust line fit; lines with no colour step are chords across concavities between cubes and are dropped).
- **Camera** (`camera-from-lines.js`): `cameraFromLines` estimates pitch, yaw and FOV from the refined lines. Minecraft has no roll, so the vertical edges of the blocks all cross the centre column of the image at the same height (the vertical vanishing point); given that height the pitch is a formula of the FOV, and only FOV and yaw are scanned (~20 ms). This estimate mainly says which of the 3 axes each line belongs to. With too few lines it falls back on `autoCalibrate` (grid on the mask edges, `auto-calibrate.js`). The FOV is never assumed: survival has a lower FOV than creative (geode-05/06: ~82°, the others ~90°).
- **Cubes and lattice** (`cube-poses.js`, `lattice.js`): with the camera known, a measured line is a plane through the camera, and the cube edge lies in that plane, so **each line is a linear equation in the cube position**; 3 lines are enough (`solveCubePosition`). Cubes are read in two ways: `posesOfIsolatedCubes` (a blob of a single cube) and `posesOfCornerCubes` (also inside a cluster: 3 consecutive outline sides of 3 different families joined by convex corners are 3 sides of one cube's hexagon). `latticeConsensus` keeps the reference cube most others agree with at integer offsets (2 are enough). `solveCameraOnLines` solves camera and origin together by bringing the lattice edges onto the lines (Levenberg-Marquardt); `solveLattice` repeats poses → consensus → solve until the camera stops moving. `finishLattice` alternates cell choice and a solve on all the lines of those cells.
- **Cell choice** (`cells.js`, `texture.js`): nearest first, a cell is taken when its silhouette is purple inside (>= 97%; pixels straddling the outline count as purple only if the texture matches >= 0.75), it explains purple not yet covered, and its visible faces match the texture. The texture template is learned from the photo itself (`learnTexture`, from the cubes read directly, or from the cells found if there are too few at first) and used only if `templateQuality` >= 0.5, with a threshold relative to the photo.
- **Manual edits** (`js/stage1/`): the block marker is the lattice cell crossed by the camera-mouse line; the panel (debug) shows every check of the cell choice on it (`explainCell`, same rule as `selectCellsByRay`). A manual choice wins over the automatic one and is saved by position, not by cell index. The wireframes show only the visible edges.
- **To the 3D steps** (`js/stage1/photo-vein.js`): the lattice axes are a mirror image of Minecraft's, so x is flipped to keep the geode's handedness; j is up. The 3D view opens from the photo's own viewpoint.

Abandoned: line detection with Canny + Hough on the whole photo (too noisy on the stone texture to find reliable vanishing points).

## 2. Borders, areas, groups (`js/building/`)

For each of the 3 axes the volume is flattened into a 2D plane (`plain.js`): the air cells next to the amethyst are the **tight borders** (where crystals grow). Isolated areas are found (`areas.js`), and those too small or without a walkable L path are dropped (`l-shapes.js`). Then nearby borders are merged into wider structures by adding support blocks.

Minecraft constraints:
- **Size**: a piston pushes at most **12 blocks**, so no group can exceed 12 (and has at least 4).
- **Material**: slime sticks to slime and honey to honey, but not to each other. Two groups that touch must use different materials, or a piston would drag both: a **2-colouring** problem on the groups' adjacency graph, not always solvable when 3+ groups touch each other (odd cycle).
- **L shape**: required on the group being pushed, not on the machine.

**Grouping** is a known NP-hard problem (partitioning a graph into connected components under a capacity limit with the fewest components, by reduction from Steiner tree). Two phases:
1. **Approximate Steiner tree** (`area-distances.js`, `forest.js`): multi-source BFS from each tight border through air only gives the shortest path to every other reachable border; an MST on these distances (metric closure MST, a 2-approximation).
2. **Tree partitioning** (`partitionForest`): post-order DFS; each node merges its children's subtrees (smallest first) while they stay under 12 blocks, otherwise closes them as their own group. For the fewest pieces of a tree under a weight limit this is optimal.

The whole thing (`grouping.js`) runs **40 times** with random tie-breaks in the MST and keeps the best: first the results that can be 2-coloured, then fewer groups. If none can, it keeps the best anyway and reports it (`data_layers.support.bipartite`, `touchingConflicts`, `console.warn`). A single border already over 12 blocks is cut into pieces by `splitOversizedAreas()` (BFS bands, slime/honey alternating by band); what cannot be cut is reported in `data_layers.support.oversizedAreas`.

The randomness is deterministic: a seeded PRNG (`makePRNG` in `js/Tools.js`), so the same seed always gives the same geode and grouping.

## 3. Flying machines (`js/MachineTools.js`)

One machine per final group, anchored at its centroid and extending outwards along the axis. The machine is the slime/honey flying machine of the public amethyst farm design popularised by ilmango (coordinates cross-checked against the Geodesy mod's `buildMachine()`): a linear 20-block structure, 9×3×1 plus an air gap, anchored between two fixed obsidian blocks; the one on the geode side is one air block away from the first piston, the room that piston needs to extend. "Build on the other side" in Settings picks the side for each axis. The redstone sequence has not been traced in detail, only the static layout. Known problems in [ROADMAP.md](ROADMAP.md).
