

var d={}

/** Holds the last computed vein + per-axis data, so renderStage() can redraw any stage without recomputing */
let pipeline = null
let currentStage = 5

const STAGE_NAMES = {
	1: 'Geoide',
	2: 'Confini stretti',
	3: 'Confini validi',
	4: 'Raggruppamenti (max 12 blocchi)',
	5: 'Materiali (slime/honey)',
}

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

/** Generates a new random vein + grouping from a fresh (or given) seed */
function newRun(seed) {
	if (seed === undefined) seed = Math.floor(Math.random() * 0xffffffff)
	let vein = generateRandomVein(seed)
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

/** Renders one stage of the pipeline (1-5) from the already computed snapshots */
function renderStage(stage) {
	if (pipeline === null) return
	currentStage = stage
	ST.clearScene()

	let display = pipeline.vein.clone()
	if (stage > 1) {
		for (let axis of ['x','y','z']) {
			let snapshot = stage === 2 ? pipeline.data_layers[axis].snapshotStretti
				: stage === 3 ? pipeline.data_layers[axis].snapshotValide
				: stage === 4 ? pipeline.data_layers[axis].snapshotGruppi
				: pipeline.data_layers[axis].snapshotMateriali
			let blueprint = Tools3D.plainToVolume(snapshot, axis)
			Tools3D.combineVolumes(display, blueprint, axis)
		}
	}
	ST.addMeshToScene(display)

	// group index numbers only make sense once groups exist (stage 4+)
	if (stage >= 4) {
		ST.updateGroupLabels(
			pipeline.data_layers,
			{ x: display.maxX(), y: display.maxY(), z: display.maxZ() },
			{ x: pipeline.vein.maxX(), y: pipeline.vein.maxY(), z: pipeline.vein.maxZ() }
		)
	} else {
		ST.clearGroupLabels()
	}

	if (stage_info)
		stage_info.innerHTML = 'Stage ' + stage + '/5 - ' + STAGE_NAMES[stage] + ' (tasti 1-5 per cambiare)'
}


window.addEventListener(`DOMContentLoaded`, () => {
	ST.new()

	newRun()
	// vein = veinXX

	addDebugInfo()

	ST.setUpCameras()
	renderStage(currentStage)
	ST.animate()
});

document.addEventListener('keydown', (event) => {
	if (event.key === 'r') {
		newRun()
		addDebugInfo()
		renderStage(currentStage)
	}
	if (event.key === 'i') {
		debug_info.style.display = (debug_info.style.display == 'none') ? 'block' : 'none';
	}
	if (['1','2','3','4','5'].includes(event.key)) {
		renderStage(parseInt(event.key))
	}
	if (event.key === 'e') {
		exportVein()
	}
});
