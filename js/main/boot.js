window.addEventListener(`DOMContentLoaded`, () => {
	App.loadPrefs() // before the menus read `settings`
	ST.new()
	ST.setUpCameras()
	setupSettingsMenu()
	addSynthScenesToMenu()
	App.init() // landing page (or index.html#dev: the old developer session, photo geode-01 on stage 1)
	ST.animate()
});

document.addEventListener('keydown', (event) => {
	// don't let typing in the inputs trigger these shortcuts
	if (['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)) return
	if (!App.inWorkspace() || App.modalOpen()) return

	if (event.key === 'r' && App.debug) App.newGeode()
	if (event.key === 'Escape' && probe) { probe = null; if (currentStage === 1) redrawCalibrationCanvas() }
	if (event.key === 'c' && probe && currentStage === 1 && App.debug) copyProbe()
	if ((event.key === 'x' || event.key === 'X') && probe && currentStage === 1) toggleProbeCube()
	if (event.key === '0' && currentStage === 1) resetPhotoZoom()
	if (['1','2','3','4','5','6','7'].includes(event.key)) App.goStep(parseInt(event.key))
	if (event.key === 'ArrowRight') App.goStep(currentStage + 1)
	if (event.key === 'ArrowLeft') App.goStep(currentStage - 1)
	if (event.key === 'e' && App.debug) exportVein()
	if (event.key === 'l' && currentStage > 1) App.toggleLayers()
	if (layerView.enabled && currentStage > 1 && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
		event.preventDefault() // don't scroll the page
		layerView.y += (event.key === 'ArrowUp' ? 1 : -1) // renderStage() clamps this to the occupied range
		renderStage(currentStage)
	}
});
