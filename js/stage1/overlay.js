/** Purple mask -> canvas (translucent purple where the mask is set), for the overlay tint */
function maskToCanvas(an) {
	let c = document.createElement('canvas')
	c.width = an.w; c.height = an.h
	let ctx = c.getContext('2d'), img = ctx.createImageData(an.w, an.h)
	for (let i = 0; i < an.w * an.h; i++) if (an.data[i]) { img.data[i * 4] = 255; img.data[i * 4 + 1] = 0; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 110 }
	ctx.putImageData(img, 0, 0)
	return c
}

/** The 12 edges of a cube as pairs of cubeCorners() indices */
const CUBE_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]

/**
 * The visible parts of the 12 edges of every cube (cube centres Ps in camera space), as 3D segments per cube.
 * A point X of an edge is visible when the camera ray to it does not pass through the inside of any cube before reaching X
 * (slab test on each box along the lattice axes). The cube itself is tested too: that hides its own back edges, while
 * front and outline edges only touch its surface. So the hidden edges are exact for every cube (also the bottom face of
 * the cubes above the camera), and edges behind nearer cubes are cut where they disappear. Sampled every ~3 px on screen.
 */
function visibleCubeEdges(Ps, ax, f, cx, cy) {
	const E = [ax.ex, ax.ey, ax.ez], EPS = 1e-6
	let boxes = Ps.map((P) => {
		let C = cubeCorners(P, ax), xs = [], ys = [], zMin = Infinity
		for (let q of C) { if (q[2] > 0.05) { xs.push(cx + f * q[0] / q[2]); ys.push(cy + f * q[1] / q[2]) } zMin = Math.min(zMin, q[2]) }
		let all = xs.length === 8 // a box crossing the camera plane: no screen box, always tested
		return { P, C, zMin, x0: all ? Math.min(...xs) : -Infinity, x1: all ? Math.max(...xs) : Infinity, y0: all ? Math.min(...ys) : -Infinity, y1: all ? Math.max(...ys) : Infinity, c: E.map((e) => P[0] * e[0] + P[1] * e[1] + P[2] * e[2]) }
	})
	const hidden = (X, sx, sy) => { // ray o = 0, d = X: t = 1 reaches X
		let dx = E.map((e) => X[0] * e[0] + X[1] * e[1] + X[2] * e[2])
		for (let b of boxes) {
			if (b.zMin >= X[2] || sx < b.x0 || sx > b.x1 || sy < b.y0 || sy > b.y1) continue
			let tIn = -Infinity, tOut = Infinity
			for (let a = 0; a < 3; a++) {
				if (Math.abs(dx[a]) < 1e-12) { if (Math.abs(b.c[a]) > 0.5) { tIn = Infinity; break } continue }
				let t1 = (b.c[a] - 0.5) / dx[a], t2 = (b.c[a] + 0.5) / dx[a]
				tIn = Math.max(tIn, Math.min(t1, t2)); tOut = Math.min(tOut, Math.max(t1, t2))
			}
			if (tOut - tIn > EPS && tIn < 1 - EPS) return true // the ray goes through this box's inside before reaching X
		}
		return false
	}
	return boxes.map((b) => {
		let out = []
		for (let [i, j] of CUBE_EDGES) {
			let A = b.C[i], B = b.C[j]
			if (A[2] < 0.3 && B[2] < 0.3) continue
			let pa = projectCam(A, f, cx, cy), pb = projectCam(B, f, cx, cy), n = Math.max(2, Math.min(200, Math.ceil(Math.hypot(pb.x - pa.x, pb.y - pa.y) / 3)))
			let start = -1
			for (let s = 0; s <= n; s++) {
				let vis = false
				if (s < n) {
					let t = (s + 0.5) / n, X = [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1]), A[2] + t * (B[2] - A[2])]
					vis = X[2] > 0.3 && !hidden(X, cx + f * X[0] / X[2], cy + f * X[1] / X[2])
				}
				if (vis && start < 0) start = s
				if (!vis && start >= 0) { let t0 = start / n, t1 = s / n; out.push([A.map((v, k) => v + t0 * (B[k] - v)), A.map((v, k) => v + t1 * (B[k] - v))]); start = -1 }
			}
		}
		return out
	})
}

/** Draws a 3D segment (camera-space endpoints A, B), clipped to the near plane, as a 2D line */
function drawSeg3D(ctx, A, B, f, cx, cy) {
	const NEAR = 0.3
	if (A[2] < NEAR && B[2] < NEAR) return
	if (A[2] < NEAR) { let t = (NEAR - A[2]) / (B[2] - A[2]); A = A.map((v, i) => v + t * (B[i] - v)) }
	else if (B[2] < NEAR) { let t = (NEAR - B[2]) / (A[2] - B[2]); B = B.map((v, i) => v + t * (A[i] - v)) }
	let a = projectCam(A, f, cx, cy), b = projectCam(B, f, cx, cy)
	ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
}

/** Overlays the 3D lattice (floor grid under the detected cubes) and the detected cubes as wireframes, both from the automatic camera fit */
function drawAutoOverlay(ctx, canvas) {
	if (autoMask && (autoCalState === 'running' || overlayOn(calibration_show_mask, false))) ctx.drawImage(autoMask, 0, 0, canvas.width, canvas.height)
	if (autoLines && (autoCalState === 'running' || overlayOn(calibration_show_lines, false))) {
		let sx = canvas.width / autoLines.w, sy = canvas.height / autoLines.h, AXIS_COL = ['#ff5050', '#50ff50', '#5aa0ff']
		ctx.lineWidth = 3
		for (let i = 0; i < autoLines.shown; i++) {
			let L = autoLines.segs[i]
			ctx.strokeStyle = L.axis === undefined ? '#ffffff' : L.axis < 0 ? 'rgba(160,160,160,0.8)' : AXIS_COL[L.axis]
			ctx.beginPath(); ctx.moveTo(L.x1 * sx, L.y1 * sy); ctx.lineTo(L.x2 * sx, L.y2 * sy); ctx.stroke()
		}
	}
	if (!autoCubes || !autoCubes.cubes.length) return
	let f = focalPx(autoCubes.fov, canvas.height), cx = canvas.width / 2, cy = canvas.height / 2
	let ax = autoCubes.ax, at = (i, j, k) => latticePoint(autoCubes, i, j, k)
	let { cubes, removed } = finalCubes() // the automatic choice with the manual corrections
	let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
	for (let c of cubes) { let v = [c.i, c.j, c.k]; for (let n = 0; n < 3; n++) { lo[n] = Math.min(lo[n], v[n]); hi[n] = Math.max(hi[n], v[n]) } }

	if (overlayOn(calibration_show_diff, false) && autoCal && autoCal.an) {
		// where the union of the detected cubes disagrees with the purple mask (mask resolution, drawn scaled up): red = covered but not purple, blue = purple but not covered
		let an = autoCal.an, fm = focalPx(autoCubes.fov, an.h), cov = new Uint8Array(an.w * an.h)
		for (let c of cubes) {
			let hl = cubeHull(at(c.i, c.j, c.k), ax, fm, an.w / 2, an.h / 2)
			if (hl) forEachPixelInHull(hl, an.w, an.h, (x, y) => { cov[y * an.w + x] = 1 })
		}
		let dc = document.createElement('canvas'); dc.width = an.w; dc.height = an.h
		let dctx = dc.getContext('2d'), di = dctx.createImageData(an.w, an.h)
		for (let i = 0; i < an.w * an.h; i++) {
			if (an.data[i] && !cov[i]) { di.data[i * 4] = 0; di.data[i * 4 + 1] = 140; di.data[i * 4 + 2] = 255; di.data[i * 4 + 3] = 200 }
			else if (cov[i] && !an.data[i]) { di.data[i * 4] = 255; di.data[i * 4 + 1] = 30; di.data[i * 4 + 2] = 30; di.data[i * 4 + 3] = 200 }
		}
		dctx.putImageData(di, 0, 0)
		ctx.imageSmoothingEnabled = false
		ctx.drawImage(dc, 0, 0, canvas.width, canvas.height)
		ctx.imageSmoothingEnabled = true
	}

	if (overlayOn(calibration_show_grid, true)) {
		ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.45)'
		let y = lo[1] - 0.5
		for (let i = lo[0] - 0.5; i <= hi[0] + 0.51; i++) drawSeg3D(ctx, at(i, y, lo[2] - 0.5), at(i, y, hi[2] + 0.5), f, cx, cy)
		for (let k = lo[2] - 0.5; k <= hi[2] + 0.51; k++) drawSeg3D(ctx, at(lo[0] - 0.5, y, k), at(hi[0] + 0.5, y, k), f, cx, cy)
	}
	if (overlayOn(calibration_show_cubes, true)) {
		ctx.lineWidth = 2
		let runs = visibleCubeEdges(cubes.map((c) => at(c.i, c.j, c.k)), ax, f, cx, cy)
		cubes.forEach((c, n) => {
			let t = hi[1] > lo[1] ? (c.j - lo[1]) / (hi[1] - lo[1]) : 0 // colour by height: low = yellow, high = orange/red; added by hand = cyan
			ctx.strokeStyle = c.manual ? '#22d3ee' : 'hsl(' + Math.round(55 - 55 * t) + ',100%,55%)'
			for (let [A, B] of runs[n]) drawSeg3D(ctx, A, B, f, cx, cy)
		})
		ctx.save(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([4, 4]) // taken out by hand: thin dashed, all 12 edges
		for (let c of removed) { let C = cubeCorners(c.P, ax); for (let [a, b] of CUBE_EDGES) drawSeg3D(ctx, C[a], C[b], f, cx, cy) }
		ctx.restore()
		if (overlayOn(calibration_show_labels, false)) {
			ctx.font = '12px sans-serif'; ctx.fillStyle = 'white'; ctx.strokeStyle = 'black'; ctx.lineWidth = 3
			for (let c of cubes) {
				let p = projectCam(at(c.i, c.j, c.k), f, cx, cy), txt = c.i + ',' + c.j + ',' + c.k
				ctx.strokeText(txt, p.x - 14, p.y + 4); ctx.fillText(txt, p.x - 14, p.y + 4)
			}
		}
	}
	if (probe && probe.info) drawProbe(ctx, canvas, at, f, cx, cy, ax)
}

/** The probe cube: its silhouette split into free+purple (green), free but not purple (red) and covered by nearer cubes (grey), and its 12 edges (the 3 hidden ones dashed) */
function drawProbe(ctx, canvas, at, f, cx, cy, ax) {
	let I = probe.info, an = autoCal.an
	if (App.debug && !probe.tint) {
		let tc = document.createElement('canvas'); tc.width = an.w; tc.height = an.h
		let tctx = tc.getContext('2d'), img = tctx.createImageData(an.w, an.h)
		const paint = (list, r, g, b, a) => { for (let q of list) { img.data[q * 4] = r; img.data[q * 4 + 1] = g; img.data[q * 4 + 2] = b; img.data[q * 4 + 3] = a } }
		paint(I.pix.free, 40, 255, 120, 110); paint(I.pix.freeNotPurple, 255, 40, 40, 170); paint(I.pix.covered, 150, 150, 150, 150)
		tctx.putImageData(img, 0, 0)
		probe.tint = tc
	}
	if (App.debug) { // the silhouette tint is a diagnostic: end users only see the cube outline
		ctx.imageSmoothingEnabled = false
		ctx.drawImage(probe.tint, 0, 0, canvas.width, canvas.height)
		ctx.imageSmoothingEnabled = true
	}
	let P = at(I.i, I.j, I.k), C = cubeCorners(P, ax)
	ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = I.taken ? '#22ff88' : '#ff4d4d'
	ctx.setLineDash([6, 5]); for (let [a, b] of CUBE_EDGES) drawSeg3D(ctx, C[a], C[b], f, cx, cy) // all 12 dashed (the hidden ones stay dashed)...
	ctx.setLineDash([]); for (let [A, B] of visibleCubeEdges([P], ax, f, cx, cy)[0]) drawSeg3D(ctx, A, B, f, cx, cy) // ...the visible ones solid on top
	ctx.restore()
}
