

var d={}

/** Holds the last computed vein + per-axis data, so renderStage() can redraw any stage without recomputing */
let pipeline = null
let currentStage = 1 // the app opens on stage 1 (photo calibration)

/** Stage 1's source photo (see js/CalibrationTools.js) */
let calibrationImage = new Image()

let calibrationListenersBound = false // stage-1 panel listeners are wired once

/** The synthetic test scenes (reference/synthetic/tools/synth_page.js), with known truth: the same seeds as the tests. Generated when first picked, not stored: inlining the images would add ~10 MB. */
const SYNTH_SCENES = [
	...[1, 2, 3, 5, 6, 7, 9, 10].map((seed) => ({ key: 'synth-far-' + seed, group: 'Sintetiche lontane', label: 'lontana, seed ' + seed, seed, opts: {} })),
	...[1, 2, 3, 4, 5, 6, 7, 8].map((seed) => ({ key: 'synth-close-' + seed, group: 'Sintetiche ravvicinate', label: 'ravvicinata, seed ' + seed, seed, opts: { DR: [6, 10], RR: [3.5, 5] } })),
	...[4, 11, 12, 13].map((seed) => ({ key: 'synth-dark-' + seed, group: 'Sintetiche scure', label: 'scura, seed ' + seed, seed, opts: { bright: 0.35 } })),
]
let synthLoadToken = 0
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

/** Automatic calibration (see cameraFromLines/solveLattice in js/CalibrationTools.js): fitted camera + lattice cubes, computed once per photo (or on "Ricalcola") */
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
	autoCalState = 'idle'; autoCal = null; autoCubes = null; autoLive = null; autoMask = null; autoTruth = null
	let want = ++synthLoadToken, scene = SYNTH_SCENES.find((s) => s.key === key)
	if (scene && !PHOTO_DATA[key]) { prepareSynthScene(scene).then(() => { if (want === synthLoadToken) loadCalibrationPhoto(key) }); return }
	if (scene) autoTruth = scene.truth
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
	1: 'Foto + linee rilevate',
	2: 'Geoide',
	3: 'Confini stretti',
	4: 'Confini validi',
	5: 'Raggruppamenti (max 12 blocchi)',
	6: 'Materiali (slime/honey)',
	7: 'Flying machines (una per gruppo)',
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

/** Briefly shows a message in the stage label, then restores it */
function flashStageMessage(text) {
	if (!stage_info) return
	let original = stage_info.innerHTML
	stage_info.innerHTML = text
	setTimeout(() => { stage_info.innerHTML = original }, 1500)
}

/** Copies the exact vein + seed currently shown to the clipboard, so a specific result can be shared and reloaded later */
function exportVein() {
	if (pipeline === null) return
	// compact form (size + ore coordinates) instead of the full matrix - see veinToSparse() in Tools.js.
	// Load it back with veinFromExport(); the old dense {seed, vein} format loads there too.
	let json = JSON.stringify({ seed: pipeline.seed, ...veinToSparse(pipeline.vein.matrix) })
	navigator.clipboard.writeText(json).then(() => {
		flashStageMessage('Vena copiata negli appunti')
	}).catch(() => {
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
	calibration_view.style.display = 'block'
	// the settings panel (vein density/gap/etc, irrelevant here) covers a big chunk of the left
	// side of the screen and would swallow drags meant for the VP handles; 'm' still toggles it back
	settings_menu.style.display = 'none'

	if (stage_info) stage_info.innerHTML = 'Stage 1/' + LAST_STAGE + ' - ' + STAGE_NAMES[1] + ' (tasti 1-' + LAST_STAGE + ' per cambiare)'

	if (!calibrationImage.complete || calibrationImage.naturalWidth === 0) {
		if (stage_info) stage_info.innerHTML += ' | caricamento foto...'
		setTimeout(() => { if (currentStage === 1) renderCalibrationStage() }, 200)
		return
	}

	calibration_canvas.width = calibrationImage.naturalWidth
	calibration_canvas.height = calibrationImage.naturalHeight
	setupCalibrationCanvas()
	redrawCalibrationCanvas()

	// manual line drawing works immediately; the automatic fit needs OpenCV.js, which loads async
	if (!cvReady) {
		setTimeout(() => { if (currentStage === 1) renderCalibrationStage() }, 500)
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
	autoCal = null; autoCubes = null; autoLive = null; autoMask = null; autoLines = null
	let fov = parseFloat(calibration_fov.value)
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
		if (calibration_slow.checked) await sleep(250)
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
	if (autoMask && (autoCalState === 'running' || calibration_show_mask.checked)) ctx.drawImage(autoMask, 0, 0, canvas.width, canvas.height)
	if (autoLines && (autoCalState === 'running' || calibration_show_lines.checked)) {
		let sx = canvas.width / autoLines.w, sy = canvas.height / autoLines.h, AXIS_COL = ['#ff5050', '#50ff50', '#5aa0ff']
		ctx.lineWidth = 3
		for (let i = 0; i < autoLines.shown; i++) {
			let L = autoLines.segs[i]
			ctx.strokeStyle = L.axis === undefined ? '#ffffff' : L.axis < 0 ? 'rgba(160,160,160,0.8)' : AXIS_COL[L.axis]
			ctx.beginPath(); ctx.moveTo(L.x1 * sx, L.y1 * sy); ctx.lineTo(L.x2 * sx, L.y2 * sy); ctx.stroke()
		}
	}
	if (!autoCubes || !autoCubes.cubes.length) return
	let f = (canvas.height / 2) / Math.tan(autoCubes.fov * Math.PI / 360), cx = canvas.width / 2, cy = canvas.height / 2
	let ax = autoCubes.ax, O = autoCubes.origin
	let at = (a, b, c) => [O[0] + a * ax.ex[0] + b * ax.ey[0] + c * ax.ez[0], O[1] + a * ax.ex[1] + b * ax.ey[1] + c * ax.ez[1], O[2] + a * ax.ex[2] + b * ax.ey[2] + c * ax.ez[2]]
	let cubes = autoCubes.cubes
	let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
	for (let c of cubes) { let v = [c.i, c.j, c.k]; for (let n = 0; n < 3; n++) { lo[n] = Math.min(lo[n], v[n]); hi[n] = Math.max(hi[n], v[n]) } }

	if (calibration_show_diff.checked && autoCal && autoCal.an) {
		// where the union of the detected cubes disagrees with the purple mask (mask resolution, drawn scaled up): red = covered but not purple, blue = purple but not covered
		let an = autoCal.an, fm = (an.h / 2) / Math.tan(autoCubes.fov * Math.PI / 360), cov = new Uint8Array(an.w * an.h)
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

	if (calibration_show_grid.checked) {
		ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.45)'
		let y = lo[1] - 0.5
		for (let i = lo[0] - 0.5; i <= hi[0] + 0.51; i++) drawSeg3D(ctx, at(i, y, lo[2] - 0.5), at(i, y, hi[2] + 0.5), f, cx, cy)
		for (let k = lo[2] - 0.5; k <= hi[2] + 0.51; k++) drawSeg3D(ctx, at(lo[0] - 0.5, y, k), at(hi[0] + 0.5, y, k), f, cx, cy)
	}
	if (calibration_show_cubes.checked) {
		const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]
		ctx.lineWidth = 2
		for (let c of cubes) {
			let t = hi[1] > lo[1] ? (c.j - lo[1]) / (hi[1] - lo[1]) : 0 // colour by height: low = yellow, high = orange/red
			ctx.strokeStyle = 'hsl(' + Math.round(55 - 55 * t) + ',100%,55%)'
			let C = cubeCorners(at(c.i, c.j, c.k), ax)
			let far = 0
			for (let q = 1; q < 8; q++) if (C[q][2] > C[far][2]) far = q // the corner farthest from the camera is hidden, and so are the 3 edges meeting there
			for (let [a, b] of EDGES) if (a !== far && b !== far) drawSeg3D(ctx, C[a], C[b], f, cx, cy)
		}
		if (calibration_show_labels.checked) {
			ctx.font = '12px sans-serif'; ctx.fillStyle = 'white'; ctx.strokeStyle = 'black'; ctx.lineWidth = 3
			for (let c of cubes) {
				let p = projectCam(at(c.i, c.j, c.k), f, cx, cy), txt = c.i + ',' + c.j + ',' + c.k
				ctx.strokeText(txt, p.x - 14, p.y + 4); ctx.fillText(txt, p.x - 14, p.y + 4)
			}
		}
	}
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
	const PHASES = { mask: 'maschera viola', lines: 'linee dai contorni della maschera', refine: 'rifinitura delle linee sul colore', camera: 'stima camera dalle linee', texture: 'texture della foto dai cubi sicuri', lattice: 'cubi e reticolo dalle linee', cells: 'scelta delle celle' }
	const ORDER = ['mask', 'lines', 'refine', 'camera', 'texture', 'lattice', 'cells']
	let cam = autoLive && autoLive.pitch !== undefined ? autoLive : autoCal
	if (autoCalState === 'running' && autoLive) {
		let n = ORDER.indexOf(autoLive.phase)
		html += '<br><br><b style="color:#facc15">In corso: ' + (n >= 0 ? (n + 1) + '/' + ORDER.length + ' ' : '') + (PHASES[autoLive.phase] || autoLive.phase) + '</b>'
	}
	if (cam) html += '<br>' + (autoCalState === 'running' ? '' : '<br>') + '<b style="color:#facc15">Auto:</b> pitch ' + cam.pitch.toFixed(1) + '&deg; gi&ugrave;, yaw ' + cam.yaw.toFixed(1) + '&deg;, FOV vert ' + cam.fov.toFixed(1) + '&deg;'
	if (autoLines) {
		let n = autoLines.segs.length, ok = autoLines.segs.filter((L) => L.axis >= 0), tot = autoLines.segs.reduce((a, L) => a + L.len, 0)
		html += '<br>Linee dai contorni: <b>' + n + '</b>' + (autoLines.segs[0] && autoLines.segs[0].axis !== undefined ? ', ' + ok.length + ' compatibili con la camera stimata (' + (100 * ok.reduce((a, L) => a + L.len, 0) / Math.max(1, tot)).toFixed(0) + '% della lunghezza; rosso/verde/blu = asse X/Y/Z, grigio = nessuno)' : '')
	}
	if (autoTruth) html += '<br><br><b style="color:#60a5fa">Scena sintetica</b>: ' + autoTruth.cubes.length + ' cubi veri, pitch ' + autoTruth.pitch.toFixed(1) + '&deg;, yaw ' + autoTruth.yaw.toFixed(1) + '&deg;, FOV ' + autoTruth.fov.toFixed(1) + '&deg;'
	if (autoCubes && autoCubes.truthScore) {
		let t = autoCubes.truthScore, good = t.recall >= 0.95 && t.precision >= 0.95
		html += '<br><b style="color:' + (good ? '#4ade80' : '#f87171') + '">Trovati ' + Math.round(t.recall * 100) + '% dei cubi veri, giusti ' + Math.round(t.precision * 100) + '% dei trovati</b><br>Errore camera: FOV ' + t.dFov.toFixed(2) + '&deg;, pitch ' + t.dPitch.toFixed(2) + '&deg;, yaw ' + t.dYaw.toFixed(2) + '&deg;'
	}
	if (autoCubes) {
		html += '<br><b>' + autoCubes.cubes.length + ' cubi</b> agganciati al reticolo' + (autoCubes.score !== undefined ? ' (punteggio ' + Math.round(autoCubes.score) + ')' : '') + (autoCubes.refIoU ? ', cubo di riferimento IoU ' + autoCubes.refIoU.toFixed(2) : '') + ' - coord. relative al riferimento (0,0,0)'
	} else if (autoCalState === 'done') html += '<br><span style="color:#f87171">meno di 2 cubi leggibili dalle righe: niente a cui agganciare il reticolo (o troppo poco viola)</span>'
	calibration_stats.innerHTML = html
}

/** Wires up the stage-1 panel controls (photo select, recompute, overlay checkboxes) once */
function setupCalibrationCanvas() {
	if (calibrationListenersBound) return
	calibrationListenersBound = true
	let canvas = calibration_canvas
	for (let el of [calibration_show_grid, calibration_show_cubes, calibration_show_labels, calibration_show_mask, calibration_show_diff, calibration_show_lines]) el.addEventListener('change', redrawCalibrationCanvas)
	calibration_photo.addEventListener('change', () => { loadCalibrationPhoto(calibration_photo.value) })
	calibration_recompute.addEventListener('click', () => { autoCalState = 'idle'; renderCalibrationStage() })
}

/** Renders one stage of the pipeline (1-7; stage 1 is the photo/line-detection view, see above) from the already computed snapshots */
function renderStage(stage) {
	if (pipeline === null) return
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

	// stage 7's machine blocks aren't part of `display` (addMachinesToScene draws them
	// separately), so they're computed up front here: once to feed the layer view's occupied
	// range below, once to actually draw them further down
	let machineBlocksByAxis = null
	if (pipelineStage === 6) {
		let shift = {
			x: settings.invert.x ? settings.gap + 1 : 0,
			y: settings.invert.y ? settings.gap + 1 : 0,
			z: settings.invert.z ? settings.gap + 1 : 0,
		}
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

	ST.addMeshToScene(display, layerY)

	// group index numbers only make sense once groups exist (pipeline stage 4+)
	if (pipelineStage >= 4) {
		ST.updateGroupLabels(pipeline.data_layers, displaySize, originalSize, settings.gap, settings.invert, settings.show)
	} else {
		ST.clearGroupLabels()
	}

	// stage 7: one flying machine per final group, pushing into the geode along its axis
	if (machineBlocksByAxis) {
		for (let axis in machineBlocksByAxis) {
			ST.addMachinesToScene(machineBlocksByAxis[axis], displaySize, layerY)
		}
	}

	if (stage_info) {
		let label = 'Stage ' + stage + '/' + LAST_STAGE + ' - ' + STAGE_NAMES[stage] + ' (tasti 1-' + LAST_STAGE + ' per cambiare)'
		if (layerView.enabled) label += ' | Layer ' + layerView.y + ' [' + occupied.min + '-' + occupied.max + '] (freccie su/giù, \'l\' per uscire)'
		else label += " ('l' per vista a livelli)"
		stage_info.innerHTML = label
	}
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

	generate_btn.addEventListener('click', () => {
		let json = import_json.value.trim()
		if (json) {
			let parsed
			try {
				parsed = veinFromExport(JSON.parse(json))
			} catch (e) {
				flashStageMessage('JSON non valido: ' + e.message)
				return
			}
			processVein(parsed.vein, parsed.seed)
		} else {
			newRun()
		}
		addDebugInfo()
		renderStage(currentStage)
	})
}

window.addEventListener(`DOMContentLoaded`, () => {
	ST.new()

	newRun()

	addDebugInfo()
	setupSettingsMenu()

	ST.setUpCameras()
	addSynthScenesToMenu()
	calibration_photo.value = 'geode01' // the browser restores the old selection on refresh, while the photo shown is always geode-01
	loadCalibrationPhoto('geode01')
	renderStage(currentStage)
	ST.animate()
});

document.addEventListener('keydown', (event) => {
	// don't let typing in the settings menu's inputs trigger these shortcuts
	if (['INPUT','TEXTAREA'].includes(event.target.tagName)) return

	if (event.key === 'r') {
		newRun()
		addDebugInfo()
		renderStage(currentStage)
	}
	if (event.key === 'i') {
		debug_info.style.display = (debug_info.style.display == 'none') ? 'block' : 'none';
	}
	if (event.key === 'm') {
		settings_menu.style.display = (settings_menu.style.display == 'none') ? 'block' : 'none';
	}
	if (['1','2','3','4','5','6','7'].includes(event.key)) {
		renderStage(parseInt(event.key))
	}
	if (event.key === 'e') {
		exportVein()
	}
	if (event.key === 'l') {
		layerView.enabled = !layerView.enabled
		renderStage(currentStage)
	}
	if (layerView.enabled && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
		event.preventDefault() // don't scroll the page
		layerView.y += (event.key === 'ArrowUp' ? 1 : -1) // renderStage() clamps this to the occupied range
		renderStage(currentStage)
	}
});
