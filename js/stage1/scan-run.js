/** Automatic calibration (see cameraFromLines/solveLattice in js/scan/): fitted camera + lattice cubes, computed once per photo (or on "Recompute") */
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

/**
 * Stage 1: shows calibrationImage with its detected line segments (see js/scan/)
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

/** Live run: fit the camera, read the cubes from the lines, solve lattice and camera, pick the cells (see js/scan/). Every step redraws. */
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
