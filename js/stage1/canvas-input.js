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
