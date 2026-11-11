/**
 * The saved geodes: IndexedDB database 'autominer', store 'geodes', one record per geode (the record is described in
 * js/App.js). When IndexedDB is unavailable (some private windows) everything is kept in memory instead, so the app
 * still works but nothing survives a reload: `available` tells which.
 */
const GeodeStore = (() => {
	let db = null, memStore = new Map()

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

	return {
		open: async () => { db = await openDB() },
		get available() { return !!db },
		all: async () => db ? tx('readonly', (s) => s.getAll()) : [...memStore.values()],
		put: async (e) => db ? tx('readwrite', (s) => s.put(e)) : memStore.set(e.id, e),
		del: async (id) => db ? tx('readwrite', (s) => s.delete(id)) : memStore.delete(id),
		clear: async () => db ? tx('readwrite', (s) => s.clear()) : memStore.clear(),
	}
})()
