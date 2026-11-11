/** The probe cube of stage 1: a lattice cell on the ray through the mouse, moved along it with the wheel; the panel shows every test of the cell rule on it. {mx, my, cells, idx, frozen, info} or null */
let probe = null

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
