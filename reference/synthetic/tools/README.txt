Synthetic geode tests for the stage-1 calibration (camera fit + cube finder). Ground truth is known, so recall/precision can be measured.

synth_page.js  generator injected in the page: window.makeSynth(seed, {bright, DR:[dMin,dMax], RR:[rMin,rMax], nCubes, ...}) -> {url, truth}.
               Random cubes in a sphere shell, grown in clusters; cubes completely hidden behind nearer ones are dropped (hidMin).
synth_save.js  writes PNG + truth JSON into reference/synthetic/ (never deletes).  node synth_save.js <seeds> <brightness list> [optsJSON] [label]
synth_run.js   runs the app's pipeline on scenes and prints lattice-relative recall/precision, camera errors and time.
               node synth_run.js <seeds> <brightness> [optsJSON]     e.g. '{"DR":[6,10],"RR":[3.5,5]}' for close-up scenes;  node synth_run.js photos   for the 3 real photos
harness.js     opens index.html in headless Chromium (Playwright, installed OUTSIDE the repo: npm install playwright in a scratch folder).

These scripts expect to sit next to a node_modules with playwright; copy them to a scratch folder with `npm install playwright` first.
Metric: cells are compared as integers up to the best global integer translation (absolute depth is ambiguous with FOV).
