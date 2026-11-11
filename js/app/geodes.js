/** Opening a geode (saved, new random/imported, or a dropped screenshot) and keeping its record up to date */
Object.assign(App, {
	enterWorkspace() {
		document.body.dataset.screen = 'workspace'
		ST.controls.autoRotate = false
		ST.setView({ x0: 0, ortho: App.debug })
		ST.camera.position.set(-12, 10, 12); ST.controls.target.set(0, 0, 0)
	},

	/** The photo option of the debug panel's photo menu: the screenshot of the geode open, if any */
	setEntryPhotoOption(e) {
		let o = $('entry_photo_option')
		o.hidden = !e
		if (e) { o.value = photoKey(e); o.textContent = 'This geode: ' + e.name }
	},

	async open(e) {
		await App.flushPending()
		App.entry = e
		if (!e.transient) lsSet(LAST_KEY, e.id)
		probe = null
		layerView.enabled = false; layerView.y = null
		$('geode_name').value = e.name
		App.enterWorkspace()
		App.status(e.transient ? 'off' : GeodeStore.available ? 'saved' : 'error')
		pipeline = null
		if (e.source === 'photo') {
			let key = photoKey(e)
			if (!PHOTO_DATA[key]) PHOTO_DATA[key] = await blobToDataURL(e.photo) // data URL, not blob URL: canvas readback must stay allowed under file://
			App.setEntryPhotoOption(e)
			calibration_photo.value = key
			loadCalibrationPhoto(key)
		} else if (e.source !== 'dev') {
			App.setEntryPhotoOption(null)
			calibration_photo.value = 'geode01' // debug only: step 1 of a random geode shows a built-in photo
		}
		if (e.vein) {
			let p = veinFromExport(e.vein)
			processVein(p.vein, p.seed)
			if (e.source === 'photo') pipeline.source = photoKey(e)
			addDebugInfo()
		}
		let step = e.step || (hasPhoto() ? 1 : 2)
		if (!['current', 'done', 'todo'].includes(App.stepState(step))) step = hasPhoto() ? 1 : 2
		App.goStep(step, true)
	},

	/** A new saved geode: random from the generator settings, or from an imported vein ({seed, vein} as veinFromExport()) */
	async newGeode(parsed) {
		await App.flushPending()
		let seed = parsed ? parsed.seed : Math.floor(Math.random() * 0xffffffff)
		if (parsed) processVein(parsed.vein, parsed.seed)
		else newRun(seed)
		let now = Date.now(), vein = sparseOfPipeline()
		let e = { id: newId(), name: parsed ? 'Imported geode' : 'Random geode #' + String(seed % 10000).padStart(4, '0'), source: parsed ? 'import' : 'random', seed, created: now, updated: now, step: 2, maxStep: 2, vein, thumb: isoThumb(vein) }
		try { await GeodeStore.put(e) } catch (err) { console.warn(err) }
		App.open(e)
	},

	async fromFile(file) {
		if (!file || !file.type || !file.type.startsWith('image/')) { if (file) App.toast('That is not an image: pick a PNG or JPG screenshot'); return }
		let url = await blobToDataURL(file), now = Date.now()
		let e = { id: newId(), name: (file.name || 'Screenshot').replace(/\.[^.]+$/, '') || 'Screenshot', source: 'photo', photo: file, created: now, updated: now, step: 1, maxStep: 1, edits: [], vein: null, thumb: await photoThumb(url) }
		PHOTO_DATA[photoKey(e)] = url
		try { await GeodeStore.put(e) } catch (err) { console.warn(err); App.toast('This screenshot could not be saved: it will be lost when you close the page') }
		App.open(e)
	},

	/** usePhotoVein() (js/stage1/photo-vein.js): the scan of `key` produced a vein. Stored in the geode when it is this geode's screenshot. */
	onPhotoVein(key, count, fromScan) {
		let entry = App.entry
		if (!entry || entry.source !== 'photo' || key !== photoKey(entry)) return
		let first = !entry.vein
		entry.vein = sparseOfPipeline()
		entry.blocks = count
		App.save()
		App.updateHud()
		if (first) App.toast('<b>' + count + ' blocks found.</b> Step 1 shows them on the photo.')
		if (fromScan && currentStage === 1) setTimeout(App.playBuild, 0) // after usePhotoVein() has finished
	},

	// manual cube corrections of the open geode's screenshot (load/saveManualEdits in js/stage1/manual-edits.js)
	editsFor(key) { let entry = App.entry; return entry && entry.source === 'photo' && key === photoKey(entry) ? (entry.edits || []).slice() : null },
	saveEdits(key, edits) {
		let entry = App.entry
		if (!entry || entry.source !== 'photo' || key !== photoKey(entry)) return false
		entry.edits = edits.slice()
		App.save()
		return true
	},
})
