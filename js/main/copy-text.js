/** Copies text to the clipboard: the clipboard API, else the old textarea route (file://, permissions), else the console */
function copyText(text, doneMsg, onFail) {
	navigator.clipboard.writeText(text).then(() => flashStageMessage(doneMsg)).catch(() => {
		let ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select()
		let ok = false; try { ok = document.execCommand('copy') } catch (e) {}
		ta.remove()
		if (ok) flashStageMessage(doneMsg)
		else if (onFail) onFail()
		else { flashStageMessage('Copy failed: the text is in the console (F12)'); console.log(text) }
	})
}
