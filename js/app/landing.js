/** The landing page: the geode turning behind the panel, and the list of saved geodes */
Object.assign(App, {
	async showLanding() {
		await App.flushPending()
		App.entry = null
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
		await App.renderLibrary()
	},

	async renderLibrary() {
		let list = []
		try { list = await GeodeStore.all() } catch (e) { console.warn(e) }
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
					await GeodeStore.del(e.id)
					if (lsGet(LAST_KEY) === e.id) lsSet(LAST_KEY, '')
					App.renderLibrary()
					return
				}
				App.open(e)
			})
			el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') App.open(e) })
			box.appendChild(el)
		}
		$('saved_count').textContent = list.length ? list.length + (list.length === 1 ? ' geode' : ' geodes') + ' saved in this browser' : 'Nothing saved yet: geodes you open are kept here automatically'
		$('saved').classList.toggle('empty', !list.length)
		let last = list.find((e) => e.id === lsGet(LAST_KEY)), cont = $('continue_btn')
		cont.hidden = !last
		if (last) {
			cont.querySelector('[data-name]').textContent = last.name
			cont.querySelector('[data-step]').textContent = 'step ' + last.step + '/7'
			cont.onclick = () => App.open(last)
		}
		if (!GeodeStore.available) $('saved_count').textContent = 'This browser does not allow saving: geodes are kept only until you close the page'
	},
})
