/** The pictures of the saved geodes list, stored in each record as data URLs */

/** Small isometric picture of the amethyst cells (sparse vein), Minecraft face shading */
function isoThumb(sparse, w = 216, h = 160) {
	let cv = document.createElement('canvas'); cv.width = w; cv.height = h
	let ctx = cv.getContext('2d'), ores = sparse.ores
	if (!ores.length) return cv.toDataURL()
	let set = new Set(ores.map((p) => p.join(','))), lo = [0, 1, 2].map((a) => Math.min(...ores.map((p) => p[a]))), hi = [0, 1, 2].map((a) => Math.max(...ores.map((p) => p[a])))
	let c = lo.map((v, a) => (v + hi[a]) / 2), ext = Math.max(...hi.map((v, a) => v - lo[a] + 1))
	let cy = Math.cos(-0.7), sy = Math.sin(-0.7), cp = Math.cos(0.5), sp = Math.sin(0.5), S = Math.min(w, h) / (ext * 1.6)
	let proj = (x, y, z) => { x -= c[0]; y -= c[1]; z -= c[2]; let x1 = x * cy - z * sy, z1 = x * sy + z * cy; return [w / 2 + x1 * S, h / 2 - (y * cp - z1 * sp) * S, y * sp + z1 * cp] }
	let faces = []
	for (let a = 0; a < 3; a++) for (let s of [1, -1]) {
		let u = (a + 1) % 3, v = (a + 2) % 3, n = [0, 0, 0]; n[a] = s
		let nz = n[1] * sp + (n[0] * sy + n[2] * cy) * cp
		if (nz <= 0) continue
		let corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([cu, cv]) => { let p = [0, 0, 0]; p[a] = s * 0.5; p[u] = cu * 0.5; p[v] = cv * 0.5; return p })
		faces.push({ a, s, corners, shade: a === 1 ? (s > 0 ? 1 : 0.5) : a === 0 ? 0.6 : 0.8 })
	}
	let list = ores.map((p) => ({ p, d: proj(...p)[2] })).sort((A, B) => A.d - B.d)
	ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(20,10,40,0.35)'
	for (let { p } of list) for (let f of faces) {
		let q = p.slice(); q[f.a] += f.s
		if (set.has(q.join(','))) continue
		let pts = f.corners.map((k) => proj(p[0] + k[0], p[1] + k[1], p[2] + k[2]))
		ctx.beginPath(); pts.forEach((t, i) => i ? ctx.lineTo(t[0], t[1]) : ctx.moveTo(t[0], t[1])); ctx.closePath()
		ctx.fillStyle = 'rgb(' + [164, 108, 240].map((x) => Math.round(x * f.shade)).join(',') + ')'
		ctx.fill(); ctx.stroke()
	}
	return cv.toDataURL()
}
function blobToDataURL(blob) {
	return new Promise((res, rej) => { let fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob) })
}
function loadImage(src) {
	return new Promise((res, rej) => { let im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src })
}
/** The screenshot cropped to cover w x h, as a JPEG */
async function photoThumb(dataUrl, w = 216, h = 160) {
	let im = await loadImage(dataUrl), cv = document.createElement('canvas'); cv.width = w; cv.height = h
	let s = Math.max(w / im.width, h / im.height)
	cv.getContext('2d').drawImage(im, (w - im.width * s) / 2, (h - im.height * s) / 2, im.width * s, im.height * s)
	return cv.toDataURL('image/jpeg', 0.8)
}
