

var d={}

/** Holds the last computed vein + per-axis data, so renderStage() can redraw any stage without recomputing */
let pipeline = null
let currentStage = 6

/** Stage 1's source photo (see js/CalibrationTools.js) and its cached line-detection result, so switching away and back doesn't rerun Canny/Hough */
let calibrationImage = new Image()
let calibrationResult = null

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

	let canvas = calibration_canvas
	let draw = () => {
		canvas.width = calibrationImage.naturalWidth
		canvas.height = calibrationImage.naturalHeight
		let ctx = canvas.getContext('2d')
		ctx.drawImage(calibrationImage, 0, 0)
		ctx.lineWidth = 2
		ctx.strokeStyle = '#4ade80'
		for (let s of calibrationResult.segments) {
			ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke()
		}
	}

	if (stage_info) stage_info.innerHTML = 'Stage 1/' + LAST_STAGE + ' - ' + STAGE_NAMES[1] + ' (tasti 1-' + LAST_STAGE + ' per cambiare)'

	if (!calibrationImage.complete || calibrationImage.naturalWidth === 0) {
		if (stage_info) stage_info.innerHTML += ' | caricamento foto...'
		setTimeout(() => { if (currentStage === 1) renderCalibrationStage() }, 200)
		return
	}
	if (!cvReady) {
		if (stage_info) stage_info.innerHTML += ' | caricamento OpenCV.js...'
		setTimeout(() => { if (currentStage === 1) renderCalibrationStage() }, 500)
		return
	}
	if (calibrationResult === null) {
		calibrationResult = { segments: detectLines(calibrationImage) }
	}
	draw()
	if (stage_info) stage_info.innerHTML += ' | ' + calibrationResult.segments.length + ' segmenti rilevati'
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
	// vein = veinXX

	addDebugInfo()
	setupSettingsMenu()

	ST.setUpCameras()
	calibrationImage.src = 'reference/screenshots/geode-01.png'
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
