/** Small page helpers of the app shell (js/App.js) */
const $ = (id) => document.getElementById(id)
/** localStorage that never throws (private windows, blocked site data) */
const lsGet = (k) => { try { return localStorage.getItem(k) } catch (e) { return null } }
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch (e) {} }
/** A 24x24 line icon from one SVG path */
const svg = (d) => '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>'
/** Escapes text for innerHTML */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** "just now", "5 min ago", "yesterday"... for the saved geodes list */
function timeAgo(ts) {
	let s = (Date.now() - ts) / 1000
	if (s < 45) return 'just now'
	if (s < 3600) return Math.round(s / 60) + ' min ago'
	if (s < 86400) return Math.round(s / 3600) + ' h ago'
	let d = Math.round(s / 86400)
	return d === 1 ? 'yesterday' : d < 30 ? d + ' days ago' : new Date(ts).toLocaleDateString()
}
