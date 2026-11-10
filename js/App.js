/**
 * The app shell around the pipeline (index.html + app.css): the landing page, the saved geodes, the 7-step HUD, the
 * settings and the debug switch. The pipeline itself stays in main.js; this file only drives it (newRun, processVein,
 * loadCalibrationPhoto, renderStage) and stores what the user did.
 *
 * Saved geodes live in IndexedDB (database 'autominer', store 'geodes'), one record per geode:
 *   {id, name, source: 'photo'|'random'|'import', created, updated, step, maxStep,
 *    vein: {seed, size, ores} | null   (the amethyst cells, as veinToSparse(); for a photo, set once the scan has found them)
 *    photo: Blob (the original screenshot, photo only), edits: [...] (manual cube corrections, photo only), thumb: data URL}
 * Every change (step, name, edits, scan result) is written back within half a second, and right away when the page
 * is hidden or closed, so nothing is lost if the tab times out. IndexedDB rather than localStorage because screenshots
 * are several MB and localStorage holds about 5 MB in all.
 */
const App = (() => {
	const STEPS = [
		{ n: 1, title: 'Scan', short: 'Find the blocks in your screenshot',
			desc: 'We find the purple budding amethyst in your screenshot, work out where the camera was and rebuild every block in 3D.',
			icon: 'M4 7h3l2-2h6l2 2h3v12H4z M12 9.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z' },
		{ n: 2, title: 'Geode', short: 'Your geode in 3D',
			desc: 'The budding amethyst blocks: the ones that grow crystals. Everything after this is built around them. Drag to rotate, scroll to zoom.',
			icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5',
			legend: [['#a46cf0', 'budding amethyst']] },
		{ n: 3, title: 'Borders', short: 'Where crystals grow',
			desc: 'Three machines harvest the geode, one along each axis (X, Y, Z), so beside it you see the geode flattened once per axis. In yellow: every free spot next to a budding block, where a crystal can grow.',
			icon: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',
			legend: [['#ffff00', 'crystal spot']] },
		{ n: 4, title: 'Reachable', short: 'Keep what can be harvested',
			desc: 'Spots that are too small, or that a machine cannot sweep, are dropped. What is left is what will actually be harvested.',
			icon: 'M4 4h16v16H4z M8 12l3 3 5-6',
			legend: [['#ffff00', 'spot kept']] },
		{ n: 5, title: 'Groups', short: 'Split into groups of 12',
			desc: 'A piston pushes at most 12 blocks, so the spots are joined, with extra support blocks where needed, into groups of 12 or fewer, using as few groups as possible.',
			icon: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
			legend: [['conic-gradient(#2563eb 0 25%, #16a34a 0 50%, #f59e0b 0 75%, #7c3aed 0)', 'one colour per group']] },
		{ n: 6, title: 'Materials', short: 'Slime or honey',
			desc: 'Slime does not stick to honey. Groups that touch get different materials, so a piston never drags two of them at once.',
			icon: 'M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z',
			legend: [['#7bd35a', 'slime'], ['#f2b63a', 'honey']] },
		{ n: 7, title: 'Machines', short: 'Build the flying machines',
			desc: 'One flying machine per group, pushing into the geode along its axis. Turn on the layer view (top right) to build it in game one layer at a time.',
			icon: 'M3 9h8v6H3z M11 11h6v2h-6z M17 6h4v12h-4z' },
	]
	const HERO_SEED = 20251, HERO_STAGE = 6
	const LAST_KEY = 'autominer.last', PREFS_KEY = 'autominer.prefs', DEBUG_KEY = 'autominer.debug', CARD_KEY = 'autominer.cardCollapsed'

	const $ = (id) => document.getElementById(id)
	const lsGet = (k) => { try { return localStorage.getItem(k) } catch (e) { return null } }
	const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch (e) {} }
	const svg = (d) => '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>'
	const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

	let db = null, memStore = new Map() // memStore: fallback when IndexedDB is unavailable (nothing survives a reload then)
	let entry = null, saveTimer = null, debug = false, toastTimer = null

	// ---------- storage ----------
	function openDB() {
		return new Promise((res) => {
			try {
				let r = indexedDB.open('autominer', 1)
				r.onupgradeneeded = () => r.result.createObjectStore('geodes', { keyPath: 'id' })
				r.onsuccess = () => res(r.result)
				r.onerror = () => res(null)
				r.onblocked = () => res(null)
			} catch (e) { res(null) }
		})
	}
	function tx(mode, fn) {
		return new Promise((res, rej) => {
			let t = db.transaction('geodes', mode), req = fn(t.objectStore('geodes'))
			t.oncomplete = () => res(req && req.result)
			t.onerror = t.onabort = () => rej(t.error)
		})
	}
	const dbAll = async () => db ? tx('readonly', (s) => s.getAll()) : [...memStore.values()]
	const dbPut = async (e) => db ? tx('readwrite', (s) => s.put(e)) : memStore.set(e.id, e)
	const dbDel = async (id) => db ? tx('readwrite', (s) => s.delete(id)) : memStore.delete(id)
	const dbClear = async () => db ? tx('readwrite', (s) => s.clear()) : memStore.clear()

	function status(st) {
		let el = $('save_status')
		el.dataset.state = st
		el.textContent = { saving: 'Saving…', saved: 'Saved', off: 'Not saved', error: 'Not saved: storage unavailable' }[st]
		el.title = st === 'saved' && entry ? 'Saved in this browser, ' + new Date(entry.updated).toLocaleString() : ''
	}
	function save() {
		if (!entry || entry.transient) return
		entry.updated = Date.now()
		status('saving')
		clearTimeout(saveTimer)
		saveTimer = setTimeout(flush, 400)
	}
	async function flush() {
		clearTimeout(saveTimer); saveTimer = null
		if (!entry || entry.transient) return
		try { await dbPut(entry); status(db ? 'saved' : 'error') } catch (e) { console.warn('autominer: save failed', e); status('error') }
	}

	function loadPrefs() {
		try {
			let p = JSON.parse(lsGet(PREFS_KEY) || '{}')
			for (let k of ['gap', 'density', 'range', 'slimePreference']) if (typeof p[k] === 'number') settings[k] = p[k]
			if (p.invert) Object.assign(settings.invert, p.invert)
			if (p.show) Object.assign(settings.show, p.show)
			settings.skipAnimation = !!p.skipAnimation
		} catch (e) {}
	}
	function savePrefs() {
		lsSet(PREFS_KEY, JSON.stringify({ gap: settings.gap, density: settings.density, range: settings.range, slimePreference: settings.slimePreference, invert: settings.invert, show: settings.show, skipAnimation: !!settings.skipAnimation }))
	}

	// ---------- thumbnails ----------
	/** Small isometric picture of the amethyst cells (sparse vein), Minecraft face shading */
	function isoThumb(sparse, w = 216, h = 160) {
		let cv = document.createElement('canvas'); cv.width = w; cv.height = h
		let ctx = cv.getContext('2d'), ores = sparse.ores
		if (!ores.length) return cv.toDataURL()
		let set = new Set(ores.map((p) => p.join(','))), lo = [0, 1, 2].map((a) => Math.min(...ores.map((p) => p[a]))), hi = [0, 1, 2].map((a) => Math.max(...ores.map((p) => p[a])))
		let c = lo.map((v, a) => (v + hi[a]) / 2), ext = Math.max(...hi.map((v, a) => v - lo[a] + 1))
		let cy = Math.cos(-0.7), sy = Math.sin(-0.7), cp = Math.cos(0.5), sp = Math.sin(0.5), S = Math.min(w, h) / (ext * 1.6)
		let proj = (x, y, z) => { x -= c[0]; y -= c[1]; z -= c[2]; let x1 = x * cy - z * sy, z1 = x * sy + z * cy; return [w / 2 + x1 * S, h / 2 - (y * cp - z1 * sp) * S, y * sp + z1 * cp] }
		let faces = []
		for (let a = 0; a < 3; a++) for (let s of [1, -1]) {
			let u = (a + 1) % 3, v = (a + 2) % 3, n = [0, 0, 0]; n[a] = s
			let nz = n[1] * sp + (n[0] * sy + n[2] * cy) * cp
			if (nz <= 0) continue
			let corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([cu, cv]) => { let p = [0, 0, 0]; p[a] = s * 0.5; p[u] = cu * 0.5; p[v] = cv * 0.5; return p })
			faces.push({ a, s, corners, shade: a === 1 ? (s > 0 ? 1 : 0.5) : a === 0 ? 0.6 : 0.8 })
		}
		let list = ores.map((p) => ({ p, d: proj(...p)[2] })).sort((A, B) => A.d - B.d)
		ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(20,10,40,0.35)'
		for (let { p } of list) for (let f of faces) {
			let q = p.slice(); q[f.a] += f.s
			if (set.has(q.join(','))) continue
			let pts = f.corners.map((k) => proj(p[0] + k[0], p[1] + k[1], p[2] + k[2]))
			ctx.beginPath(); pts.forEach((t, i) => i ? ctx.lineTo(t[0], t[1]) : ctx.moveTo(t[0], t[1])); ctx.closePath()
			ctx.fillStyle = 'rgb(' + [164, 108, 240].map((x) => Math.round(x * f.shade)).join(',') + ')'
			ctx.fill(); ctx.stroke()
		}
		return cv.toDataURL()
	}
	function blobToDataURL(blob) {
		return new Promise((res, rej) => { let fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob) })
	}
	function loadImage(src) {
		return new Promise((res, rej) => { let im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src })
	}
	async function photoThumb(dataUrl, w = 216, h = 160) {
		let im = await loadImage(dataUrl), cv = document.createElement('canvas'); cv.width = w; cv.height = h
		let s = Math.max(w / im.width, h / im.height)
		cv.getContext('2d').drawImage(im, (w - im.width * s) / 2, (h - im.height * s) / 2, im.width * s, im.height * s)
		return cv.toDataURL('image/jpeg', 0.8)
	}

	// ---------- helpers ----------
	function timeAgo(ts) {
		let s = (Date.now() - ts) / 1000
		if (s < 45) return 'just now'
		if (s < 3600) return Math.round(s / 60) + ' min ago'
		if (s < 86400) return Math.round(s / 3600) + ' h ago'
		let d = Math.round(s / 86400)
		return d === 1 ? 'yesterday' : d < 30 ? d + ' days ago' : new Date(ts).toLocaleDateString()
	}
	const newId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
	const photoKey = (e) => 'entry:' + e.id
	const sparseOfPipeline = () => Object.assign({ seed: pipeline.seed }, veinToSparse(pipeline.vein.matrix))
	const hasPhoto = () => entry && (entry.source === 'photo' || entry.source === 'dev')
	const pipelineReady = () => pipeline !== null && (entry.source !== 'photo' || !!entry.vein)

	function toast(text) {
		let el = $('toast')
		el.innerHTML = text
		el.classList.add('show')
		clearTimeout(toastTimer)
		toastTimer = setTimeout(() => el.classList.remove('show'), 3200)
	}

	// ---------- landing ----------
	async function showLanding() {
		if (saveTimer) await flush()
		entry = null
		autoCalToken++ // a scan still running for the geode just closed stops here
		autoCalState = 'idle'
		probe = null
		layerView.enabled = false
		document.body.dataset.screen = 'landing'
		$('settings_modal').hidden = true
		calibration_view.style.display = 'none'
		ST.setView({ x0: window.innerWidth > 760 ? Math.round(window.innerWidth * 0.36) : 0, ortho: false })
		ST.controls.autoRotate = true
		ST.controls.autoRotateSpeed = 0.8
		if (!pipeline) { newRun(HERO_SEED); addDebugInfo() }
		renderStage(HERO_STAGE)
		ST.frame(new THREE.Vector3(-12, 10, 12))
		await renderLibrary()
	}

	async function renderLibrary() {
		let list = []
		try { list = await dbAll() } catch (e) { console.warn(e) }
		list.sort((a, b) => b.updated - a.updated)
		let box = $('lib_list')
		box.innerHTML = ''
		for (let e of list) {
			let ring = 2 * Math.PI * 10, f = (e.maxStep || 1) / 7
			let el = document.createElement('div')
			el.className = 'row-g'
			el.tabIndex = 0
			el.innerHTML = '<img src="' + (e.thumb || '') + '" alt=""><span class="grow"><b>' + esc(e.name) + '</b><small>' + (e.source === 'photo' ? 'Screenshot' : e.source === 'import' ? 'Imported' : 'Random') + ' · ' + timeAgo(e.updated) + '</small></span>' +
				'<svg class="ring" viewBox="0 0 26 26" aria-label="step ' + e.maxStep + ' of 7"><circle cx="13" cy="13" r="10" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="3"/><circle cx="13" cy="13" r="10" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + (ring * f) + ' ' + ring + '" transform="rotate(-90 13 13)"/></svg>' +
				'<button class="del" title="Delete">✕</button>'
			el.addEventListener('click', async (ev) => {
				if (ev.target.closest('.del')) {
					if (!confirm('Delete "' + e.name + '"? This cannot be undone.')) return
					await dbDel(e.id)
					if (lsGet(LAST_KEY) === e.id) lsSet(LAST_KEY, '')
					renderLibrary()
					return
				}
				open(e)
			})
			el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(e) })
			box.appendChild(el)
		}
		$('saved_count').textContent = list.length ? list.length + (list.length === 1 ? ' geode' : ' geodes') + ' saved in this browser' : 'Nothing saved yet: geodes you open are kept here automatically'
		$('saved').classList.toggle('empty', !list.length)
		let last = list.find((e) => e.id === lsGet(LAST_KEY)), cont = $('continue_btn')
		cont.hidden = !last
		if (last) {
			cont.querySelector('[data-name]').textContent = last.name
			cont.querySelector('[data-step]').textContent = 'step ' + last.step + '/7'
			cont.onclick = () => open(last)
		}
		if (!db) $('saved_count').textContent = 'This browser does not allow saving: geodes are kept only until you close the page'
	}

	// ---------- workspace ----------
	function enterWorkspace() {
		document.body.dataset.screen = 'workspace'
		ST.controls.autoRotate = false
		ST.setView({ x0: 0, ortho: debug })
		ST.camera.position.set(-12, 10, 12); ST.controls.target.set(0, 0, 0)
	}

	/** The photo option of the debug panel's photo menu: the screenshot of the geode open, if any */
	function setEntryPhotoOption(e) {
		let o = $('entry_photo_option')
		o.hidden = !e
		if (e) { o.value = photoKey(e); o.textContent = 'This geode: ' + e.name }
	}

	async function open(e) {
		if (saveTimer) await flush()
		entry = e
		if (!e.transient) lsSet(LAST_KEY, e.id)
		probe = null
		layerView.enabled = false; layerView.y = null
		$('geode_name').value = e.name
		enterWorkspace()
		status(e.transient ? 'off' : db ? 'saved' : 'error')
		pipeline = null
		if (e.source === 'photo') {
			let key = photoKey(e)
			if (!PHOTO_DATA[key]) PHOTO_DATA[key] = await blobToDataURL(e.photo) // data URL, not blob URL: canvas readback must stay allowed under file://
			setEntryPhotoOption(e)
			calibration_photo.value = key
			loadCalibrationPhoto(key)
		} else if (e.source !== 'dev') {
			setEntryPhotoOption(null)
			calibration_photo.value = 'geode01' // debug only: step 1 of a random geode shows a built-in photo
		}
		if (e.vein) {
			let p = veinFromExport(e.vein)
			processVein(p.vein, p.seed)
			if (e.source === 'photo') pipeline.source = photoKey(e)
			addDebugInfo()
		}
		let step = e.step || (hasPhoto() ? 1 : 2)
		if (!['current', 'done', 'todo'].includes(stepState(step))) step = hasPhoto() ? 1 : 2
		goStep(step, true)
	}

	/** A new saved geode: random from the generator settings, or from an imported vein ({seed, vein} as veinFromExport()) */
	async function newGeode(parsed) {
		if (saveTimer) await flush()
		let seed = parsed ? parsed.seed : Math.floor(Math.random() * 0xffffffff)
		if (parsed) processVein(parsed.vein, parsed.seed)
		else newRun(seed)
		let now = Date.now(), vein = sparseOfPipeline()
		let e = { id: newId(), name: parsed ? 'Imported geode' : 'Random geode #' + String(seed % 10000).padStart(4, '0'), source: parsed ? 'import' : 'random', seed, created: now, updated: now, step: 2, maxStep: 2, vein, thumb: isoThumb(vein) }
		try { await dbPut(e) } catch (err) { console.warn(err) }
		open(e)
	}

	async function fromFile(file) {
		if (!file || !file.type || !file.type.startsWith('image/')) { if (file) toast('That is not an image: pick a PNG or JPG screenshot'); return }
		let url = await blobToDataURL(file), now = Date.now()
		let e = { id: newId(), name: (file.name || 'Screenshot').replace(/\.[^.]+$/, '') || 'Screenshot', source: 'photo', photo: file, created: now, updated: now, step: 1, maxStep: 1, edits: [], vein: null, thumb: await photoThumb(url) }
		PHOTO_DATA[photoKey(e)] = url
		try { await dbPut(e) } catch (err) { console.warn(err); toast('This screenshot could not be saved: it will be lost when you close the page') }
		open(e)
	}

	function stepState(n) {
		if (!entry) return 'todo'
		if (n === 1 && !hasPhoto() && !debug) return 'skipped'
		if (n > 1 && !pipelineReady()) return 'locked'
		return n === currentStage ? 'current' : n <= (entry.maxStep || 1) ? 'done' : 'todo'
	}

	function goStep(n, force) {
		if (!entry) return
		n = Math.max(1, Math.min(7, n))
		if (n === currentStage && !force && document.body.dataset.step == n) return
		let st = stepState(n)
		if (st === 'skipped') return
		if (st === 'locked') { toast('Finish the scan first: the next steps need the blocks it finds'); return }
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
		save()
		updateHud()
	}

	function updateHud() {
		if (!entry) return
		let n = currentStage, s = STEPS[n - 1]
		document.body.dataset.step = n
		$('step_num').textContent = n
		$('step_short').textContent = s.short
		$('step_desc').textContent = s.desc
		$('step_bar').style.width = (n / 7 * 100) + '%'
		$('step_legend').innerHTML = (s.legend || []).map(([c, t]) => '<span><i style="background:' + c + '"></i>' + t + '</span>').join('')
		let box = $('stepper')
		box.innerHTML = ''
		for (let step of STEPS) {
			let st = stepState(step.n), li = document.createElement('li')
			li.className = 'st ' + st
			let tip = st === 'skipped' ? 'Scan: not needed for a geode without a screenshot' : st === 'locked' ? step.title + ': finish the scan first' : step.n + ' · ' + step.short
			li.innerHTML = svg(step.icon) + '<span class="lbl">' + step.title + '</span><span class="tip">' + tip + '</span>'
			li.setAttribute('aria-label', 'Step ' + step.n + ': ' + step.title)
			li.addEventListener('click', () => goStep(step.n))
			box.appendChild(li)
		}
		let next = $('next_btn'), nextState = n < 7 ? stepState(n + 1) : null
		next.hidden = n === 7
		next.disabled = nextState === 'locked'
		next.innerHTML = nextState === 'locked' ? 'Scanning…' : 'Next →'
		afterRender()
	}

	/** Called by renderStage() after each 3D render: the layer widget follows the stage's occupied range */
	function afterRender() {
		let w = $('layer_widget')
		if (!w) return
		let on = entry && layerView.enabled && currentStage > 1
		w.hidden = !on
		$('layers_btn').classList.toggle('on', !!on)
		if (on && layerView.min !== undefined) $('layer_label').textContent = 'Layer ' + (layerView.y - layerView.min + 1) + ' of ' + (layerView.max - layerView.min + 1)
	}

	function toggleLayers() {
		if (!entry || currentStage === 1) return
		layerView.enabled = !layerView.enabled
		renderStage(currentStage)
		if (layerView.enabled) toast('Layer view: <kbd>↑</kbd> <kbd>↓</kbd> to move between layers')
	}
	function moveLayer(d) { if (!layerView.enabled) return; layerView.y += d; renderStage(currentStage) }

	/** main.js usePhotoVein(): the scan of `key` produced a vein. Stored in the geode when it is this geode's screenshot. */
	function onPhotoVein(key, count, fromScan) {
		if (!entry || entry.source !== 'photo' || key !== photoKey(entry)) return
		let first = !entry.vein
		entry.vein = sparseOfPipeline()
		entry.blocks = count
		save()
		updateHud()
		if (first) toast('<b>' + count + ' blocks found.</b> Step 1 shows them on the photo.')
		if (fromScan && currentStage === 1) setTimeout(playBuild, 0) // after usePhotoVein() has finished
	}

	/**
	 * Right after a scan: plays steps 2 to 7 in about a second, starting from the photo's own viewpoint, so the build
	 * is seen coming together. Stops as soon as the user goes to another step. Settings > Skip the build animation
	 * jumps straight to step 7 instead.
	 */
	let playToken = 0
	function playBuild() {
		if (currentStage !== 1) return
		let token = ++playToken
		if (settings.skipAnimation) { goStep(7); ST.frame(); return }
		goStep(2)
		const STEP_MS = 200
		let next = (n) => setTimeout(() => {
			if (token !== playToken || currentStage !== n - 1) return
			goStep(n)
			if (n < 7) next(n + 1)
			else ST.frameSmooth(800) // the photo's viewpoint opens out to the whole build
		}, STEP_MS)
		next(3)
	}

	// manual cube corrections of the open geode's screenshot (main.js load/saveManualEdits)
	function editsFor(key) { return entry && entry.source === 'photo' && key === photoKey(entry) ? (entry.edits || []).slice() : null }
	function saveEdits(key, edits) {
		if (!entry || entry.source !== 'photo' || key !== photoKey(entry)) return false
		entry.edits = edits.slice()
		save()
		return true
	}

	function setDebug(on, persist = true) {
		debug = on
		document.body.dataset.debug = on ? '1' : '0'
		if (persist) lsSet(DEBUG_KEY, on ? '1' : '0')
		$('debug_toggle').checked = on
		ST.setDebug(on)
		if (document.body.dataset.screen !== 'workspace') return
		ST.setView({ ortho: on })
		if (currentStage === 1) { if (calibrationImage.naturalWidth) redrawCalibrationCanvas() } else renderStage(currentStage)
		updateHud()
	}

	function resetView() {
		if (currentStage === 1) { resetPhotoZoom(); return }
		ST.frame(new THREE.Vector3(-12, 10, 12))
	}

	// ---------- wiring ----------
	async function init() {
		const actions = {
			upload: () => $('photo_input').click(),
			random: () => newGeode(),
			home: () => showLanding(),
			next: () => goStep(currentStage + 1),
			settings: () => { $('settings_modal').hidden = false },
			'close-settings': () => { $('settings_modal').hidden = true },
			'debug-off': () => setDebug(false),
			'reset-view': resetView,
			layers: toggleLayers,
			'layer-up': () => moveLayer(1),
			'layer-down': () => moveLayer(-1),
			'collapse-card': () => { let c = $('step_card').classList.toggle('collapsed'); lsSet(CARD_KEY, c ? '1' : '0') },
			'clear-library': async () => {
				if (!confirm('Delete every saved geode in this browser? This cannot be undone.')) return
				await dbClear(); lsSet(LAST_KEY, '')
				if (entry) { entry.transient = true; status('off') }
				$('settings_modal').hidden = true
				if (!entry) renderLibrary()
			},
		}
		document.addEventListener('click', (ev) => {
			let a = ev.target.closest('[data-action]')
			if (a && actions[a.dataset.action]) { ev.preventDefault(); actions[a.dataset.action]() }
		})
		$('settings_modal').addEventListener('click', (ev) => { if (ev.target === $('settings_modal')) $('settings_modal').hidden = true })
		document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') $('settings_modal').hidden = true })
		$('photo_input').addEventListener('change', () => { let f = $('photo_input').files[0]; $('photo_input').value = ''; fromFile(f) })
		$('debug_toggle').addEventListener('change', () => setDebug($('debug_toggle').checked))
		$('skip_anim_toggle').checked = !!settings.skipAnimation
		$('skip_anim_toggle').addEventListener('change', () => { settings.skipAnimation = $('skip_anim_toggle').checked; savePrefs() })
		$('geode_name').addEventListener('input', () => { if (entry) { entry.name = $('geode_name').value.trim() || 'Untitled geode'; save() } })
		$('geode_name').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.target.blur() })
		for (let id of ['gap_slider', 'density_slider', 'range_slider', 'slime_pref_slider', 'invert_x', 'invert_y', 'invert_z', 'show_x', 'show_y', 'show_z']) $(id).addEventListener('change', savePrefs)
		// a screenshot can be dropped anywhere on the landing page, or pasted (Ctrl+V)
		document.addEventListener('dragover', (ev) => { if (document.body.dataset.screen === 'landing') { ev.preventDefault(); document.body.classList.add('dragging') } })
		document.addEventListener('dragleave', (ev) => { if (!ev.relatedTarget) document.body.classList.remove('dragging') })
		document.addEventListener('drop', (ev) => {
			document.body.classList.remove('dragging')
			if (document.body.dataset.screen !== 'landing') return
			ev.preventDefault()
			fromFile(ev.dataTransfer.files[0])
		})
		document.addEventListener('paste', (ev) => {
			if (document.body.dataset.screen !== 'landing') return
			let item = [...(ev.clipboardData ? ev.clipboardData.items : [])].find((i) => i.type.startsWith('image/'))
			if (item) fromFile(item.getAsFile())
		})
		window.addEventListener('hashchange', () => { if (location.hash === '#dev') location.reload() }) // typing #dev on an open page: start the dev session
		const flushNow = () => { if (saveTimer) flush() }
		document.addEventListener('visibilitychange', () => { if (document.hidden) flushNow() })
		window.addEventListener('pagehide', flushNow)
		ST.onLayout = () => {
			if (document.body.dataset.screen === 'landing') ST.setView({ x0: window.innerWidth > 760 ? Math.round(window.innerWidth * 0.36) : 0 })
			else if (currentStage > 1 && pipeline) renderStage(currentStage) // group labels follow the viewports
		}
		if (lsGet(CARD_KEY) === '1') $('step_card').classList.add('collapsed')

		setDebug(lsGet(DEBUG_KEY) === '1', false)
		db = await openDB()

		if (location.hash === '#dev') { // the old developer session: debug on, random vein, built-in photo geode-01 on stage 1, nothing saved
			setDebug(true, false)
			newRun(); addDebugInfo()
			calibration_photo.value = 'geode01'
			loadCalibrationPhoto('geode01')
			entry = { id: 'dev', name: 'Dev session', source: 'dev', transient: true, step: 1, maxStep: 7 }
			$('geode_name').value = entry.name
			enterWorkspace()
			status('off')
			goStep(1, true)
			return
		}
		showLanding()
	}

	return {
		STEPS, init, loadPrefs, toast, newGeode, goStep, toggleLayers, afterRender, onPhotoVein, editsFor, saveEdits,
		get debug() { return debug },
		inWorkspace: () => !!entry && document.body.dataset.screen === 'workspace',
		modalOpen: () => !$('settings_modal').hidden,
	}
})()
