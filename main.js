

var d={}

/** Holds the last computed vein + per-axis data, so renderStage() can redraw any stage without recomputing */
let pipeline = null
let currentStage = 6

/** Stage 1's source photo (see js/CalibrationTools.js) and its cached line-detection result, so switching away and back doesn't rerun Canny/Hough */
let calibrationImage = new Image()
let calibrationResult = null

/**
 * Stage 1 manual calibration: automatic Hough detection (calibrationResult below) turned out too
 * noisy on a busy geode screenshot to find real vanishing points. Instead: the user draws 2 lines
 * by hand along real block edges they recognize (one vanishing direction), then 2 more along a
 * different direction (a second vanishing point) - 4 lines total. Each pair's vanishing point is
 * computed live as the intersection of its 2 lines (lineFromPoints/intersectLines, see
 * js/CalibrationTools.js). Once a line exists it can be fine-tuned by dragging its endpoints.
 * calibLines[i].x1 === null means that slot hasn't been drawn yet. Kept across stage switches so
 * retracing isn't needed every time stage 1 is revisited.
 */
let calibLines = [
	{ x1: null, y1: null, x2: null, y2: null, vp: 0 },
	{ x1: null, y1: null, x2: null, y2: null, vp: 0 },
	{ x1: null, y1: null, x2: null, y2: null, vp: 1 },
	{ x1: null, y1: null, x2: null, y2: null, vp: 1 },
]
const VP_COLORS = ['#3b82f6', '#a855f7']
let draggingPoint = null // {line, end} (end: 1 or 2) while dragging an existing endpoint handle, null otherwise
let drawingNewLine = null // {line, x1,y1,x2,y2} while drawing a not-yet-committed line into the next empty slot
let calibrationListenersBound = false

function resetCalibLines() {
	for (let line of calibLines) { line.x1 = null; line.y1 = null; line.x2 = null; line.y2 = null }
}

/** The vanishing point for vpIndex (0 or 1): the intersection of its 2 calibLines, or null if either isn't drawn yet or they're too close to parallel */
function computeVP(vpIndex, w, h) {
	let [a, b] = calibLines.filter((l) => l.vp === vpIndex)
	if (a.x1 === null || b.x1 === null) return null
	let ga = lineFromPoints(a.x1, a.y1, a.x2, a.y2)
	let gb = lineFromPoints(b.x1, b.y1, b.x2, b.y2)
	if (!ga || !gb) return null
	let p = intersectLines(ga, gb)
	if (Math.abs(p.w) < 1e-6) return null
	let diag = Math.hypot(w, h)
	let x = p.x / p.w, y = p.y / p.w
	if (Math.abs(x) > 30 * diag || Math.abs(y) > 30 * diag) return null // nearly parallel -> wild, meaningless point
	return { x, y }
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
 * instead of the 3D scene. Runs detection once per image and caches it in calibrationResult.
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

	// automatic Hough detection (for the optional "mostra linee automatiche" overlay) runs in the
	// background - manual line drawing works immediately and doesn't need to wait for it
	if (calibrationResult === null) {
		if (!cvReady) {
			setTimeout(() => { if (currentStage === 1) renderCalibrationStage() }, 500)
			return
		}
		calibrationResult = { segments: detectLines(calibrationImage) }
		redrawCalibrationCanvas()
	}
}

/** Converts a mouse event over calibration_canvas into image-pixel coordinates, accounting for the canvas being CSS-scaled down (max-width:100%) from its natural resolution */
function imageCoordsFromEvent(event, canvas) {
	let rect = canvas.getBoundingClientRect()
	return {
		x: (event.clientX - rect.left) * (canvas.width / rect.width),
		y: (event.clientY - rect.top) * (canvas.height / rect.height),
	}
}

/** Redraws the photo + (optionally) the automatic Hough lines + each drawn line (extended + its draggable segment/endpoints) + any line mid-draw + the computed vanishing points, and refreshes the stats panel */
function redrawCalibrationCanvas() {
	let canvas = calibration_canvas
	let ctx = canvas.getContext('2d')
	ctx.clearRect(0, 0, canvas.width, canvas.height)
	ctx.drawImage(calibrationImage, 0, 0)

	if (calibration_show_auto.checked && calibrationResult) {
		ctx.lineWidth = 1
		ctx.strokeStyle = 'rgba(255,255,255,0.3)'
		for (let s of calibrationResult.segments) {
			ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke()
		}
	}

	let drawnLines = calibLines.filter((l) => l.x1 !== null)

	// each line extended well past its own endpoints, thin+faint - so where it's headed (and
	// whether it agrees with the other block edges beyond the segment itself) is visible at a glance
	const EXT = Math.max(canvas.width, canvas.height) * 2
	drawnLines.forEach((line) => {
		let dx = line.x2 - line.x1, dy = line.y2 - line.y1
		let len = Math.hypot(dx, dy) || 1
		let ux = dx / len, uy = dy / len
		ctx.strokeStyle = VP_COLORS[line.vp]
		ctx.globalAlpha = 0.35
		ctx.lineWidth = 1
		ctx.beginPath()
		ctx.moveTo(line.x1 - ux * EXT, line.y1 - uy * EXT)
		ctx.lineTo(line.x2 + ux * EXT, line.y2 + uy * EXT)
		ctx.stroke()
		ctx.globalAlpha = 1
	})

	// the actual draggable segment + its 2 endpoint handles, on top and fully opaque
	drawnLines.forEach((line) => {
		ctx.strokeStyle = VP_COLORS[line.vp]
		ctx.lineWidth = 3
		ctx.beginPath(); ctx.moveTo(line.x1, line.y1); ctx.lineTo(line.x2, line.y2); ctx.stroke()
		for (let [hx, hy] of [[line.x1, line.y1], [line.x2, line.y2]]) {
			ctx.fillStyle = VP_COLORS[line.vp]
			ctx.beginPath(); ctx.arc(hx, hy, 7, 0, 2 * Math.PI); ctx.fill()
			ctx.strokeStyle = 'black'; ctx.lineWidth = 1.5; ctx.stroke()
		}
	})

	// the line currently being drawn from scratch (not committed yet)
	if (drawingNewLine) {
		ctx.strokeStyle = VP_COLORS[drawingNewLine.vp]
		ctx.lineWidth = 3
		ctx.setLineDash([8, 6])
		ctx.beginPath(); ctx.moveTo(drawingNewLine.x1, drawingNewLine.y1); ctx.lineTo(drawingNewLine.x2, drawingNewLine.y2); ctx.stroke()
		ctx.setLineDash([])
	}

	let vps = [computeVP(0, canvas.width, canvas.height), computeVP(1, canvas.width, canvas.height)]
	vps.forEach((vp, i) => {
		if (!vp) return
		let x = Math.max(10, Math.min(canvas.width - 10, vp.x))
		let y = Math.max(10, Math.min(canvas.height - 10, vp.y))
		ctx.fillStyle = VP_COLORS[i]
		ctx.beginPath(); ctx.arc(x, y, 9, 0, 2 * Math.PI); ctx.fill()
		ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke()
	})

	updateCalibrationStats(vps, canvas.width, canvas.height)
}

function updateCalibrationStats(vps, w, h) {
	let drawnCount = calibLines.filter((l) => l.x1 !== null).length
	let html
	if (drawnCount < 2) html = 'Disegna 2 linee lungo spigoli paralleli (1&deg; direzione, blu).'
	else if (drawnCount < 4) html = 'Ora 2 linee lungo un\'altra direzione (2&deg; direzione, viola).'
	else html = 'Trascina gli estremi per aggiustare le linee.'

	if (drawnCount >= 2 && !vps[0]) html += '<br><span style="color:#f87171">le 2 linee blu sono troppo parallele</span>'
	if (drawnCount >= 4 && !vps[1]) html += '<br><span style="color:#f87171">le 2 linee viola sono troppo parallele</span>'
	if (vps[0] && vps[1]) {
		let f = calibrateFromPair(vps[0], vps[1], w / 2, h / 2)
		if (f !== null) {
			let vFOV = 2 * Math.atan((h / 2) / f) * 180 / Math.PI
			html += '<br><b style="color:#4ade80">f=' + f.toFixed(0) + 'px, FOV vert ' + vFOV.toFixed(1) + '&deg;</b>'
		} else {
			html += '<br><span style="color:#f87171">posizione non valida</span>'
		}
	}
	calibration_stats.innerHTML = html
}

/** How close (in image px) the mouse must be to an endpoint handle to grab it instead of starting a new line */
const HANDLE_GRAB_RADIUS = 20

/** Wires up drawing the 4 lines from scratch, dragging their endpoints afterwards, + the reset/show-auto controls, once */
function setupCalibrationCanvas() {
	if (calibrationListenersBound) return
	calibrationListenersBound = true
	let canvas = calibration_canvas

	function existingHandles() {
		let pts = []
		for (let line of calibLines) {
			if (line.x1 === null) continue
			pts.push({ line, end: 1, x: line.x1, y: line.y1 })
			pts.push({ line, end: 2, x: line.x2, y: line.y2 })
		}
		return pts
	}

	canvas.addEventListener('mousedown', (e) => {
		let p = imageCoordsFromEvent(e, canvas)
		let scale = canvas.width / canvas.getBoundingClientRect().width
		let closest = null, closestDist = Infinity
		for (let h of existingHandles()) {
			let dist = Math.hypot(h.x - p.x, h.y - p.y)
			if (dist < closestDist) { closestDist = dist; closest = h }
		}
		if (closest && closestDist <= HANDLE_GRAB_RADIUS * scale) {
			draggingPoint = closest
			return
		}
		// no existing handle nearby - start a brand new line in the next empty slot, if any
		let emptySlot = calibLines.findIndex((l) => l.x1 === null)
		if (emptySlot === -1) return
		drawingNewLine = { slot: emptySlot, vp: calibLines[emptySlot].vp, x1: p.x, y1: p.y, x2: p.x, y2: p.y }
	})
	canvas.addEventListener('mousemove', (e) => {
		let p = imageCoordsFromEvent(e, canvas)
		if (draggingPoint) {
			if (draggingPoint.end === 1) { draggingPoint.line.x1 = p.x; draggingPoint.line.y1 = p.y }
			else { draggingPoint.line.x2 = p.x; draggingPoint.line.y2 = p.y }
			redrawCalibrationCanvas()
		} else if (drawingNewLine) {
			drawingNewLine.x2 = p.x; drawingNewLine.y2 = p.y
			redrawCalibrationCanvas()
		}
	})
	canvas.addEventListener('mouseup', () => {
		draggingPoint = null
		if (drawingNewLine) {
			let length = Math.hypot(drawingNewLine.x2 - drawingNewLine.x1, drawingNewLine.y2 - drawingNewLine.y1)
			if (length > 10) { // ignore accidental clicks
				let line = calibLines[drawingNewLine.slot]
				line.x1 = drawingNewLine.x1; line.y1 = drawingNewLine.y1
				line.x2 = drawingNewLine.x2; line.y2 = drawingNewLine.y2
			}
			drawingNewLine = null
			redrawCalibrationCanvas()
		}
	})
	canvas.addEventListener('mouseleave', () => { draggingPoint = null; drawingNewLine = null; redrawCalibrationCanvas() })

	calibration_reset.addEventListener('click', () => { resetCalibLines(); redrawCalibrationCanvas() })
	calibration_show_auto.addEventListener('change', redrawCalibrationCanvas)
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
	calibrationImage.src = PHOTO_DATA.geode01
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
