# Roadmap

## Status

| Part | State |
|---|---|
| Scan (step 1) | works on 6 of the 7 test photos, ~1.5-3.5 s each; manual fixes with the block marker |
| Borders, reachable areas, groups, slime/honey (steps 2-6) | work on all 3 axes; known wrong cases below |
| Flying machines (step 7) | first version: layout only, not buildable yet (see Machines) |
| App | landing, saved geodes with autosave, 7-step HUD, layer view, debug tools, release build |

Scan results (cells compared as integers up to a translation, ~1.5 s per scene): far scenes recall 0.90 / precision 0.90 (seeds 1,2,3,5,6,7,9,10), close-up 1.00 / 0.99 (seeds 1-8), dark (0.35) 1.00 / 1.00 (seeds 4,11,12,13). Real photos geode-01..06: 28, 29, 28, 70, 70, 69 blocks, median texture match 0.97, 0.96, 0.80, 0.93, 0.89, 0.87; geode-07 finds no blocks (camera found, FOV 83.8°, but every block is covered by full-grown buds).

## Next

1. **Machines must not touch each other**: pistons of one machine break the neighbouring one, so machines of different groups need a free gap between them. `computeMachineBlocks()` does not enforce it yet.
2. **Obsidian blocks in the wrong spot**: the machine does not start. Check the template against the original farm design.
3. **Materials list**: the total of blocks/items needed (pistons, observers, slime, honey, obsidian, redstone...) is not shown.
4. **Observer and piston textures**: one texture on every face, so you can't tell where they point. They need per-face textures (face, back, sides) oriented by the block's facing.
5. **Output for people and AI agents**: a machine-readable result of the farm (blocks with position, type and facing, per axis and group, plus the materials list), readable from the page (e.g. `window.autominer.result()` and a download), documented in `llms.txt`. Makes sense once 1-3 are fixed, so the output is buildable.
6. **GitHub link in Settings**: a quick link to the repository from the settings panel.
7. Then: the slime block structure as data, not only display; real pistons and redstone wiring between the machines; schematic export (.litematic / .schematic).

## Open problems: scan

1. **Far blocks, depth ambiguity**: for a far cube, moving it one cell in depth changes its silhouette by less than a pixel, so the lines cannot tell the positions apart and the texture is too small to decide (far seeds 2 and 3: 0.50 and 0.69). Options: read the far areas on the full-resolution original (3840 px instead of the 1600 px copy), or use the shape of the geode (the amethyst lies on a spherical shell) to pick the depth consistent with the neighbours. Manual edits cover it for now.
2. **Buds hide the blocks**: in survival the geode cannot be fully cleared before the screenshot, the buds grow back while you clear it and get into position. A bud growing from the block above covers part of the block below, whose texture match drops under the threshold (geode-06: one block missed this way). geode-07 is the extreme case: nearly every block wears grown clusters, the silhouettes are spiky stars instead of hexagons, only 15 of 97 outline lines survive refinement and no blocks are found. Idea: mask the buds (pale pink, thin, not cube-shaped) out of the texture comparison instead of counting them against the cell.
3. The back wall (blocks on the same lattice) is not used; the inner edges of the cubes (brightness steps between faces: 100/80/60/50%) are not used as lines yet.
4. Photos with texture packs.
5. The landing page suggests opening the F3 debug screen before the screenshot, but the app does not read it. With F3 the exact camera position and orientation are on screen, which would make the camera solve trivial: either read it (OCR) or drop the tip.

## Open problems: grouping

The geodes are in `saved-veins.json`: paste one entry (`seed`, `size`, `ores`) into the debug panel's Import JSON to reload it.

1. **Area bigger than 12 with no cut** (`1-xz-oversized`, axis y: adjacent borders of 32 and 16 cells): the grouping could only cut between areas. Fixed by `splitOversizedAreas()`. Still open: a single BFS layer wider than 12 can't be cut this way, and the pieces are not always the minimum (32 → 4 pieces, minimum 3).
2. **Groups not colourable with only slime and honey** (same geode, axis y): 3+ groups end up touching each other. The colours are only checked at the end (`evaluateGrouping`, best of 40 tries), not used while grouping, so merging a piece of a split area with an outside area can break the band alternation. Idea: make the grouping refuse or penalise merges that create an odd cycle.
3. The slime/honey preference slider (debug) is UI only, not wired into the grouping yet.

## Done

- 2026-11-11: code split into small modules (`js/scan`, `stage1`, `main`, `building`, `scene`, `app`); release build (`npm run build` → `docs/index.html`).
- 2026-11-10: app with landing page, saved geodes, 7-step HUD, debug switch.
- 2026-11-08/09: the scan without search (linear solves on the lines), adaptive purple hue, steps 2-7 on the scanned geode.
