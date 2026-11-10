

var d={}

/** Holds the last computed vein + per-axis data, so renderStage() can redraw any stage without recomputing */
let pipeline = null
let currentStage = 1 // the app opens on stage 1 (photo calibration)

/** Stage 1's source photo (see js/CalibrationTools.js) */
let calibrationImage = new Image()

let calibrationListenersBound = false // stage-1 panel listeners are wired once

/** The synthetic test scenes (reference/synthetic/tools/synth_page.js), with known truth: the same seeds as the tests. Generated when first picked, not stored: inlining the images would add ~10 MB. */
const SYNTH_SCENES = [
	...[1, 2, 3, 5, 6, 7, 9, 10].map((seed) => ({ key: 'synth-far-' + seed, group: 'Synthetic, far', label: 'far, seed ' + seed, seed, opts: {} })),
	...[1, 2, 3, 4, 5, 6, 7, 8].map((seed) => ({ key: 'synth-close-' + seed, group: 'Synthetic, close-up', label: 'close-up, seed ' + seed, seed, opts: { DR: [6, 10], RR: [3.5, 5] } })),
	...[4, 11, 12, 13].map((seed) => ({ key: 'synth-dark-' + seed, group: 'Synthetic, dark', label: 'dark, seed ' + seed, seed, opts: { bright: 0.35 } })),
]
let synthLoadToken = 0
/** The probe cube of stage 1: a lattice cell on the ray through the mouse, moved along it with the wheel; the panel shows every test of the cell rule on it. {mx, my, cells, idx, frozen, info} or null */
let probe = null
/** Zoom of the stage-1 photo (CSS transform of the canvas inside calibration_zoom_box): scale s >= 1 and offset (tx, ty) in CSS px; drag = pan */
let photoZoom = { s: 1, tx: 0, ty: 0, down: null, dragged: false }

function applyPhotoZoom() {
	let z = photoZoom, bw = calibration_zoom_box.clientWidth, bh = calibration_zoom_box.clientHeight
	z.s = Math.max(1, Math.min(12, z.s))
	z.tx = Math.min(0, Math.max(bw - bw * z.s, z.tx)); z.ty = Math.min(0, Math.max(bh - bh * z.s, z.ty)) // the photo always covers the box
	calibration_canvas.style.transform = z.s === 1 ? '' : 'translate(' + z.tx + 'px,' + z.ty + 'px) scale(' + z.s + ')'
	calibration_canvas.style.cursor = z.s > 1 ? 'grab' : ''
}

function resetPhotoZoom() { photoZoom.s = 1; photoZoom.tx = 0; photoZoom.ty = 0; applyPhotoZoom() }
let autoTruth = null // the true cubes and camera of the scene shown, when it is a synthetic one

/** Adds the synthetic scenes to the photo menu (only if the generator is there) */
function addSynthScenesToMenu() {
	if (!window.makeSynth) return
	let groups = new Map()
	for (let s of SYNTH_SCENES) {
		if (!groups.has(s.group)) { let g = document.createElement('optgroup'); g.label = s.group; calibration_photo.appendChild(g); groups.set(s.group, g) }
		let o = document.createElement('option'); o.value = s.key; o.textContent = s.label
		groups.get(s.group).appendChild(o)
	}
}

/** Generates a scene into PHOTO_DATA, drawing every face with the project's texture */
async function prepareSynthScene(scene) {
	if (!window.__tex) {
		let im = await new Promise((res) => { let i = new Image(); i.onload = () => res(i); i.src = TEXTURE_DATA.amethyst_block })
		let c = document.createElement('canvas'); c.width = 16; c.height = 16
		let g = c.getContext('2d'); g.drawImage(im, 0, 0)
		window.__tex = g.getImageData(0, 0, 16, 16).data
	}
	let s = makeSynth(scene.seed, scene.opts)
	PHOTO_DATA[scene.key] = s.url
	scene.truth = s.truth
}

/** The cubes found against the true ones, as integer cells up to the best global translation (absolute depth is ambiguous with FOV) */
function scoreAgainstTruth(A, T) {
	let truth = new Set(T.cubes.map((g) => g.c.join(','))), best = 0
	for (let dx = -14; dx <= 14; dx++) for (let dy = -14; dy <= 14; dy++) for (let dz = -14; dz <= 14; dz++) {
		let n = 0
		for (let c of A.cubes) if (truth.has((c.i + dx) + ',' + (c.j + dy) + ',' + (c.k + dz))) n++
		if (n > best) best = n
	}
	return { recall: best / T.cubes.length, precision: best / Math.max(1, A.cubes.length), dFov: A.fov - T.fov, dPitch: A.pitch - T.pitch, dYaw: ((A.yaw - T.yaw + 45 + 900) % 90) - 45 }
}

/** Automatic calibration (see cameraFromLines/solveLattice in js/CalibrationTools.js): fitted camera + lattice cubes, computed once per photo (or on "Recompute") */
let autoCal = null, autoCubes = null, autoCalState = 'idle' // idle | running | done
let autoLive = null // latest progress report while running (phase, score...), shown in the stats panel
/** Announces a step that has no progress callback of its own (the panel would keep showing the previous label while the step runs); waits for a repaint before the step starts */
async function setPhase(phase, extra) {
	autoLive = Object.assign({ phase }, extra)
	redrawCalibrationCanvas()
	await Promise.race([new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))), sleep(60)]) // one frame so the label is really painted; the timeout keeps a hidden tab (no frames) from stalling the run
}
let autoLines = null // {segs, w, h, shown}: straight edges of the purple outlines (mask-resolution coords), drawn one by one while running
let autoMask = null // {canvas} purple mask of the current run, drawn as a tint
let autoCalToken = 0 // bumped by each (re)run, so an older run still in flight cancels itself

/** Switches stage 1 to another built-in photo: drops everything computed for the previous one (camera fit, lines, cubes) and cancels a run still in flight */
function loadCalibrationPhoto(key) {
	autoCalToken++ // an older automatic run still in flight cancels itself
	autoCalState = 'idle'; autoCal = null; autoCubes = null; autoLive = null; autoMask = null; autoTruth = null; probe = null
	if (typeof calibration_zoom_box !== 'undefined') resetPhotoZoom()
	let want = ++synthLoadToken, scene = SYNTH_SCENES.find((s) => s.key === key)
	if (scene && !PHOTO_DATA[key]) { prepareSynthScene(scene).then(() => { if (want === synthLoadToken) loadCalibrationPhoto(key) }); return }
	if (scene) autoTruth = scene.truth
	loadManualEdits(key)
	calibrationImage = new Image()
	calibrationImage.onload = () => { if (currentStage === 1) renderCalibrationStage() }
	calibrationImage.src = PHOTO_DATA[key]
}

/**
 * Step 8: layer-by-layer view. When enabled, renderStage() draws only up to the single world-Y
 * slice `y` (of whichever stage is current), fading the layers below it instead of hiding them -
 * so a build can be followed and verified in Minecraft one horizontal layer at a time, the way
 * players actually build, while still seeing what's already been placed underneath. `y: null`
 * means "not positioned yet" - renderStage() sets it to the first occupied layer on first use.
 */
let layerView = { enabled: false, y: null }

/** Generation/layout settings, editable from the settings menu (index.html + setupSettingsMenu() below) */
let settings = {
	density: 0.05,  // fraction of shell cells that become amethyst
	range: 2.3,     // shell thickness tolerance
	gap: 1,         // blocks of separation between the vein and each axis's blueprint
	invert: { x: false, y: false, z: false }, // build that axis's blueprint before the vein instead of after
	show: { x: true, y: true, z: true }, // whether to draw that axis's blueprint at all
	slimePreference: 100, // 0 = max honey, 100 = max slime. UI only for now, not yet wired into the grouping algorithm
}

const STAGE_NAMES = {
	1: 'Photo + detected cubes',
	2: 'Geode',
	3: 'Tight borders',
	4: 'Valid borders',
	5: 'Groups (max 12 blocks)',
	6: 'Materials (slime/honey)',
	7: 'Flying machines (one per group)',
}
const LAST_STAGE = 7

/**
 * Starting from a passed vein, runs the full step-2 pipeline (perimeter, valid areas,
 * capped support grouping) on all 3 axes, keeping a snapshot after each sub-stage so the
 * result can be inspected one step at a time with renderStage().
 *
 * seed drives every random choice in the run (vein generation included, by the caller) so the
 * exact same result can be reproduced later just from that one number.
 */
function processVein(vein, seed) {
	if (d!==false) {
		d.oresCount
		d.adjacentFaces = 0
		d.plainAdjacents = {x:0,y:0,z:0}
		d.plainSupports = {x:0,y:0,z:0}
		d.groupBlocks = 0 // blocks in all final groups (adjacent + support), summed over the 3 axes
		d.groupCount = 0  // final groups, summed over the 3 axes
	}

	vein = new Matrix3D(vein)
    console.log('vein',  vein)

	// separate RNG per axis (derived from the same seed) so the 3 axes don't all draw the
	// exact same random sequence, while the whole run stays reproducible from one seed
	let axisRng = { x: makePRNG(seed + 1), y: makePRNG(seed + 2), z: makePRNG(seed + 3) }

	let data_layers={x:{},y:{},z:{}}
	for (let axis of ['x','y','z']) {
		data_layers[axis].plain = generatePlain(vein, axis)
		findAdjacents(data_layers[axis].plain)
		data_layers[axis].snapshotStretti = data_layers[axis].plain.clone() // stage 2

		findDistinctAreas(data_layers[axis])
		disableInvalidAreas(data_layers[axis])
		data_layers[axis].snapshotValide = data_layers[axis].plain.clone() // stage 3

		addSupportBlocks(data_layers[axis], axisRng[axis])
		data_layers[axis].snapshotGruppi = buildGroupPlain(data_layers[axis]) // stage 4
		data_layers[axis].snapshotMateriali = buildMaterialPlain(data_layers[axis]) // stage 5
		data_layers[axis].groupLabels = computeGroupLabels(data_layers[axis])

		// groupSizes: {finalGroupId: blocks}, support blocks included (each is <= 12 unless oversized)
		let sizes = Object.values(data_layers[axis].support.groupSizes)
		d.groupCount += sizes.length
		d.groupBlocks += sizes.reduce((sum, n) => sum + n, 0)
	}

	vein.set(2,2,2,Voxels.RED)
	// vein.set(12,12,12,Voxels.BLU)

	pipeline = { vein, data_layers, seed }
}

/** Generates a new random vein + grouping from a fresh (or given) seed, using the current settings */
function newRun(seed) {
	if (seed === undefined) seed = Math.floor(Math.random() * 0xffffffff)
	let vein = generateRandomVein(seed, settings.density, settings.range)
	processVein(vein, seed)
}

/** Briefly shows a message (a toast at the bottom of the page) */
function flashStageMessage(text) {
	App.toast(text)
}

/**
 * Whether a stage-1 overlay is on: its checkbox in the debug panel when debug is on, otherwise the default for end users
 * (the detected cubes and the floor grid, without the diagnostic layers)
 */
function overlayOn(checkbox, userDefault) {
	return App.debug ? checkbox.checked : userDefault
}

/** Copies the exact vein + seed currently shown to the clipboard, so a specific result can be shared and reloaded later */
function exportVein() {
	if (pipeline === null) return
	// compact form (size + ore coordinates) instead of the full matrix - see veinToSparse() in Tools.js.
	// Load it back with veinFromExport(); the old dense {seed, vein} format loads there too.
	let json = JSON.stringify({ seed: pipeline.seed, ...veinToSparse(pipeline.vein.matrix) })
	copyText(json, 'Vein copied to the clipboard', () => {
		// clipboard unavailable (e.g. opened via file://, or permission denied) - fall back to a download
		let blob = new Blob([json], { type: 'application/json' })
		let url = URL.createObjectURL(blob)
		let a = document.createElement('a')
		a.href = url
		a.download = 'vein-' + Date.now() + '.json'
		a.click()
		URL.revokeObjectURL(url)
	})
}

/**
 * Stage 1: shows calibrationImage with its detected line segments (see js/CalibrationTools.js)
 * instead of the 3D scene, with the automatic camera fit + detected cubes overlaid (autoCal/autoCubes).
 */
function renderCalibrationStage() {
	ST.set3DVisible(false)
	ST.clearGroupLabels()
	calibration_view.style.display = 'flex'

	stage_info.innerHTML = 'Stage 1/' + LAST_STAGE + ' - ' + STAGE_NAMES[1] + ' - photo ' + (manualEditsPhoto || '-')

	if (!calibrationImage.complete || calibrationImage.naturalWidth === 0) {
		stage_info.innerHTML += ' | loading photo...'
		updateScanSummary()
		setTimeout(() => { if (currentStage === 1 && App.inWorkspace()) renderCalibrationStage() }, 200)
		return
	}

	calibration_canvas.width = calibrationImage.naturalWidth
	calibration_canvas.height = calibrationImage.naturalHeight
	setupCalibrationCanvas()
	redrawCalibrationCanvas()

	// manual line drawing works immediately; the automatic fit needs OpenCV.js, which loads async
	if (!cvReady) {
		setTimeout(() => { if (currentStage === 1 && App.inWorkspace()) renderCalibrationStage() }, 500)
		return
	}

	if (autoCalState === 'idle') {
		autoCalState = 'running'
		redrawCalibrationCanvas()
		setTimeout(runAutoCalibration, 50)
	}
}

/** Live run: fit the camera, read the cubes from the lines, solve lattice and camera, pick the cells (see js/CalibrationTools.js). Every step redraws. */
async function runAutoCalibration() {
	let token = ++autoCalToken
	let alive = () => token === autoCalToken
	autoCal = null; autoCubes = null; autoLive = null; autoMask = null; autoLines = null; probe = null
	let fov = App.debug ? parseFloat(calibration_fov.value) : NaN
	await setPhase('mask')
	if (!alive()) return
	let an = amethystAnalysis(calibrationImage, { maxW: 800, nPix: 1500 })
	autoMask = maskToCanvas(an)
	await setPhase('lines')
	if (!alive()) return
	let ex = extractMaskLines(calibrationImage, an) // rough position, from the purple mask...
	await setPhase('refine')
	if (!alive()) return
	ex.segs = refineLinesRGB(calibrationImage, an, ex.segs) // ...exact position, from the original colour photo
	// a mask line with no colour step under it is a chord across a concavity between touching cubes, not a real edge: drop it
	ex.rejected = ex.rejected.concat(ex.segs.filter((s) => !s.refined))
	ex.segs = ex.segs.filter((s) => s.refined)
	autoLines = { segs: ex.segs, rejected: ex.rejected, w: an.w, h: an.h, shown: 0 }
	redrawCalibrationCanvas()
	for (let i = 0; i < autoLines.segs.length; i++) { // one line at a time; with "Rallenta" ticked each stays on screen for a moment
		if (!alive()) return
		autoLines.shown = i + 1
		redrawCalibrationCanvas()
		if (App.debug && calibration_slow.checked) await sleep(250)
		else if (i % 10 === 9) await tick()
	}
	await setPhase('camera')
	if (!alive()) return
	let fovFix = fov > 10 && fov < 170 ? fov : null, cal = null
	let lc = autoLines.segs.length >= 6 ? cameraFromLines(autoLines.segs, an, { fovFix }) : null // the vertical vanishing point gives the pitch for each FOV: no grid over 3 numbers
	if (lc) cal = { pitch: lc.pitch, yaw: lc.yaw, fov: lc.fov, fovFixed: !!fovFix, an }
	else cal = await autoCalibrate(calibrationImage, { fovFix, onStep: (s) => { if (!alive()) return false; autoLive = Object.assign({}, s, { phase: 'camera' }); redrawCalibrationCanvas(); return true } }) // too few lines: the old fit on the mask edges
	if (!alive()) return
	autoCal = cal
	if (cal && autoLines) { classifyLines(autoLines.segs, cal, 3); autoLines.shown = autoLines.segs.length }
	if (!cal) { autoCalState = 'done'; redrawCalibrationCanvas(); return }
	await setPhase('texture')
	if (!alive()) return
	// window.__noTex = true switches the texture off (tests)
	let tex = window.__noTex ? null : await makeTextureContext(calibrationImage)
	if (!alive()) return
	let segs = autoLines ? autoLines.segs : [], lab = labelBlobs(cal.an)
	if (tex) { // the texture of THIS photo, learned from the cubes read directly, used ONLY if verified on this photo (a template that does not match would reject the right cells)
		let first = cubePoses(cal, calibrationImage, cal.an, segs, lab).map((q) => ({ P: q.P, nref: Math.max(q.nLines, 3), z: q.z }))
		if (first.length) learnTexture(tex, cal, first)
		let q = first.length ? templateQuality(tex, cal, first) : null
		if (q === null || q < 0.5) tex = null
		else tex.quality = q
	}
	await setPhase('lattice')
	if (!alive()) return
	let lattice = solveLattice(cal, calibrationImage, cal.an, segs, lab, { fovFixed: cal.fovFixed })
	if (!lattice) { autoCubes = null; autoLive = null; autoCalState = 'done'; redrawCalibrationCanvas(); return } // fewer than 2 cubes readable: nothing to anchor the lattice on
	await setPhase('cells')
	if (!alive()) return
	let result
	try {
		result = await finishLattice(lattice, cal.an, tex, lattice.allSegs, {
			fovFixed: cal.fovFixed,
			onStep: (s) => { if (!alive()) return false; autoCubes = s; autoLive = s; redrawCalibrationCanvas(); return true },
		})
	} catch (e) {
		if (e === AUTOCAL_CANCELLED) return
		throw e
	}
	if (!alive()) return
	if (!tex && !window.__noTex) { // too few sure cubes to learn the texture at the start: learn it from the cells found (the wrong ones disagree with the others) and use it to filter them
		let late = await makeTextureContext(calibrationImage), geo = Object.assign({}, cal, { pitch: result.pitch, yaw: result.yaw, fov: result.fov }), ps = result.cubesRay.map((c) => ({ P: c.P, nref: 9, z: c.P[2] }))
		if (late && ps.length) {
			learnTexture(late, geo, ps)
			let q = templateQuality(late, geo, ps)
			if (q !== null && q >= 0.5) { late.quality = q; result = chooseCells(result, cal.an, late) }
		}
		if (!alive()) return
	}
	result.cubes = result.cubesRay
	result.score = result.cubesRay.score
	if (autoTruth) result.truthScore = scoreAgainstTruth(result, autoTruth)
	autoCubes = result; autoLive = null
	autoCalState = 'done'
	redrawCalibrationCanvas()
	usePhotoVein(true)
}

/**
 * Manual corrections of the automatic cubes, per photo, kept in this browser (localStorage): [{P, add}], P = camera-space centre
 * of the cell (blocks), add = true to add a cube the automatic choice missed, false to remove one it took. Stored by position, not by
 * cell index, so they survive a change of the lattice origin: each edit applies to the cell whose centre is within 0.3 of P.
 */
let manualEdits = [], manualEditsPhoto = null
// a saved geode keeps its edits in its own record (App.editsFor/saveEdits, autosaved); the built-in photos keep them in localStorage
function loadManualEdits(photo) {
	manualEditsPhoto = photo
	let own = App.editsFor(photo)
	if (own) { manualEdits = own; return }
	try { manualEdits = JSON.parse(localStorage.getItem('autominer.edits.' + photo) || '[]') } catch (e) { manualEdits = [] }
}
function saveManualEdits() {
	if (App.saveEdits(manualEditsPhoto, manualEdits)) return
	try { localStorage.setItem('autominer.edits.' + manualEditsPhoto, JSON.stringify(manualEdits)) } catch (e) {}
}

/** The lattice cell (i, j, k) whose centre is P (within 0.3 blocks), or null */
function cellAt(A, P) {
	let d = [P[0] - A.origin[0], P[1] - A.origin[1], P[2] - A.origin[2]], f = [A.ax.ex, A.ax.ey, A.ax.ez].map((e) => d[0] * e[0] + d[1] * e[1] + d[2] * e[2]), c = f.map(Math.round)
	return Math.hypot(f[0] - c[0], f[1] - c[1], f[2] - c[2]) < 0.3 ? c : null
}

/** The cubes after the manual corrections: {cubes, removed} (removed = automatic cubes the user took out; added ones have manual: true) */
function finalCubes() {
	if (!autoCubes) return { cubes: [], removed: [] }
	let key = (i, j, k) => i + ',' + j + ',' + k, out = new Map(autoCubes.cubes.map((c) => [key(c.i, c.j, c.k), c])), removed = []
	for (let e of manualEdits) {
		let c = cellAt(autoCubes, e.P)
		if (!c) continue
		let k = key(...c)
		if (e.add && !out.has(k)) out.set(k, { i: c[0], j: c[1], k: c[2], P: latticePoint(autoCubes, ...c), manual: true })
		if (!e.add && out.has(k)) { removed.push(out.get(k)); out.delete(k) }
	}
	return { cubes: [...out.values()], removed }
}

/** Puts the probe cell in the result or takes it out (key x): the manual choice overrides the automatic one */
function toggleProbeCube() {
	if (!probe || !probe.info || !autoCubes) return
	let I = probe.info, same = (c) => c && c[0] === I.i && c[1] === I.j && c[2] === I.k
	let wasIn = finalCubes().cubes.some((q) => same([q.i, q.j, q.k])), inAuto = autoCubes.cubes.some((q) => same([q.i, q.j, q.k]))
	manualEdits = manualEdits.filter((e) => !same(cellAt(autoCubes, e.P))) // back to the automatic state of this cell...
	if (inAuto === wasIn) manualEdits.push({ P: latticePoint(autoCubes, I.i, I.j, I.k), add: !wasIn }) // ...then flipped, if that does not flip it already
	saveManualEdits()
	redrawCalibrationCanvas()
	usePhotoVein()
}

function clearManualEdits() { manualEdits = []; saveManualEdits(); redrawCalibrationCanvas(); usePhotoVein() }

/**
 * Stages 2-7 work on the cubes of the photo shown in stage 1 (after the manual corrections) instead of a random vein. The lattice
 * axes are a mirror image of Minecraft's (cameraAxes: right x down = -forward, determinant -1), so x is flipped to keep the geode's
 * handedness; j is up. The random vein ('r' or the generate button) still works and stays until the next photo result.
 */
function usePhotoVein(fromScan) {
	let { cubes } = finalCubes()
	if (!cubes.length) return
	const M = 2 // empty cells around it, as the random vein has
	let lo = [0, 1, 2].map((a) => Math.min(...cubes.map((c) => [c.i, c.j, c.k][a]))), hi = [0, 1, 2].map((a) => Math.max(...cubes.map((c) => [c.i, c.j, c.k][a])))
	let ores = cubes.map((c) => [hi[0] - c.i + M, c.j - lo[1] + M, c.k - lo[2] + M])
	let parsed = veinFromExport({ seed: 1, size: [0, 1, 2].map((a) => hi[a] - lo[a] + 1 + 2 * M), ores })
	processVein(parsed.vein, parsed.seed)
	pipeline.source = manualEditsPhoto
	pipeline.photoMap = { lo, hi, M, origin: autoCubes.origin.slice(), ax: autoCubes.ax, fov: autoCubes.fov } // for photoCameraPose()
	addDebugInfo()
	App.onPhotoVein(manualEditsPhoto, cubes.length, fromScan)
	if (currentStage !== 1) renderStage(currentStage)
}

/**
 * The 3D camera that sees the geode exactly as the stage-1 photo shows it on screen right now, so going from step 1 to 2
 * swaps the photo for the 3D blocks without anything visibly moving. Must be called while the photo is still shown
 * (it reads where the canvas sits, zoom included). Returns null when the vein shown isn't this photo's.
 *
 * Camera space is the calibration's: x right, y down, z forward, 1 unit = 1 block. A display cell at world w (three.js,
 * geode centered at the origin, see renderStage's `center`) is lattice cell (i, j, k) = (hi0 + M - x, y + lo1 - M,
 * z + lo2 - M) with x/y/z = w + (size - 1) / 2 (see usePhotoVein), so camera point = R w + P0, R's columns being
 * (-ex, ey, ez) - a proper rotation, the x flip undoing the lattice's mirror image.
 * Returns { position, right, up, back, target } (world THREE.Vector3s), focal (screen px) and the principal point (screen px).
 */
function photoCameraPose() {
	let pm = pipeline && pipeline.photoMap
	if (!pm || !autoCubes || pipeline.source !== manualEditsPhoto || calibration_view.style.display === 'none') return null
	let rect = calibration_canvas.getBoundingClientRect()
	if (!rect.width || !rect.height) return null
	let { ex, ey, ez } = pm.ax, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
	let C = [0, 1, 2].map((a) => (pm.hi[a] - pm.lo[a] + 2 * pm.M) / 2) // (size - 1) / 2
	let ci = pm.hi[0] + pm.M - C[0], cj = C[1] + pm.lo[1] - pm.M, ck = C[2] + pm.lo[2] - pm.M
	let P0 = [0, 1, 2].map((a) => pm.origin[a] + ci * ex[a] + cj * ey[a] + ck * ez[a]) // camera-space point of the world origin
	// rows of R = the camera's own axes (x right, y down, z forward) written in world coordinates
	let row = (b) => new THREE.Vector3(-ex[b], ey[b], ez[b])
	let right = row(0), down = row(1), forward = row(2)
	let position = new THREE.Vector3(dot(ex, P0), -dot(ey, P0), -dot(ez, P0)) // -R^T P0
	let target = position.clone().addScaledVector(forward, P0[2]) // on the optical axis, as deep as the geode's center
	return {
		position, target, right, up: down.clone().negate(), back: forward.clone().negate(),
		focal: (rect.height / 2) / Math.tan(pm.fov * Math.PI / 360),
		px: rect.left + rect.width / 2, py: rect.top + rect.height / 2,
	}
}

/** Purple mask -> canvas (translucent purple where the mask is set), for the overlay tint */
function maskToCanvas(an) {
	let c = document.createElement('canvas')
	c.width = an.w; c.height = an.h
	let ctx = c.getContext('2d'), img = ctx.createImageData(an.w, an.h)
	for (let i = 0; i < an.w * an.h; i++) if (an.data[i]) { img.data[i * 4] = 255; img.data[i * 4 + 1] = 0; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 110 }
	ctx.putImageData(img, 0, 0)
	return c
}

/** The 12 edges of a cube as pairs of cubeCorners() indices */
const CUBE_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]

/**
 * The visible parts of the 12 edges of every cube (cube centres Ps in camera space), as 3D segments per cube.
 * A point X of an edge is visible when the camera ray to it does not pass through the inside of any cube before reaching X
 * (slab test on each box along the lattice axes). The cube itself is tested too: that hides its own back edges, while
 * front and outline edges only touch its surface. So the hidden edges are exact for every cube (also the bottom face of
 * the cubes above the camera), and edges behind nearer cubes are cut where they disappear. Sampled every ~3 px on screen.
 */
function visibleCubeEdges(Ps, ax, f, cx, cy) {
	const E = [ax.ex, ax.ey, ax.ez], EPS = 1e-6
	let boxes = Ps.map((P) => {
		let C = cubeCorners(P, ax), xs = [], ys = [], zMin = Infinity
		for (let q of C) { if (q[2] > 0.05) { xs.push(cx + f * q[0] / q[2]); ys.push(cy + f * q[1] / q[2]) } zMin = Math.min(zMin, q[2]) }
		let all = xs.length === 8 // a box crossing the camera plane: no screen box, always tested
		return { P, C, zMin, x0: all ? Math.min(...xs) : -Infinity, x1: all ? Math.max(...xs) : Infinity, y0: all ? Math.min(...ys) : -Infinity, y1: all ? Math.max(...ys) : Infinity, c: E.map((e) => P[0] * e[0] + P[1] * e[1] + P[2] * e[2]) }
	})
	const hidden = (X, sx, sy) => { // ray o = 0, d = X: t = 1 reaches X
		let dx = E.map((e) => X[0] * e[0] + X[1] * e[1] + X[2] * e[2])
		for (let b of boxes) {
			if (b.zMin >= X[2] || sx < b.x0 || sx > b.x1 || sy < b.y0 || sy > b.y1) continue
			let tIn = -Infinity, tOut = Infinity
			for (let a = 0; a < 3; a++) {
				if (Math.abs(dx[a]) < 1e-12) { if (Math.abs(b.c[a]) > 0.5) { tIn = Infinity; break } continue }
				let t1 = (b.c[a] - 0.5) / dx[a], t2 = (b.c[a] + 0.5) / dx[a]
				tIn = Math.max(tIn, Math.min(t1, t2)); tOut = Math.min(tOut, Math.max(t1, t2))
			}
			if (tOut - tIn > EPS && tIn < 1 - EPS) return true // the ray goes through this box's inside before reaching X
		}
		return false
	}
	return boxes.map((b) => {
		let out = []
		for (let [i, j] of CUBE_EDGES) {
			let A = b.C[i], B = b.C[j]
			if (A[2] < 0.3 && B[2] < 0.3) continue
			let pa = projectCam(A, f, cx, cy), pb = projectCam(B, f, cx, cy), n = Math.max(2, Math.min(200, Math.ceil(Math.hypot(pb.x - pa.x, pb.y - pa.y) / 3)))
			let start = -1
			for (let s = 0; s <= n; s++) {
				let vis = false
				if (s < n) {
					let t = (s + 0.5) / n, X = [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1]), A[2] + t * (B[2] - A[2])]
					vis = X[2] > 0.3 && !hidden(X, cx + f * X[0] / X[2], cy + f * X[1] / X[2])
				}
				if (vis && start < 0) start = s
				if (!vis && start >= 0) { let t0 = start / n, t1 = s / n; out.push([A.map((v, k) => v + t0 * (B[k] - v)), A.map((v, k) => v + t1 * (B[k] - v))]); start = -1 }
			}
		}
		return out
	})
}

/** Draws a 3D segment (camera-space endpoints A, B), clipped to the near plane, as a 2D line */
function drawSeg3D(ctx, A, B, f, cx, cy) {
	const NEAR = 0.3
	if (A[2] < NEAR && B[2] < NEAR) return
	if (A[2] < NEAR) { let t = (NEAR - A[2]) / (B[2] - A[2]); A = A.map((v, i) => v + t * (B[i] - v)) }
	else if (B[2] < NEAR) { let t = (NEAR - B[2]) / (A[2] - B[2]); B = B.map((v, i) => v + t * (A[i] - v)) }
	let a = projectCam(A, f, cx, cy), b = projectCam(B, f, cx, cy)
	ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
}

/** Overlays the 3D lattice (floor grid under the detected cubes) and the detected cubes as wireframes, both from the automatic camera fit */
function drawAutoOverlay(ctx, canvas) {
	if (autoMask && (autoCalState === 'running' || overlayOn(calibration_show_mask, false))) ctx.drawImage(autoMask, 0, 0, canvas.width, canvas.height)
	if (autoLines && (autoCalState === 'running' || overlayOn(calibration_show_lines, false))) {
		let sx = canvas.width / autoLines.w, sy = canvas.height / autoLines.h, AXIS_COL = ['#ff5050', '#50ff50', '#5aa0ff']
		ctx.lineWidth = 3
		for (let i = 0; i < autoLines.shown; i++) {
			let L = autoLines.segs[i]
			ctx.strokeStyle = L.axis === undefined ? '#ffffff' : L.axis < 0 ? 'rgba(160,160,160,0.8)' : AXIS_COL[L.axis]
			ctx.beginPath(); ctx.moveTo(L.x1 * sx, L.y1 * sy); ctx.lineTo(L.x2 * sx, L.y2 * sy); ctx.stroke()
		}
	}
	if (!autoCubes || !autoCubes.cubes.length) return
	let f = focalPx(autoCubes.fov, canvas.height), cx = canvas.width / 2, cy = canvas.height / 2
	let ax = autoCubes.ax, at = (i, j, k) => latticePoint(autoCubes, i, j, k)
	let { cubes, removed } = finalCubes() // the automatic choice with the manual corrections
	let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
	for (let c of cubes) { let v = [c.i, c.j, c.k]; for (let n = 0; n < 3; n++) { lo[n] = Math.min(lo[n], v[n]); hi[n] = Math.max(hi[n], v[n]) } }

	if (overlayOn(calibration_show_diff, false) && autoCal && autoCal.an) {
		// where the union of the detected cubes disagrees with the purple mask (mask resolution, drawn scaled up): red = covered but not purple, blue = purple but not covered
		let an = autoCal.an, fm = focalPx(autoCubes.fov, an.h), cov = new Uint8Array(an.w * an.h)
		for (let c of cubes) {
			let hl = cubeHull(at(c.i, c.j, c.k), ax, fm, an.w / 2, an.h / 2)
			if (hl) forEachPixelInHull(hl, an.w, an.h, (x, y) => { cov[y * an.w + x] = 1 })
		}
		let dc = document.createElement('canvas'); dc.width = an.w; dc.height = an.h
		let dctx = dc.getContext('2d'), di = dctx.createImageData(an.w, an.h)
		for (let i = 0; i < an.w * an.h; i++) {
			if (an.data[i] && !cov[i]) { di.data[i * 4] = 0; di.data[i * 4 + 1] = 140; di.data[i * 4 + 2] = 255; di.data[i * 4 + 3] = 200 }
			else if (cov[i] && !an.data[i]) { di.data[i * 4] = 255; di.data[i * 4 + 1] = 30; di.data[i * 4 + 2] = 30; di.data[i * 4 + 3] = 200 }
		}
		dctx.putImageData(di, 0, 0)
		ctx.imageSmoothingEnabled = false
		ctx.drawImage(dc, 0, 0, canvas.width, canvas.height)
		ctx.imageSmoothingEnabled = true
	}

	if (overlayOn(calibration_show_grid, true)) {
		ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.45)'
		let y = lo[1] - 0.5
		for (let i = lo[0] - 0.5; i <= hi[0] + 0.51; i++) drawSeg3D(ctx, at(i, y, lo[2] - 0.5), at(i, y, hi[2] + 0.5), f, cx, cy)
		for (let k = lo[2] - 0.5; k <= hi[2] + 0.51; k++) drawSeg3D(ctx, at(lo[0] - 0.5, y, k), at(hi[0] + 0.5, y, k), f, cx, cy)
	}
	if (overlayOn(calibration_show_cubes, true)) {
		ctx.lineWidth = 2
		let runs = visibleCubeEdges(cubes.map((c) => at(c.i, c.j, c.k)), ax, f, cx, cy)
		cubes.forEach((c, n) => {
			let t = hi[1] > lo[1] ? (c.j - lo[1]) / (hi[1] - lo[1]) : 0 // colour by height: low = yellow, high = orange/red; added by hand = cyan
			ctx.strokeStyle = c.manual ? '#22d3ee' : 'hsl(' + Math.round(55 - 55 * t) + ',100%,55%)'
			for (let [A, B] of runs[n]) drawSeg3D(ctx, A, B, f, cx, cy)
		})
		ctx.save(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([4, 4]) // taken out by hand: thin dashed, all 12 edges
		for (let c of removed) { let C = cubeCorners(c.P, ax); for (let [a, b] of CUBE_EDGES) drawSeg3D(ctx, C[a], C[b], f, cx, cy) }
		ctx.restore()
		if (overlayOn(calibration_show_labels, false)) {
			ctx.font = '12px sans-serif'; ctx.fillStyle = 'white'; ctx.strokeStyle = 'black'; ctx.lineWidth = 3
			for (let c of cubes) {
				let p = projectCam(at(c.i, c.j, c.k), f, cx, cy), txt = c.i + ',' + c.j + ',' + c.k
				ctx.strokeText(txt, p.x - 14, p.y + 4); ctx.fillText(txt, p.x - 14, p.y + 4)
			}
		}
	}
	if (probe && probe.info) drawProbe(ctx, canvas, at, f, cx, cy, ax)
}

/** The probe cube: its silhouette split into free+purple (green), free but not purple (red) and covered by nearer cubes (grey), and its 12 edges (the 3 hidden ones dashed) */
function drawProbe(ctx, canvas, at, f, cx, cy, ax) {
	let I = probe.info, an = autoCal.an
	if (App.debug && !probe.tint) {
		let tc = document.createElement('canvas'); tc.width = an.w; tc.height = an.h
		let tctx = tc.getContext('2d'), img = tctx.createImageData(an.w, an.h)
		const paint = (list, r, g, b, a) => { for (let q of list) { img.data[q * 4] = r; img.data[q * 4 + 1] = g; img.data[q * 4 + 2] = b; img.data[q * 4 + 3] = a } }
		paint(I.pix.free, 40, 255, 120, 110); paint(I.pix.freeNotPurple, 255, 40, 40, 170); paint(I.pix.covered, 150, 150, 150, 150)
		tctx.putImageData(img, 0, 0)
		probe.tint = tc
	}
	if (App.debug) { // the silhouette tint is a diagnostic: end users only see the cube outline
		ctx.imageSmoothingEnabled = false
		ctx.drawImage(probe.tint, 0, 0, canvas.width, canvas.height)
		ctx.imageSmoothingEnabled = true
	}
	let P = at(I.i, I.j, I.k), C = cubeCorners(P, ax)
	ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = I.taken ? '#22ff88' : '#ff4d4d'
	ctx.setLineDash([6, 5]); for (let [a, b] of CUBE_EDGES) drawSeg3D(ctx, C[a], C[b], f, cx, cy) // all 12 dashed (the hidden ones stay dashed)...
	ctx.setLineDash([]); for (let [A, B] of visibleCubeEdges([P], ax, f, cx, cy)[0]) drawSeg3D(ctx, A, B, f, cx, cy) // ...the visible ones solid on top
	ctx.restore()
}

/** Lattice cells under the mouse (canvas px), nearest first */
function probeRayCells(mx, my) {
	let canvas = calibration_canvas, fc = focalPx(autoCubes.fov, canvas.height)
	return latticeRayCells(autoCubes, [(mx - canvas.width / 2) / fc, (my - canvas.height / 2) / fc, 1], 0.8, 80)
}

/** Puts the probe on the ray through (mx, my), on the cell whose depth is nearest to zWanted */
function placeProbe(mx, my, zWanted) {
	let cells = probeRayCells(mx, my), idx = 0
	for (let n = 1; n < cells.length; n++) if (Math.abs(cells[n].z - zWanted) < Math.abs(cells[idx].z - zWanted)) idx = n
	probe = Object.assign(probe || { frozen: false }, { mx, my, cells, idx })
	updateProbeInfo()
}

/** Explains the cell under the probe with the same rule and options that chose the cubes */
function updateProbeInfo() {
	let c = probe.cells[probe.idx]
	if (probe.info && probe.info.i === c.i && probe.info.j === c.j && probe.info.k === c.k) return
	if (!autoCubes.record) { // replay the final choice once, recording which cube took each pixel
		let rec = {}
		selectCellsByRay(autoCubes, autoCal.an, Object.assign({}, autoCubes.selOpts || {}, { record: rec }))
		autoCubes.record = rec
	}
	probe.info = explainCell(autoCubes, autoCal.an, autoCubes.record, c.i, c.j, c.k)
	probe.tint = null
}

/** Copies the probe cell and everything the cell rule saw on it, as text to paste to Claude: enough to recompute that exact cell (photo, camera, lattice origin) */
function copyProbe() {
	if (!probe || !probe.info || !autoCubes) return
	let I = probe.info, A = autoCubes, r = (x, d) => +x.toFixed(d)
	let L = [
		'autominer probe cube — photo ' + calibration_photo.value + ', cell (' + I.i + ', ' + I.j + ', ' + I.k + '), distance ' + r(I.z, 2),
		'outcome: ' + (I.taken ? 'taken' : 'rejected (' + I.reason + ')') + '; among the cubes found: ' + (A.cubes.some((q) => q.i === I.i && q.j === I.j && q.k === I.k) ? 'yes' : 'no'),
		...I.checks.map((q) => (q.ok ? '  OK ' : '  NO ') + q.name + ': ' + q.value + ' (needs ' + q.need + ')'),
		'covered by: ' + (I.coveredBy.length ? I.coveredBy.map((q) => '(' + q.key + ') ' + q.n + ' px').join(', ') : 'none'),
		'silhouette px: free purple ' + I.pix.free.length + ', free not purple ' + I.pix.freeNotPurple.length + ', covered ' + I.pix.covered.length,
		'camera: pitch ' + r(A.pitch, 3) + ', yaw ' + r(A.yaw, 3) + ', fov ' + r(A.fov, 3) + ', origin [' + A.origin.map((x) => r(x, 4)).join(', ') + ']; texture threshold ' + (A.selOpts && A.selOpts.minNcc !== undefined ? r(A.selOpts.minNcc, 3) : '-') + '; cubes found ' + A.cubes.length + (A.truthScore ? '; synthetic scene: found ' + Math.round(100 * A.truthScore.recall) + '%, right ' + Math.round(100 * A.truthScore.precision) + '%' : ''),
	]
	let tx = A.selOpts && A.selOpts.tex, texWhat = !tx ? 'none' : tx.learned === -1 ? 'from the previous photo' : tx.learned ? 'learned from this photo (' + tx.learned + ' faces)' : 'the project one'
	L.push('diagnostics: lines ' + autoLines.segs.length + ', mask pixels ' + autoCal.an.data.reduce((s, x) => s + x, 0) + ', camera of step 4 [' + [autoCal.pitch, autoCal.yaw, autoCal.fov].map((x) => r(x, 3)).join(', ') + '], texture ' + texWhat + ', browser ' + ((navigator.userAgent.match(new RegExp('(Chrome|Firefox|Edg|Safari)/[0-9.]+')) || ['?'])[0]))
	let rb = canvasReadbackCheck(calibrationImage)
	L.push('pixel readback: ' + (rb.altered ? 'ALTERED (' + rb.altered + ' px of 4096 in the test pattern)' : 'exact') + ', photo fingerprint ' + rb.photo)
	L.push('manual edits on this photo: ' + manualEdits.length + '; this cell: ' + manualStateText(I))
	copyText(L.join(String.fromCharCode(10)), 'Cell (' + I.i + ', ' + I.j + ', ' + I.k + ') copied to the clipboard')
}

/** Copies text to the clipboard: the clipboard API, else the old textarea route (file://, permissions), else the console */
function copyText(text, doneMsg, onFail) {
	navigator.clipboard.writeText(text).then(() => flashStageMessage(doneMsg)).catch(() => {
		let ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select()
		let ok = false; try { ok = document.execCommand('copy') } catch (e) {}
		ta.remove()
		if (ok) flashStageMessage(doneMsg)
		else if (onFail) onFail()
		else { flashStageMessage('Copy failed: the text is in the console (F12)'); console.log(text) }
	})
}

/** Whether the probe cell is in the final result, and whether by the automatic choice or by hand */
function manualStateText(I) {
	let inFinal = finalCubes().cubes.some((q) => q.i === I.i && q.j === I.j && q.k === I.k), inAuto = autoCubes.cubes.some((q) => q.i === I.i && q.j === I.j && q.k === I.k)
	return inFinal === inAuto ? (inFinal ? 'in the result (automatic choice)' : 'not in the result (automatic choice)') : inFinal ? 'ADDED by hand' : 'REMOVED by hand'
}

/** The probe part of the stats panel */
function probeHtml() {
	if (autoCalState !== 'done' || !autoCubes) return ''
	let html = '<br><br><b style="color:#22ff88">Probe cube</b>: '
	if (!probe) return html + 'click the photo to place it<br><span style=\"color:#aaa\">without a probe cube: wheel = zoom, drag = pan, 0 = whole view</span>'
	let I = probe.info, inRes = autoCubes.cubes.some((q) => q.i === I.i && q.j === I.j && q.k === I.k)
	html += 'cell (' + I.i + ', ' + I.j + ', ' + I.k + '), ' + I.z.toFixed(1) + ' blocks from the camera' + (probe.frozen ? ' <i>(frozen: click to release)</i>' : '')
	html += '<br><span style="color:#aaa">wheel up = farther, down = nearer; click = freeze/release; Esc = remove</span>'
	html += '<br><button onclick="toggleProbeCube()" style="margin-top:4px;">Add / remove this cube (x key)</button> <button onclick="copyProbe()" style="margin-top:4px;">Copy for Claude (c key)</button>'
	html += '<br>Decision: <b>' + manualStateText(I) + '</b>'
	html += '<br><b style="color:' + (I.taken ? '#4ade80' : '#f87171') + '">' + (I.taken ? 'WOULD BE TAKEN' : 'REJECTED: ' + I.reason) + '</b>' + (inRes ? ' (it is among the cubes found)' : '')
	if (inRes !== I.taken) html += '<br><span style="color:#facc15">warning: the replay does not match the result shown</span>'
	for (let q of I.checks) html += '<div style="margin-top:3px;"><b style="color:' + (q.ok ? '#4ade80' : '#f87171') + '">' + (q.ok ? '✓' : '✗') + '</b> ' + q.name + ': <b>' + q.value + '</b> <span style="color:#aaa">(needs ' + q.need + ')</span></div>'
	if (I.coveredBy.length) html += '<div style="margin-top:3px;">Covered by: ' + I.coveredBy.slice(0, 6).map((q) => '(' + q.key + ') ' + q.n + ' px').join(', ') + (I.coveredBy.length > 6 ? '…' : '') + '</div>'
	html += '<br><span style="color:#aaa">Silhouette: green = free and purple, red = free but not purple, grey = covered by nearer cubes. Cubes are chosen nearest first; px = mask pixels (' + autoCal.an.w + ' px wide).</span>'
	return html
}

/** Redraws the photo + the automatic overlay and refreshes the stats panel */
function redrawCalibrationCanvas() {
	let canvas = calibration_canvas
	let ctx = canvas.getContext('2d')
	ctx.clearRect(0, 0, canvas.width, canvas.height)
	ctx.drawImage(calibrationImage, 0, 0)
	drawAutoOverlay(ctx, canvas)

	updateCalibrationStats()
}

function updateCalibrationStats() {
	let html = ''
	// the steps in the order they run
	const PHASES = { mask: 'purple mask', lines: 'lines from the mask outlines', refine: 'line refinement on the colour photo', camera: 'camera from the lines', texture: 'photo texture from the sure cubes', lattice: 'cubes and lattice from the lines', cells: 'cell choice' }
	const ORDER = ['mask', 'lines', 'refine', 'camera', 'texture', 'lattice', 'cells']
	let cam = autoLive && autoLive.pitch !== undefined ? autoLive : autoCal
	if (autoCalState === 'running' && autoLive) {
		let n = ORDER.indexOf(autoLive.phase)
		html += '<br><br><b style="color:#facc15">Running: ' + (n >= 0 ? (n + 1) + '/' + ORDER.length + ' ' : '') + (PHASES[autoLive.phase] || autoLive.phase) + '</b>'
	}
	if (autoCalState === 'done' && calibrationImage && calibrationImage.naturalWidth) {
		if (!calibrationImage.readback) calibrationImage.readback = canvasReadbackCheck(calibrationImage)
		let rb = calibrationImage.readback
		html += '<br><span style=\"color:' + (rb.altered ? '#f87171' : '#888') + '\">Pixel readback: ' + (rb.altered ? '<b>ALTERED</b> by the browser (' + rb.altered + ' px of 4096 in the test pattern): extensions or anti-tracking protection falsify the results' : 'exact') + ' · photo fingerprint ' + rb.photo + '</span>'
	}
	if (cam) html += '<br>' + (autoCalState === 'running' ? '' : '<br>') + '<b style="color:#facc15">Auto:</b> pitch ' + cam.pitch.toFixed(1) + '&deg; down, yaw ' + cam.yaw.toFixed(1) + '&deg;, FOV vert ' + cam.fov.toFixed(1) + '&deg;'
	if (autoLines) {
		let n = autoLines.segs.length, ok = autoLines.segs.filter((L) => L.axis >= 0), tot = autoLines.segs.reduce((a, L) => a + L.len, 0)
		html += '<br>Outline lines: <b>' + n + '</b>' + (autoLines.segs[0] && autoLines.segs[0].axis !== undefined ? ', ' + ok.length + ' agree with the estimated camera (' + (100 * ok.reduce((a, L) => a + L.len, 0) / Math.max(1, tot)).toFixed(0) + '% of the length; red/green/blue = X/Y/Z axis, grey = none)' : '')
	}
	if (autoTruth) html += '<br><br><b style="color:#60a5fa">Synthetic scene</b>: ' + autoTruth.cubes.length + ' true cubes, pitch ' + autoTruth.pitch.toFixed(1) + '&deg;, yaw ' + autoTruth.yaw.toFixed(1) + '&deg;, FOV ' + autoTruth.fov.toFixed(1) + '&deg;'
	if (autoCubes && autoCubes.truthScore) {
		let t = autoCubes.truthScore, good = t.recall >= 0.95 && t.precision >= 0.95
		html += '<br><b style="color:' + (good ? '#4ade80' : '#f87171') + '">Found ' + Math.round(t.recall * 100) + '% of the true cubes, ' + Math.round(t.precision * 100) + '% of those found are right</b><br>Camera error: FOV ' + t.dFov.toFixed(2) + '&deg;, pitch ' + t.dPitch.toFixed(2) + '&deg;, yaw ' + t.dYaw.toFixed(2) + '&deg;'
	}
	if (autoCubes) {
		html += '<br><b>' + autoCubes.cubes.length + ' cubes</b> snapped to the lattice' + (autoCubes.score !== undefined ? ' (score ' + Math.round(autoCubes.score) + ')' : '') + (autoCubes.refIoU ? ', reference cube IoU ' + autoCubes.refIoU.toFixed(2) : '') + ' - coordinates relative to the reference (0,0,0)'
		if (autoCalState === 'done') {
			let fc = finalCubes(), added = fc.cubes.filter((c) => c.manual).length
			html += '<br>Manual edits: <b>+' + added + ' / -' + fc.removed.length + '</b> &rarr; <b>' + fc.cubes.length + ' cubes</b> used by stages 2-7 (cyan = added, dashed = removed)'
			if (added || fc.removed.length) html += ' <button onclick="clearManualEdits()">Undo edits</button>'
		}
	} else if (autoCalState === 'done') html += '<br><span style="color:#f87171">fewer than 2 cubes readable from the lines: nothing to anchor the lattice to (or too little purple)</span>'
	html += probeHtml()
	calibration_stats.innerHTML = html
	updateScanSummary()
}

/** The end-user view of stage 1, in the step card: progress while the scan runs, then the result and the block picker (the full diagnostics stay in the debug panel) */
function updateScanSummary() {
	let el = document.getElementById('scan_status')
	if (!el) return
	const ORDER = ['mask', 'lines', 'refine', 'camera', 'texture', 'lattice', 'cells']
	const LABEL = { mask: 'Finding the purple blocks', lines: 'Tracing their edges', refine: 'Sharpening the edges', camera: 'Working out where the camera was', texture: 'Learning the block texture', lattice: 'Placing the blocks in 3D', cells: 'Choosing the blocks' }
	const busy = (text, n) => '<div class="busy"><span class="spin"></span>' + text + (n ? ' <span class="muted">' + n + '/' + ORDER.length + '</span>' : '') + '</div>' +
		(n ? '<div class="meter"><i style="width:' + Math.round(100 * n / ORDER.length) + '%"></i></div>' : '')
	let html
	if (!calibrationImage.naturalWidth) html = busy('Loading the screenshot…')
	else if (!cvReady) html = busy('Loading the image analyser (a few MB, first time only)…')
	else if (autoCalState !== 'done') {
		let n = autoLive ? ORDER.indexOf(autoLive.phase) : -1
		html = busy(n >= 0 ? LABEL[ORDER[n]] + '…' : 'Starting the scan…', n >= 0 ? n + 1 : 0)
	} else if (!autoCubes || !autoCubes.cubes.length) {
		html = '<div class="bad"><b>No geode found in this screenshot.</b></div><div class="muted">Try one taken a bit closer, with the purple blocks well lit and nothing in front of them.</div>'
	} else {
		let fc = finalCubes(), added = fc.cubes.filter((c) => c.manual).length
		html = '<div class="ok"><b>' + fc.cubes.length + ' blocks found</b>' + (added || fc.removed.length ? ' <span class="muted">(you added ' + added + ', removed ' + fc.removed.length + ')</span> <button class="link" onclick="clearManualEdits()">Undo my changes</button>' : '') + '</div>'
		if (!probe || !probe.info) html += '<div class="muted">Something wrong? Click the photo to pick a block.</div>'
		else {
			let I = probe.info, inRes = fc.cubes.some((q) => q.i === I.i && q.j === I.j && q.k === I.k)
			html += '<div class="pick"><span>This block is <b>' + (inRes ? 'in your geode' : 'not in your geode') + '</b></span>' +
				'<button onclick="toggleProbeCube()">' + (inRes ? 'Remove it' : 'Add it') + ' <kbd>X</kbd></button></div>' +
				'<div class="muted">Scroll to move nearer or farther · ' + (probe.frozen ? 'click to unlock' : 'click to lock') + ' · <kbd>Esc</kbd> to stop</div>'
		}
	}
	el.innerHTML = html
}

/** Wires up the stage-1 panel controls (photo select, recompute, overlay checkboxes) once */
function setupCalibrationCanvas() {
	if (calibrationListenersBound) return
	calibrationListenersBound = true
	let canvas = calibration_canvas
	for (let el of [calibration_show_grid, calibration_show_cubes, calibration_show_labels, calibration_show_mask, calibration_show_diff, calibration_show_lines]) el.addEventListener('change', redrawCalibrationCanvas)
	calibration_photo.addEventListener('change', () => { loadCalibrationPhoto(calibration_photo.value) })
	calibration_recompute.addEventListener('click', () => { autoCalState = 'idle'; renderCalibrationStage() })
	const mouseAt = (e) => { let r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height] }
	let pending = false
	const redrawSoon = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; redrawCalibrationCanvas() }) }
	canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { photoZoom.down = { x: e.clientX, y: e.clientY, tx: photoZoom.tx, ty: photoZoom.ty }; photoZoom.dragged = false } })
	window.addEventListener('mousemove', (e) => { // drag = pan, only when zoomed in
		let d = photoZoom.down
		if (!d || photoZoom.s === 1) return
		if (!photoZoom.dragged && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return
		photoZoom.dragged = true
		photoZoom.tx = d.tx + e.clientX - d.x; photoZoom.ty = d.ty + e.clientY - d.y
		applyPhotoZoom()
	})
	window.addEventListener('mouseup', () => { photoZoom.down = null })
	canvas.addEventListener('click', (e) => {
		if (photoZoom.dragged) { photoZoom.dragged = false; return } // the end of a pan, not a click
		if (autoCalState !== 'done' || !autoCubes || !autoCubes.cubes.length) return
		let [mx, my] = mouseAt(e)
		if (!probe) { let zs = autoCubes.cubes.map((c) => c.P[2]).sort((a, b) => a - b); placeProbe(mx, my, zs[zs.length >> 1]) } // first click: at the median depth of the cubes found
		else if (probe.frozen) { probe.frozen = false; placeProbe(mx, my, probe.cells[probe.idx].z) }
		else probe.frozen = true
		redrawSoon()
	})
	canvas.addEventListener('mousemove', (e) => {
		if (!probe || probe.frozen || !autoCubes || photoZoom.dragged) return
		let [mx, my] = mouseAt(e)
		placeProbe(mx, my, probe.cells[probe.idx].z) // same depth, new ray
		redrawSoon()
	})
	canvas.addEventListener('wheel', (e) => {
		if (!probe || !autoCubes) { // no probe cube: the wheel zooms on the point under the mouse
			e.preventDefault()
			let r = calibration_zoom_box.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, s0 = photoZoom.s
			photoZoom.s = Math.max(1, Math.min(12, s0 * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))
			photoZoom.tx = mx - (mx - photoZoom.tx) * photoZoom.s / s0; photoZoom.ty = my - (my - photoZoom.ty) * photoZoom.s / s0
			applyPhotoZoom()
			return
		}
		e.preventDefault()
		probe.idx = Math.max(0, Math.min(probe.cells.length - 1, probe.idx + (e.deltaY < 0 ? 1 : -1))) // wheel up = farther along the ray
		updateProbeInfo()
		redrawSoon()
	}, { passive: false })
}

/** Renders one stage of the pipeline (1-7; stage 1 is the photo/line-detection view, see above) from the already computed snapshots */
function renderStage(stage) {
	if (pipeline === null && stage !== 1) return // stage 1 is the photo itself: it needs no vein yet
	currentStage = stage

	if (stage === 1) {
		renderCalibrationStage()
		return
	}
	calibration_view.style.display = 'none'
	ST.set3DVisible(true)
	ST.clearScene()

	// stages 2-7 are the original pipeline's stages 1-6, shifted by 1 to make room for stage 1
	let pipelineStage = stage - 1

	let display
	if (pipelineStage === 1) {
		display = pipeline.vein.clone()
	} else {
		let snapshots = {}
		for (let axis of ['x','y','z']) {
			snapshots[axis] = pipelineStage === 2 ? pipeline.data_layers[axis].snapshotStretti
				: pipelineStage === 3 ? pipeline.data_layers[axis].snapshotValide
				: pipelineStage === 4 ? pipeline.data_layers[axis].snapshotGruppi
				: pipeline.data_layers[axis].snapshotMateriali // stage 5 and 6 share the materials base
		}
		display = Tools3D.buildDisplay(pipeline.vein, snapshots, settings.gap, settings.invert, settings.show)
	}

	let displaySize = { x: display.maxX(), y: display.maxY(), z: display.maxZ() }
	let originalSize = { x: pipeline.vein.maxX(), y: pipeline.vein.maxY(), z: pipeline.vein.maxZ() }
	// where buildDisplay() put the vein inside the display (inverted axes push it forward by gap+1;
	// stage 2 shows the bare vein, so no shift there)
	let shift = {
		x: pipelineStage > 1 && settings.invert.x ? settings.gap + 1 : 0,
		y: pipelineStage > 1 && settings.invert.y ? settings.gap + 1 : 0,
		z: pipelineStage > 1 && settings.invert.z ? settings.gap + 1 : 0,
	}
	// the geode's own center is drawn at the world origin, so it stays in the same spot on screen
	// whatever step is shown or however gap/invert/show reshape the display around it
	let center = {
		x: shift.x + (originalSize.x - 1) / 2,
		y: shift.y + (originalSize.y - 1) / 2,
		z: shift.z + (originalSize.z - 1) / 2,
	}
	// the debug ortho views still frame the whole display, not just the geode
	ST.setOrthoTarget({ x: (displaySize.x - 1) / 2 - center.x, y: (displaySize.y - 1) / 2 - center.y, z: (displaySize.z - 1) / 2 - center.z })

	// stage 7's machine blocks aren't part of `display` (addMachinesToScene draws them
	// separately), so they're computed up front here: once to feed the layer view's occupied
	// range below, once to actually draw them further down
	let machineBlocksByAxis = null
	if (pipelineStage === 6) {
		machineBlocksByAxis = {}
		for (let axis of ['x','y','z']) {
			if (!settings.show[axis]) continue
			machineBlocksByAxis[axis] = computeMachineBlocks(pipeline.data_layers[axis], axis, originalSize, settings.gap, settings.invert, shift)
		}
	}

	// bounds the layer view to where this stage actually has something to show (first occupied
	// layer to last), instead of the whole mostly-empty display bounding box
	let occupied = ST.occupiedYRange(display) || { min: 0, max: displaySize.y - 1 }
	if (machineBlocksByAxis) {
		for (let axis in machineBlocksByAxis) {
			for (let b of machineBlocksByAxis[axis]) {
				if (b.y < occupied.min) occupied.min = b.y
				if (b.y > occupied.max) occupied.max = b.y
			}
		}
	}
	if (layerView.enabled) {
		layerView.y = layerView.y === null
			? occupied.min
			: Math.max(occupied.min, Math.min(occupied.max, layerView.y))
	}
	let layerY = layerView.enabled ? layerView.y : null

	ST.addMeshToScene(display, layerY, center)

	// layer view: a faint block grid under the current layer, over the display's footprint
	// (grown to fit stage 7's machines, which can stick out of it) plus a 1-block margin
	if (layerY !== null) {
		let ext = { minX: 0, maxX: displaySize.x - 1, minZ: 0, maxZ: displaySize.z - 1 }
		if (machineBlocksByAxis) {
			for (let axis in machineBlocksByAxis) {
				for (let b of machineBlocksByAxis[axis]) {
					ext.minX = Math.min(ext.minX, b.x); ext.maxX = Math.max(ext.maxX, b.x)
					ext.minZ = Math.min(ext.minZ, b.z); ext.maxZ = Math.max(ext.maxZ, b.z)
				}
			}
		}
		ST.addLayerGrid(layerY, center, { minX: ext.minX - 1, maxX: ext.maxX + 1, minZ: ext.minZ - 1, maxZ: ext.maxZ + 1 })
	}

	// group index numbers only make sense once groups exist (pipeline stage 4+); they sit in the per-axis views (debug only)
	if (pipelineStage >= 4 && ST.view.ortho) {
		ST.updateGroupLabels(pipeline.data_layers, center, originalSize, settings.gap, settings.invert, settings.show)
	} else {
		ST.clearGroupLabels()
	}

	// stage 7: one flying machine per final group, pushing into the geode along its axis
	if (machineBlocksByAxis) {
		for (let axis in machineBlocksByAxis) {
			ST.addMachinesToScene(machineBlocksByAxis[axis], center, layerY)
		}
	}

	layerView.min = occupied.min; layerView.max = occupied.max
	let label = 'Stage ' + stage + '/' + LAST_STAGE + ' - ' + STAGE_NAMES[stage] + ' - vein: ' + (pipeline.source ? 'photo ' + pipeline.source : 'random') + ', seed ' + pipeline.seed
	if (layerView.enabled) label += ' | Layer ' + layerView.y + ' [' + occupied.min + '-' + occupied.max + ']'
	stage_info.innerHTML = label
	App.afterRender()
}

/** 0 -> "100% honey", 100 -> "100% slime", in between -> the split, e.g. "70% slime / 30% honey" */
function formatSlimePreference(value) {
	if (value === 100) return '100% slime'
	if (value === 0) return '100% honey'
	return value + '% slime / ' + (100 - value) + '% honey'
}

/**
 * Wires up the settings menu (index.html #settings_menu): sliders for density/range/gap,
 * invert checkboxes, a JSON import textarea, and the Generate button. Density/range only take
 * effect on Generate (regenerating is not cheap enough to do on every slider tick); gap/invert
 * re-render immediately since they're free (no recomputation, just where things are drawn).
 */
function setupSettingsMenu() {
	density_slider.value = settings.density
	density_val.textContent = settings.density.toFixed(2)
	range_slider.value = settings.range
	range_val.textContent = settings.range.toFixed(1)
	gap_slider.value = settings.gap
	gap_val.textContent = settings.gap
	slime_pref_slider.value = settings.slimePreference
	slime_pref_val.textContent = formatSlimePreference(settings.slimePreference)

	density_slider.addEventListener('input', () => {
		settings.density = parseFloat(density_slider.value)
		density_val.textContent = settings.density.toFixed(2)
	})
	range_slider.addEventListener('input', () => {
		settings.range = parseFloat(range_slider.value)
		range_val.textContent = settings.range.toFixed(1)
	})
	gap_slider.addEventListener('input', () => {
		settings.gap = parseInt(gap_slider.value)
		gap_val.textContent = settings.gap
		if (pipeline !== null) renderStage(currentStage)
	})
	slime_pref_slider.addEventListener('input', () => {
		settings.slimePreference = parseInt(slime_pref_slider.value)
		slime_pref_val.textContent = formatSlimePreference(settings.slimePreference)
	})
	for (let axis of ['x','y','z']) {
		let invertCheckbox = document.getElementById('invert_' + axis)
		invertCheckbox.checked = settings.invert[axis]
		invertCheckbox.addEventListener('change', () => {
			settings.invert[axis] = invertCheckbox.checked
			if (pipeline !== null) renderStage(currentStage)
		})

		let showCheckbox = document.getElementById('show_' + axis)
		showCheckbox.checked = settings.show[axis]
		showCheckbox.addEventListener('change', () => {
			settings.show[axis] = showCheckbox.checked
			if (pipeline !== null) renderStage(currentStage)
		})
	}

	// debug panel: a new saved geode from the pasted JSON, or a random one from the sliders
	generate_btn.addEventListener('click', () => {
		let json = import_json.value.trim()
		if (!json) { App.newGeode(); return }
		let parsed
		try {
			parsed = veinFromExport(JSON.parse(json))
		} catch (e) {
			flashStageMessage('Invalid JSON: ' + e.message)
			return
		}
		App.newGeode(parsed)
	})
}

window.addEventListener(`DOMContentLoaded`, () => {
	App.loadPrefs() // before the menus read `settings`
	ST.new()
	ST.setUpCameras()
	setupSettingsMenu()
	addSynthScenesToMenu()
	App.init() // landing page (or index.html#dev: the old developer session, photo geode-01 on stage 1)
	ST.animate()
});

document.addEventListener('keydown', (event) => {
	// don't let typing in the inputs trigger these shortcuts
	if (['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)) return
	if (!App.inWorkspace() || App.modalOpen()) return

	if (event.key === 'r' && App.debug) App.newGeode()
	if (event.key === 'Escape' && probe) { probe = null; if (currentStage === 1) redrawCalibrationCanvas() }
	if (event.key === 'c' && probe && currentStage === 1 && App.debug) copyProbe()
	if ((event.key === 'x' || event.key === 'X') && probe && currentStage === 1) toggleProbeCube()
	if (event.key === '0' && currentStage === 1) resetPhotoZoom()
	if (['1','2','3','4','5','6','7'].includes(event.key)) App.goStep(parseInt(event.key))
	if (event.key === 'ArrowRight') App.goStep(currentStage + 1)
	if (event.key === 'ArrowLeft') App.goStep(currentStage - 1)
	if (event.key === 'e' && App.debug) exportVein()
	if (event.key === 'l' && currentStage > 1) App.toggleLayers()
	if (layerView.enabled && currentStage > 1 && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
		event.preventDefault() // don't scroll the page
		layerView.y += (event.key === 'ArrowUp' ? 1 : -1) // renderStage() clamps this to the occupied range
		renderStage(currentStage)
	}
});
