/** Wiring of the app shell: buttons (data-action), drop/paste of a screenshot, autosave on hide, then the first screen */
App.init = async function () {
	const actions = {
		upload: () => $('photo_input').click(),
		random: () => App.newGeode(),
		home: () => App.showLanding(),
		next: () => App.goStep(currentStage + 1),
		settings: () => { $('settings_modal').hidden = false },
		'close-settings': () => { $('settings_modal').hidden = true },
		'debug-off': () => App.setDebug(false),
		'reset-view': App.resetView,
		layers: App.toggleLayers,
		'layer-up': () => App.moveLayer(1),
		'layer-down': () => App.moveLayer(-1),
		'collapse-card': () => { let c = $('step_card').classList.toggle('collapsed'); lsSet(CARD_KEY, c ? '1' : '0') },
		'clear-library': async () => {
			if (!confirm('Delete every saved geode in this browser? This cannot be undone.')) return
			await GeodeStore.clear(); lsSet(LAST_KEY, '')
			if (App.entry) { App.entry.transient = true; App.status('off') }
			$('settings_modal').hidden = true
			if (!App.entry) App.renderLibrary()
		},
	}
	document.addEventListener('click', (ev) => {
		let a = ev.target.closest('[data-action]')
		if (a && actions[a.dataset.action]) { ev.preventDefault(); actions[a.dataset.action]() }
	})
	$('settings_modal').addEventListener('click', (ev) => { if (ev.target === $('settings_modal')) $('settings_modal').hidden = true })
	document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') $('settings_modal').hidden = true })
	$('photo_input').addEventListener('change', () => { let f = $('photo_input').files[0]; $('photo_input').value = ''; App.fromFile(f) })
	$('debug_toggle').addEventListener('change', () => App.setDebug($('debug_toggle').checked))
	$('skip_anim_toggle').checked = !!settings.skipAnimation
	$('skip_anim_toggle').addEventListener('change', () => { settings.skipAnimation = $('skip_anim_toggle').checked; savePrefs() })
	$('geode_name').addEventListener('input', () => { if (App.entry) { App.entry.name = $('geode_name').value.trim() || 'Untitled geode'; App.save() } })
	$('geode_name').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.target.blur() })
	for (let id of ['gap_slider', 'density_slider', 'range_slider', 'slime_pref_slider', 'invert_x', 'invert_y', 'invert_z', 'show_x', 'show_y', 'show_z']) $(id).addEventListener('change', savePrefs)
	// a screenshot can be dropped anywhere on the landing page, or pasted (Ctrl+V)
	document.addEventListener('dragover', (ev) => { if (document.body.dataset.screen === 'landing') { ev.preventDefault(); document.body.classList.add('dragging') } })
	document.addEventListener('dragleave', (ev) => { if (!ev.relatedTarget) document.body.classList.remove('dragging') })
	document.addEventListener('drop', (ev) => {
		document.body.classList.remove('dragging')
		if (document.body.dataset.screen !== 'landing') return
		ev.preventDefault()
		App.fromFile(ev.dataTransfer.files[0])
	})
	document.addEventListener('paste', (ev) => {
		if (document.body.dataset.screen !== 'landing') return
		let item = [...(ev.clipboardData ? ev.clipboardData.items : [])].find((i) => i.type.startsWith('image/'))
		if (item) App.fromFile(item.getAsFile())
	})
	window.addEventListener('hashchange', () => { if (location.hash === '#dev') location.reload() }) // typing #dev on an open page: start the dev session
	document.addEventListener('visibilitychange', () => { if (document.hidden) App.flushPending() })
	window.addEventListener('pagehide', () => App.flushPending())
	ST.onLayout = () => {
		if (document.body.dataset.screen === 'landing') ST.setView({ x0: window.innerWidth > 760 ? Math.round(window.innerWidth * 0.36) : 0 })
		else if (currentStage > 1 && pipeline) renderStage(currentStage) // group labels follow the viewports
	}
	if (lsGet(CARD_KEY) === '1') $('step_card').classList.add('collapsed')

	App.setDebug(lsGet(DEBUG_KEY) === '1', false)
	await GeodeStore.open()

	if (location.hash === '#dev') { // the old developer session: debug on, random vein, built-in photo geode-01 on stage 1, nothing saved
		App.setDebug(true, false)
		newRun(); addDebugInfo()
		calibration_photo.value = 'geode01'
		loadCalibrationPhoto('geode01')
		App.entry = { id: 'dev', name: 'Dev session', source: 'dev', transient: true, step: 1, maxStep: 7 }
		$('geode_name').value = App.entry.name
		App.enterWorkspace()
		App.status('off')
		App.goStep(1, true)
		return
	}
	App.showLanding()
}
