/**
 * Manual corrections of the automatic cubes, per photo, kept in this browser (localStorage): [{P, add}], P = camera-space centre
 * of the cell (blocks), add = true to add a cube the automatic choice missed, false to remove one it took. Stored by position, not by
 * cell index, so they survive a change of the lattice origin: each edit applies to the cell whose centre is within 0.3 of P.
 */
let manualEdits = [], manualEditsPhoto = null
// a saved geode keeps its edits in its own record (App.editsFor/saveEdits, autosaved); the built-in photos keep them in localStorage
function loadManualEdits(photo) {
	manualEditsPhoto = photo
	let own = App.editsFor(photo)
	if (own) { manualEdits = own; return }
	try { manualEdits = JSON.parse(localStorage.getItem('autominer.edits.' + photo) || '[]') } catch (e) { manualEdits = [] }
}
function saveManualEdits() {
	if (App.saveEdits(manualEditsPhoto, manualEdits)) return
	try { localStorage.setItem('autominer.edits.' + manualEditsPhoto, JSON.stringify(manualEdits)) } catch (e) {}
}

/** The lattice cell (i, j, k) whose centre is P (within 0.3 blocks), or null */
function cellAt(A, P) {
	let d = [P[0] - A.origin[0], P[1] - A.origin[1], P[2] - A.origin[2]], f = [A.ax.ex, A.ax.ey, A.ax.ez].map((e) => d[0] * e[0] + d[1] * e[1] + d[2] * e[2]), c = f.map(Math.round)
	return Math.hypot(f[0] - c[0], f[1] - c[1], f[2] - c[2]) < 0.3 ? c : null
}

/** The cubes after the manual corrections: {cubes, removed} (removed = automatic cubes the user took out; added ones have manual: true) */
function finalCubes() {
	if (!autoCubes) return { cubes: [], removed: [] }
	let key = (i, j, k) => i + ',' + j + ',' + k, out = new Map(autoCubes.cubes.map((c) => [key(c.i, c.j, c.k), c])), removed = []
	for (let e of manualEdits) {
		let c = cellAt(autoCubes, e.P)
		if (!c) continue
		let k = key(...c)
		if (e.add && !out.has(k)) out.set(k, { i: c[0], j: c[1], k: c[2], P: latticePoint(autoCubes, ...c), manual: true })
		if (!e.add && out.has(k)) { removed.push(out.get(k)); out.delete(k) }
	}
	return { cubes: [...out.values()], removed }
}

/** Puts the probe cell in the result or takes it out (key x): the manual choice overrides the automatic one */
function toggleProbeCube() {
	if (!probe || !probe.info || !autoCubes) return
	let I = probe.info, same = (c) => c && c[0] === I.i && c[1] === I.j && c[2] === I.k
	let wasIn = finalCubes().cubes.some((q) => same([q.i, q.j, q.k])), inAuto = autoCubes.cubes.some((q) => same([q.i, q.j, q.k]))
	manualEdits = manualEdits.filter((e) => !same(cellAt(autoCubes, e.P))) // back to the automatic state of this cell...
	if (inAuto === wasIn) manualEdits.push({ P: latticePoint(autoCubes, I.i, I.j, I.k), add: !wasIn }) // ...then flipped, if that does not flip it already
	saveManualEdits()
	redrawCalibrationCanvas()
	usePhotoVein()
}

function clearManualEdits() { manualEdits = []; saveManualEdits(); redrawCalibrationCanvas(); usePhotoVein() }
