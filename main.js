

var d={}

/** Holds the last computed vein + per-axis data, so renderStage() can redraw any stage without recomputing */
let pipeline = null
let currentStage = 4

const STAGE_NAMES = {
	1: 'Geoide',
	2: 'Confini stretti',
	3: 'Confini validi',
	4: 'Raggruppamenti (max 12 blocchi)',
}

/**
 * Starting from a passed vein, runs the full step-2 pipeline (perimeter, valid areas,
 * capped support grouping) on all 3 axes, keeping a snapshot after each sub-stage so the
 * result can be inspected one step at a time with renderStage().
 */
function processVein(vein) {
	if (d!==false) {
		d.oresCount
		d.adjacentFaces = 0
		d.plainAdjacents = {x:0,y:0,z:0}
		d.plainSupports = {x:0,y:0,z:0}
	}

	vein = new Matrix3D(vein)
    console.log('vein',  vein)

	let data_layers={x:{},y:{},z:{}}
	for (let axis of ['x','y','z']) {
		data_layers[axis].plain = generatePlain(vein, axis)
		findAdjacents(data_layers[axis].plain)
		data_layers[axis].snapshotStretti = data_layers[axis].plain.clone() // stage 2

		findDistinctAreas(data_layers[axis])
		disableInvalidAreas(data_layers[axis])
		data_layers[axis].snapshotValide = data_layers[axis].plain.clone() // stage 3

		addSupportBlocks(data_layers[axis])
		data_layers[axis].snapshotGruppi = buildGroupPlain(data_layers[axis]) // stage 4
	}

	vein.set(2,2,2,Voxels.RED)
	// vein.set(12,12,12,Voxels.BLU)

	pipeline = { vein, data_layers }
}

/** Downloads the exact vein currently shown, so a specific result can be shared and reloaded later */
function exportVein() {
	if (pipeline === null) return
	let blob = new Blob([JSON.stringify(pipeline.vein.matrix)], { type: 'application/json' })
	let url = URL.createObjectURL(blob)
	let a = document.createElement('a')
	a.href = url
	a.download = 'vein-' + Date.now() + '.json'
	a.click()
	URL.revokeObjectURL(url)
}

/** Renders one stage of the pipeline (1-4) from the already computed snapshots */
function renderStage(stage) {
	if (pipeline === null) return
	currentStage = stage
	ST.clearScene()

	let display = pipeline.vein.clone()
	if (stage > 1) {
		for (let axis of ['x','y','z']) {
			let snapshot = stage === 2 ? pipeline.data_layers[axis].snapshotStretti
				: stage === 3 ? pipeline.data_layers[axis].snapshotValide
				: pipeline.data_layers[axis].snapshotGruppi
			let blueprint = Tools3D.plainToVolume(snapshot, axis)
			Tools3D.combineVolumes(display, blueprint, axis)
		}
	}
	ST.addMeshToScene(display)

	if (stage_info)
		stage_info.innerHTML = 'Stage ' + stage + '/4 - ' + STAGE_NAMES[stage] + ' (tasti 1-4 per cambiare)'
}


window.addEventListener(`DOMContentLoaded`, () => {
	ST.new()

	let vein = generateRandomVein()
	// vein = veinXX
	processVein(vein)

	addDebugInfo()

	ST.setUpCameras()
	renderStage(currentStage)
	ST.animate()
});

document.addEventListener('keydown', (event) => {
	if (event.key === 'r') {
		let vein = generateRandomVein()
		processVein(vein)
		addDebugInfo()
		renderStage(currentStage)
	}
	if (event.key === 'i') {
		debug_info.style.display = (debug_info.style.display == 'none') ? 'block' : 'none';
	}
	if (['1','2','3','4'].includes(event.key)) {
		renderStage(parseInt(event.key))
	}
	if (event.key === 'e') {
		exportVein()
	}
});
