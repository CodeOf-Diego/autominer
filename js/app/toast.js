/** A short message at the bottom of the page, gone after 3 s (HTML allowed) */
Object.assign(App, (() => {
	let toastTimer = null
	function toast(text) {
		let el = $('toast')
		el.innerHTML = text
		el.classList.add('show')
		clearTimeout(toastTimer)
		toastTimer = setTimeout(() => el.classList.remove('show'), 3200)
	}
	return { toast }
})())
