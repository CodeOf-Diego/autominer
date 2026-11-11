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
