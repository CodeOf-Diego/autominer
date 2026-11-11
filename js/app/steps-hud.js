/** The 7-step HUD: which steps can be opened, moving between them, the step card and stepper, the layer widget */
Object.assign(App, {
	stepState(n) {
		let entry = App.entry
		if (!entry) return 'todo'
		if (n === 1 && !hasPhoto() && !App.debug) return 'skipped'
		if (n > 1 && !pipelineReady()) return 'locked'
		return n === currentStage ? 'current' : n <= (entry.maxStep || 1) ? 'done' : 'todo'
	},

	goStep(n, force) {
		let entry = App.entry
		if (!entry) return
		n = Math.max(1, Math.min(7, n))
		if (n === currentStage && !force && document.body.dataset.step == n) return
		let st = App.stepState(n)
		if (st === 'skipped') return
		if (st === 'locked') { App.toast('Finish the scan first: the next steps need the blocks it finds'); return }
		if (n === 1 && !hasPhoto() && manualEditsPhoto !== calibration_photo.value) loadCalibrationPhoto(calibration_photo.value) // debug: a built-in photo
		// the camera is framed only when the 3D view comes up (from the photo step, or on opening a
		// session): moving between 3D steps keeps it exactly where the user left it - the geode
		// stays at the world origin anyway, so nothing jumps
		let entering3D = n !== 1 && (currentStage === 1 || force)
		// from the photo, the 3D camera takes the photo's exact viewpoint: the blocks replace the photo without a jump
		// (read before renderStage() hides the photo)
		let pose = entering3D && currentStage === 1 ? photoCameraPose() : null
		renderStage(n)
		if (n === 1) { ST.clearGroupLabels(); updateScanSummary() }
		else if (pose) ST.matchCamera(pose)
		else if (entering3D) ST.frame()
		entry.step = n
		entry.maxStep = Math.max(entry.maxStep || 1, n)
		App.save()
		App.updateHud()
	},

	updateHud() {
		if (!App.entry) return
		let n = currentStage, s = App.STEPS[n - 1]
		document.body.dataset.step = n
		$('step_num').textContent = n
		$('step_short').textContent = s.short
		$('step_desc').textContent = s.desc
		$('step_bar').style.width = (n / 7 * 100) + '%'
		$('step_legend').innerHTML = (s.legend || []).map(([c, t]) => '<span><i style="background:' + c + '"></i>' + t + '</span>').join('')
		let box = $('stepper')
		box.innerHTML = ''
		for (let step of App.STEPS) {
			let st = App.stepState(step.n), li = document.createElement('li')
			li.className = 'st ' + st
			let tip = st === 'skipped' ? 'Scan: not needed for a geode without a screenshot' : st === 'locked' ? step.title + ': finish the scan first' : step.n + ' · ' + step.short
			li.innerHTML = svg(step.icon) + '<span class="lbl">' + step.title + '</span><span class="tip">' + tip + '</span>'
			li.setAttribute('aria-label', 'Step ' + step.n + ': ' + step.title)
			li.addEventListener('click', () => App.goStep(step.n))
			box.appendChild(li)
		}
		let next = $('next_btn'), nextState = n < 7 ? App.stepState(n + 1) : null
		next.hidden = n === 7
		next.disabled = nextState === 'locked'
		next.innerHTML = nextState === 'locked' ? 'Scanning…' : 'Next →'
		App.afterRender()
	},

	/** Called by renderStage() after each 3D render: the layer widget follows the stage's occupied range */
	afterRender() {
		let w = $('layer_widget')
		if (!w) return
		let on = App.entry && layerView.enabled && currentStage > 1
		w.hidden = !on
		$('layers_btn').classList.toggle('on', !!on)
		if (on && layerView.min !== undefined) $('layer_label').textContent = 'Layer ' + (layerView.y - layerView.min + 1) + ' of ' + (layerView.max - layerView.min + 1)
	},

	toggleLayers() {
		if (!App.entry || currentStage === 1) return
		layerView.enabled = !layerView.enabled
		renderStage(currentStage)
		if (layerView.enabled) App.toast('Layer view: <kbd>↑</kbd> <kbd>↓</kbd> to move between layers')
	},
	moveLayer(d) { if (!layerView.enabled) return; layerView.y += d; renderStage(currentStage) },

	setDebug(on, persist = true) {
		App.debug = on
		document.body.dataset.debug = on ? '1' : '0'
		if (persist) lsSet(DEBUG_KEY, on ? '1' : '0')
		$('debug_toggle').checked = on
		ST.setDebug(on)
		if (document.body.dataset.screen !== 'workspace') return
		ST.setView({ ortho: on })
		if (currentStage === 1) { if (calibrationImage.naturalWidth) redrawCalibrationCanvas() } else renderStage(currentStage)
		App.updateHud()
	},

	resetView() {
		if (currentStage === 1) { resetPhotoZoom(); return }
		ST.frame(new THREE.Vector3(-12, 10, 12))
	},
})
