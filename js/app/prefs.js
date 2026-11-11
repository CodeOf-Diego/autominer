/** The generator and view settings the user changed (sliders, axes, skip animation), kept in localStorage */
const PREFS_KEY = 'autominer.prefs'

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
