/** Autosave of the open geode (App.entry): debounced, and flushed when the page is hidden or another geode opens */
Object.assign(App, (() => {
	let saveTimer = null

	function status(st) {
		let el = $('save_status')
		el.dataset.state = st
		el.textContent = { saving: 'Saving…', saved: 'Saved', off: 'Not saved', error: 'Not saved: storage unavailable' }[st]
		el.title = st === 'saved' && App.entry ? 'Saved in this browser, ' + new Date(App.entry.updated).toLocaleString() : ''
	}
	function save() {
		let entry = App.entry
		if (!entry || entry.transient) return
		entry.updated = Date.now()
		status('saving')
		clearTimeout(saveTimer)
		saveTimer = setTimeout(flush, 400)
	}
	async function flush() {
		clearTimeout(saveTimer); saveTimer = null
		let entry = App.entry
		if (!entry || entry.transient) return
		try { await GeodeStore.put(entry); status(GeodeStore.available ? 'saved' : 'error') } catch (e) { console.warn('autominer: save failed', e); status('error') }
	}
	/** Writes a pending save now (before App.entry changes, or when the page goes away) */
	async function flushPending() { if (saveTimer) await flush() }

	return { status, save, flushPending }
})())
