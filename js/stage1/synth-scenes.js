/** The synthetic test scenes (reference/synthetic/tools/synth_page.js), with known truth: the same seeds as the tests. Generated when first picked, not stored: inlining the images would add ~10 MB. */
const SYNTH_SCENES = [
	...[1, 2, 3, 5, 6, 7, 9, 10].map((seed) => ({ key: 'synth-far-' + seed, group: 'Synthetic, far', label: 'far, seed ' + seed, seed, opts: {} })),
	...[1, 2, 3, 4, 5, 6, 7, 8].map((seed) => ({ key: 'synth-close-' + seed, group: 'Synthetic, close-up', label: 'close-up, seed ' + seed, seed, opts: { DR: [6, 10], RR: [3.5, 5] } })),
	...[4, 11, 12, 13].map((seed) => ({ key: 'synth-dark-' + seed, group: 'Synthetic, dark', label: 'dark, seed ' + seed, seed, opts: { bright: 0.35 } })),
]
let synthLoadToken = 0
let autoTruth = null // the true cubes and camera of the scene shown, when it is a synthetic one

/** Adds the synthetic scenes to the photo menu (only if the generator is there) */
function addSynthScenesToMenu() {
	if (!window.makeSynth) return
	let groups = new Map()
	for (let s of SYNTH_SCENES) {
		if (!groups.has(s.group)) { let g = document.createElement('optgroup'); g.label = s.group; calibration_photo.appendChild(g); groups.set(s.group, g) }
		let o = document.createElement('option'); o.value = s.key; o.textContent = s.label
		groups.get(s.group).appendChild(o)
	}
}

/** Generates a scene into PHOTO_DATA, drawing every face with the project's texture */
async function prepareSynthScene(scene) {
	if (!window.__tex) {
		let im = await new Promise((res) => { let i = new Image(); i.onload = () => res(i); i.src = TEXTURE_DATA.amethyst_block })
		let c = document.createElement('canvas'); c.width = 16; c.height = 16
		let g = c.getContext('2d'); g.drawImage(im, 0, 0)
		window.__tex = g.getImageData(0, 0, 16, 16).data
	}
	let s = makeSynth(scene.seed, scene.opts)
	PHOTO_DATA[scene.key] = s.url
	scene.truth = s.truth
}

/** The cubes found against the true ones, as integer cells up to the best global translation (absolute depth is ambiguous with FOV) */
function scoreAgainstTruth(A, T) {
	let truth = new Set(T.cubes.map((g) => g.c.join(','))), best = 0
	for (let dx = -14; dx <= 14; dx++) for (let dy = -14; dy <= 14; dy++) for (let dz = -14; dz <= 14; dz++) {
		let n = 0
		for (let c of A.cubes) if (truth.has((c.i + dx) + ',' + (c.j + dy) + ',' + (c.k + dz))) n++
		if (n > best) best = n
	}
	return { recall: best / T.cubes.length, precision: best / Math.max(1, A.cubes.length), dFov: A.fov - T.fov, dPitch: A.pitch - T.pitch, dYaw: ((A.yaw - T.yaw + 45 + 900) % 90) - 45 }
}
