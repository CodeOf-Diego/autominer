# Autominer

**Automate your amethyst farm.** Take a screenshot of an amethyst geode in Minecraft, and Autominer finds its budding amethyst blocks and works out the flying machines that harvest it: three sets of machines, one per axis (X, Y, Z), that sweep slime and honey blocks past the budding amethyst to break the grown clusters without mining by hand.

**Open the app: <https://codeof-diego.github.io/autominer/>**. It runs entirely in your browser: nothing is uploaded, and your geodes are saved in that browser only.

## How to use it

1. **Take the screenshot** (see the tips below) and drop it on the page, paste it (Ctrl+V), or click *Scan a screenshot*. No screenshot at hand? *Generate a random geode* shows how it works.
2. **Step 1, Scan**: in a few seconds the app finds the camera and every budding amethyst block it can see, and draws them on your photo. If it missed a block or took a wrong one, fix it: click the photo where the block is, scroll to move the marker nearer or farther, press `X` (or the button) to add or remove it.
3. **Steps 2-7** build the farm around those blocks, shown in 3D:

| Step | What you see |
|---|---|
| 2 · Geode | your budding amethyst blocks |
| 3 · Borders | the geode flattened once per axis: in yellow every free spot where a crystal can grow |
| 4 · Reachable | only the spots a machine can actually sweep |
| 5 · Groups | the spots joined into groups of at most 12 blocks (a piston pushes 12 at most), one colour per group |
| 6 · Materials | slime or honey for each group: touching groups get different materials, so they never stick together |
| 7 · Machines | one flying machine per group, pushing along its axis |

4. **Build it in game**: turn on the **layer view** (top right, or `L`) to see one horizontal layer at a time; `↑` `↓` move between layers.

Every geode you open is saved automatically in your browser (the landing page lists them, with *Resume* for the last one). Settings (gear icon): how far from the geode the machines go, on which side each axis is built, skip the build animation, delete all saved geodes.

### Tips for a good screenshot

- **Clear the geode first**: remove everything that is not budding amethyst (calcite, smooth basalt, normal amethyst blocks, the stone around it). With cheats, one command does it, e.g. `/fill ~-15 ~-15 ~-15 ~14 ~14 ~14 air replace #p:clean` empties a 30×30×30 cube around you, where `#p:clean` is a block tag (from a datapack) listing everything to remove.
- **Shoot right after clearing**: the amethyst buds grow back, and a block wearing big clusters is hard to recognise.
- **Get the whole geode in view, not too far away**: blocks that are very far are only a few pixels wide and their depth becomes uncertain.
- **Vanilla textures**: texture packs are not supported yet. Any FOV, creative or survival, day or dim light work.

### Keys

`←` `→` or `1`-`7`: change step · `L`: layer view, `↑` `↓` to change layer · on the photo (step 1): click to place the block marker, wheel to move it nearer/farther, `X` add/remove it, `Esc` remove the marker, `0` reset the zoom.

## Current limits

This is a work in progress. The scan and steps 2-6 work. **Step 7 is a first version and its machines are not ready to build yet**: the obsidian anchors are in the wrong place (the machine does not start), machines of different groups can end up touching, and there is no list of the materials needed. Some geodes cannot be split into groups using only slime and honey. See [ROADMAP.md](ROADMAP.md).

## Credits

The farm itself is the public amethyst farm design of the Minecraft technical community, popularised by **ilmango**: slime and honey flying machines that sweep the budding amethyst. Autominer only works out where and how to build it for your own geode. The idea of doing that as a web tool came from the [Geodesy](https://github.com/kosmolot-mods/geodesy) mod, which plans the same farm inside the game; its source was also used to cross-check the game rules and the machine's coordinates.

## More

- [HOW-IT-WORKS.md](HOW-IT-WORKS.md): how the scan and the grouping work.
- [DEVELOPMENT.md](DEVELOPMENT.md): run it locally, code layout, tests, release build.
- [ROADMAP.md](ROADMAP.md): status, test results, open problems.
- [llms.txt](llms.txt): instructions for AI agents that want to use the app.
