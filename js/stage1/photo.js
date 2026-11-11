/** Stage 1's source photo (see js/scan/) */
let calibrationImage = new Image()

let calibrationListenersBound = false // stage-1 panel listeners are wired once
/** Zoom of the stage-1 photo (CSS transform of the canvas inside calibration_zoom_box): scale s >= 1 and offset (tx, ty) in CSS px; drag = pan */
let photoZoom = { s: 1, tx: 0, ty: 0, down: null, dragged: false }

function applyPhotoZoom() {
	let z = photoZoom, bw = calibration_zoom_box.clientWidth, bh = calibration_zoom_box.clientHeight
	z.s = Math.max(1, Math.min(12, z.s))
	z.tx = Math.min(0, Math.max(bw - bw * z.s, z.tx)); z.ty = Math.min(0, Math.max(bh - bh * z.s, z.ty)) // the photo always covers the box
	calibration_canvas.style.transform = z.s === 1 ? '' : 'translate(' + z.tx + 'px,' + z.ty + 'px) scale(' + z.s + ')'
	calibration_canvas.style.cursor = z.s > 1 ? 'grab' : ''
}

function resetPhotoZoom() { photoZoom.s = 1; photoZoom.tx = 0; photoZoom.ty = 0; applyPhotoZoom() }

/** Switches stage 1 to another built-in photo: drops everything computed for the previous one (camera fit, lines, cubes) and cancels a run still in flight */
function loadCalibrationPhoto(key) {
	autoCalToken++ // an older automatic run still in flight cancels itself
	autoCalState = 'idle'; autoCal = null; autoCubes = null; autoLive = null; autoMask = null; autoTruth = null; probe = null
	if (typeof calibration_zoom_box !== 'undefined') resetPhotoZoom()
	let want = ++synthLoadToken, scene = SYNTH_SCENES.find((s) => s.key === key)
	if (scene && !PHOTO_DATA[key]) { prepareSynthScene(scene).then(() => { if (want === synthLoadToken) loadCalibrationPhoto(key) }); return }
	if (scene) autoTruth = scene.truth
	if (!PHOTO_DATA[key]) return // the release build has no built-in photos (geode01...): nothing to load
	loadManualEdits(key)
	calibrationImage = new Image()
	calibrationImage.onload = () => { if (currentStage === 1) renderCalibrationStage() }
	calibrationImage.src = PHOTO_DATA[key]
}
