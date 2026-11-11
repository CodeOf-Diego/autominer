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
