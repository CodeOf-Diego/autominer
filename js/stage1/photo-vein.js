/**
 * Stages 2-7 work on the cubes of the photo shown in stage 1 (after the manual corrections) instead of a random vein. The lattice
 * axes are a mirror image of Minecraft's (cameraAxes: right x down = -forward, determinant -1), so x is flipped to keep the geode's
 * handedness; j is up. The random vein ('r' or the generate button) still works and stays until the next photo result.
 */
function usePhotoVein(fromScan) {
	let { cubes } = finalCubes()
	if (!cubes.length) return
	const M = 2 // empty cells around it, as the random vein has
	let lo = [0, 1, 2].map((a) => Math.min(...cubes.map((c) => [c.i, c.j, c.k][a]))), hi = [0, 1, 2].map((a) => Math.max(...cubes.map((c) => [c.i, c.j, c.k][a])))
	let ores = cubes.map((c) => [hi[0] - c.i + M, c.j - lo[1] + M, c.k - lo[2] + M])
	let parsed = veinFromExport({ seed: 1, size: [0, 1, 2].map((a) => hi[a] - lo[a] + 1 + 2 * M), ores })
	processVein(parsed.vein, parsed.seed)
	pipeline.source = manualEditsPhoto
	pipeline.photoMap = { lo, hi, M, origin: autoCubes.origin.slice(), ax: autoCubes.ax, fov: autoCubes.fov } // for photoCameraPose()
	addDebugInfo()
	App.onPhotoVein(manualEditsPhoto, cubes.length, fromScan)
	if (currentStage !== 1) renderStage(currentStage)
}

/**
 * The 3D camera that sees the geode exactly as the stage-1 photo shows it on screen right now, so going from step 1 to 2
 * swaps the photo for the 3D blocks without anything visibly moving. Must be called while the photo is still shown
 * (it reads where the canvas sits, zoom included). Returns null when the vein shown isn't this photo's.
 *
 * Camera space is the calibration's: x right, y down, z forward, 1 unit = 1 block. A display cell at world w (three.js,
 * geode centered at the origin, see renderStage's `center`) is lattice cell (i, j, k) = (hi0 + M - x, y + lo1 - M,
 * z + lo2 - M) with x/y/z = w + (size - 1) / 2 (see usePhotoVein), so camera point = R w + P0, R's columns being
 * (-ex, ey, ez) - a proper rotation, the x flip undoing the lattice's mirror image.
 * Returns { position, right, up, back, target } (world THREE.Vector3s), focal (screen px) and the principal point (screen px).
 */
function photoCameraPose() {
	let pm = pipeline && pipeline.photoMap
	if (!pm || !autoCubes || pipeline.source !== manualEditsPhoto || calibration_view.style.display === 'none') return null
	let rect = calibration_canvas.getBoundingClientRect()
	if (!rect.width || !rect.height) return null
	let { ex, ey, ez } = pm.ax, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
	let C = [0, 1, 2].map((a) => (pm.hi[a] - pm.lo[a] + 2 * pm.M) / 2) // (size - 1) / 2
	let ci = pm.hi[0] + pm.M - C[0], cj = C[1] + pm.lo[1] - pm.M, ck = C[2] + pm.lo[2] - pm.M
	let P0 = [0, 1, 2].map((a) => pm.origin[a] + ci * ex[a] + cj * ey[a] + ck * ez[a]) // camera-space point of the world origin
	// rows of R = the camera's own axes (x right, y down, z forward) written in world coordinates
	let row = (b) => new THREE.Vector3(-ex[b], ey[b], ez[b])
	let right = row(0), down = row(1), forward = row(2)
	let position = new THREE.Vector3(dot(ex, P0), -dot(ey, P0), -dot(ez, P0)) // -R^T P0
	let target = position.clone().addScaledVector(forward, P0[2]) // on the optical axis, as deep as the geode's center
	return {
		position, target, right, up: down.clone().negate(), back: forward.clone().negate(),
		focal: (rect.height / 2) / Math.tan(pm.fov * Math.PI / 360),
		px: rect.left + rect.width / 2, py: rect.top + rect.height / 2,
	}
}
