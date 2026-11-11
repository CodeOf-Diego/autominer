/**
 * Cube position from lines: each row {l: line, oc: offset of its edge in camera coords, len: weight} gives n . (P + oc) = 0. Weighted least squares, the rows divided by the depth
 * of the edge so that the residual is in pixels; the depth comes from the previous solution, so 3 passes. Returns {P, rms} (rms in px) or null.
 */
function solveCubePosition(rows, f, Pinit) {
    let P = Pinit.slice()
    for (let it = 0; it < 3; it++) {
        let A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0]
        for (let r of rows) {
            let n = [r.l[0] * f, r.l[1] * f, r.l[2]], Z = Math.max(0.5, P[2] + r.oc[2]), wt = r.len / (Z * Z), rhs = -(n[0] * r.oc[0] + n[1] * r.oc[1] + n[2] * r.oc[2])
            for (let a = 0; a < 3; a++) { g[a] += wt * n[a] * rhs; for (let b = 0; b < 3; b++) A[a][b] += wt * n[a] * n[b] }
        }
        let sol = solve3x3(A, g)
        if (!sol) return null
        P = sol
    }
    let ss = 0, sw = 0
    for (let r of rows) { let X = [P[0] + r.oc[0], P[1] + r.oc[1], P[2] + r.oc[2]], d = r.l[0] * f * X[0] / X[2] + r.l[1] * f * X[1] / X[2] + r.l[2]; ss += r.len * d * d; sw += r.len }
    return { P, rms: Math.sqrt(ss / sw) }
}

/**
 * Cubes that are a blob of their own. Start: the blob's centroid and the depth that gives its area. Then every outline point, joined to the vanishing point of the nearest silhouette
 * edge, is a line: linear solve, re-assign, solve again. Then the silhouette edges are measured on the colour photo (sub-pixel) and solved again. The residual and the overlap with
 * the blob reject blobs of 2 touching cubes. A small far cube with edges too short to measure keeps the position from its outline if that fits one cube very well.
 * Returns [{P, z, segs (measured edges with .off, .axis), nLines}].
 */
function posesOfIsolatedCubes(cam, img, an, lab, opts) {
    let o = Object.assign({ minBlobPx: 150, minLines: 3, maxRms: 1.5, minIoU: 0.8, minIoU3: 0.88, contourIters: 5, measureIters: 2, contourOnlyIoU: 0.88, contourOnlyRms: 1 }, opts)
    let w = an.w, h = an.h, cx = w / 2, cy = h / 2, f = focalPx(cam.fov, h), ax = cameraAxes(cam.pitch, cam.yaw), label = lab.label
    let VP = [ax.ex, ax.ey, ax.ez].map((d) => [f * d[0], f * d[1], d[2]])
    const lineTo = (x, y, a) => { let X = x - cx, Y = y - cy, V = VP[a], l = [Y * V[2] - V[1], V[0] - X * V[2], X * V[1] - Y * V[0]], n = Math.hypot(l[0], l[1]) || 1; return [l[0] / n, l[1] / n, l[2] / n] }
    const edgeDist = (e, q) => { let ex = e.q[0] - e.p[0], ey = e.q[1] - e.p[1], L2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((q[0] - e.p[0]) * ex + (q[1] - e.p[1]) * ey) / L2)); return Math.hypot(q[0] - e.p[0] - t * ex, q[1] - e.p[1] - t * ey) }
    const iouOf = (P, b) => { let hl = cubeHull(P, ax, f, cx, cy), inter = 0, tot = 0; if (!hl) return 0; forEachPixelInHull(hl, w, h, (x, y) => { tot++; if (label[y * w + x] === b.id) inter++ }); return inter / (tot + b.n - inter) }
    let cand = []
    for (let b of lab.blobs) {
        if (b.n < o.minBlobPx) continue
        let D = 10, ray = (d) => [d * (b.u - cx) / f, d * (b.v - cy) / f, d]
        for (let it = 0; it < 4; it++) { let hl = cubeHull(ray(D), ax, f, cx, cy); if (!hl) break; D *= Math.sqrt(Math.abs(hullArea(hl)) / b.n) || 1; if (!isFinite(D) || D < 1 || D > 60) { D = 10; break } }
        let P = ray(D), outline = null
        for (let it = 0; it < o.contourIters; it++) {
            let edges = cubeEdges(P, ax, f, cx, cy).filter((e) => e.sil), rows = []
            for (let q of b.pts) {
                let be = null, bd = 1e9
                for (let e of edges) { let d = edgeDist(e, q); if (d < bd) { bd = d; be = e } }
                if (be && (it === 0 || bd <= 4)) rows.push({ l: lineTo(q[0], q[1], be.a), oc: latticeOffset(be.off, ax), len: 1 })
            }
            if (rows.length < 6) break
            let s = solveCubePosition(rows, f, P)
            if (!s || s.P[2] < 1) break
            P = s.P; outline = s
        }
        cand.push({ b, P, outline, measured: null, segs: [] })
    }
    for (let m = 0; m < o.measureIters; m++) { // all the edges of all the cubes measured in one call, then each cube solved again
        let wanted = []
        cand.forEach((c, i) => { for (let e of cubeEdges(c.P, ax, f, cx, cy)) { if (!e.sil) continue; let L = Math.hypot(e.q[0] - e.p[0], e.q[1] - e.p[1]); if (L > 6) wanted.push({ x1: e.p[0], y1: e.p[1], x2: e.q[0], y2: e.q[1], len: L, axis: e.a, cube: i, off: e.off }) } })
        let got = refineLinesRGB(img, an, wanted).filter((s) => s.refined)
        cand.forEach((c, i) => {
            let mine = got.filter((s) => s.cube === i)
            if (mine.length < o.minLines || new Set(mine.map((s) => s.axis)).size < 2) return // 2 families are enough: 4 lines of 2 families still fix the 3 numbers
            let s = solveCubePosition(mine.map((q) => ({ l: segmentLine(q, cx, cy), oc: latticeOffset(q.off, ax), len: q.len })), f, c.P)
            if (!s || s.P[2] < 1) return
            c.P = s.P; c.measured = s; c.segs = mine
        })
    }
    let out = []
    for (let c of cand) {
        let iou = iouOf(c.P, c.b)
        if (c.measured && c.segs.length >= o.minLines) {
            if (c.measured.rms > o.maxRms || iou < (c.segs.length >= 4 ? o.minIoU : o.minIoU3)) continue // 3 lines always fit exactly: only the silhouette can check them
            out.push({ P: c.P, z: c.P[2], segs: c.segs, nLines: c.segs.length })
        } else if (c.outline && c.outline.rms <= o.contourOnlyRms && iou >= o.contourOnlyIoU) out.push({ P: c.P, z: c.P[2], segs: [], nLines: 0 })
    }
    return out
}

/**
 * Cubes inside a cluster: 3 consecutive straight sides of the outline, of 3 different families and joined by convex corners, are 3 sides of ONE cube's hexagon, whatever else touches it.
 * Which side of the hexagon each one is follows from its family and from the side the amethyst is on, so the position is again a linear system, with no isolated cube needed.
 * Checks: the cube must be all purple inside and the middle line must be one whole cube edge (ends on the predicted vertices). Returns the same records as posesOfIsolatedCubes.
 */
function posesOfCornerCubes(cam, an, segs, opts) {
    let o = Object.assign({ gap: 7, minPurple: 0.93, vertexPx: 4, minLen: 8 }, opts)
    let w = an.w, h = an.h, cx = w / 2, cy = h / 2, f = focalPx(cam.fov, h), ax = cameraAxes(cam.pitch, cam.yaw), T = an.raw, M = an.data
    const inMask = (x, y) => { let X = Math.round(x), Y = Math.round(y); return X >= 0 && Y >= 0 && X < w && Y < h && M[Y * w + X] }
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1])
    let L = []
    for (let s of segs) {
        if (!(s.axis >= 0)) continue
        let len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1)
        if (len < o.minLen) continue
        let nx = -(s.y2 - s.y1) / len, ny = (s.x2 - s.x1) / len, plus = 0, minus = 0
        for (let t of [0.25, 0.5, 0.75]) { let px = s.x1 + (s.x2 - s.x1) * t, py = s.y1 + (s.y2 - s.y1) * t; if (inMask(px + nx * 3, py + ny * 3)) plus++; if (inMask(px - nx * 3, py - ny * 3)) minus++ }
        if (plus === minus) continue // not on the outline
        let sg = plus > minus ? 1 : -1
        L.push({ s, len, mx: (s.x1 + s.x2) / 2, my: (s.y1 + s.y2) / 2, nx: nx * sg, ny: ny * sg, a: [s.x1, s.y1], b: [s.x2, s.y2], axis: s.axis })
    }
    const convex = (line, other, near) => { let far = dist(other.a, near) < dist(other.b, near) ? other.b : other.a; return (far[0] - line.mx) * line.nx + (far[1] - line.my) * line.ny > 1 } // the far end of `other` is on the amethyst side of `line`
    const joined = (B, end) => L.filter((q) => q !== B && q.axis !== B.axis && Math.min(dist(q.a, end), dist(q.b, end)) <= o.gap && convex(B, q, end) && convex(q, B, end))
    let out = []
    for (let B of L) {
        let endsA = joined(B, B.a), endsB = joined(B, B.b)
        for (let A of endsA) for (let C of endsB) {
            if (A === C || A.axis === C.axis) continue
            let D0 = f / B.len, inward = 0.75 * B.len, P0 = [D0 * (B.mx + B.nx * inward - cx) / f, D0 * (B.my + B.ny * inward - cy) / f, D0] // only to tell which hexagon side is which
            let edges = cubeEdges(P0, ax, f, cx, cy).filter((e) => e.sil), c0 = [cx + f * P0[0] / P0[2], cy + f * P0[1] / P0[2]], rows = [], tri = [], ok = true
            for (let q of [A, B, C]) {
                let be = null, bs = 0
                for (let e of edges) { if (e.a !== q.axis) continue; let s = -(((e.p[0] + e.q[0]) / 2 - c0[0]) * q.nx + ((e.p[1] + e.q[1]) / 2 - c0[1]) * q.ny); if (s > bs) { bs = s; be = e } } // outward from the cube = opposite to the line's amethyst side
                if (!be) { ok = false; break }
                rows.push({ l: segmentLine(q.s, cx, cy), oc: latticeOffset(be.off, ax), len: q.len })
                tri.push(Object.assign({}, q.s, { off: be.off, axis: q.axis, len: q.len }))
            }
            if (!ok) continue
            let sol = solveCubePosition(rows, f, P0)
            if (!sol || sol.P[2] < 1.5 || sol.P[2] > 60) continue
            let hl = cubeHull(sol.P, ax, f, cx, cy), n = 0, pur = 0
            if (!hl) continue
            forEachPixelInHull(hl, w, h, (x, y) => { n++; pur += T[y * w + x] })
            if (n < 60 || pur / n < o.minPurple) continue
            let eB = cubeEdges(sol.P, ax, f, cx, cy).filter((e) => e.sil && e.a === B.axis && e.off.join() === tri[1].off.join())[0]
            if (!eB) continue
            let vErr = Math.min(dist(eB.p, B.a) + dist(eB.q, B.b), dist(eB.p, B.b) + dist(eB.q, B.a)) / 2
            if (vErr > o.vertexPx) continue
            out.push({ P: sol.P, z: sol.P[2], segs: tri, nLines: 3, vErr })
        }
    }
    let uniq = []
    for (let q of out) { let dup = uniq.find((u) => Math.hypot(u.P[0] - q.P[0], u.P[1] - q.P[1], u.P[2] - q.P[2]) < 0.15); if (!dup) uniq.push(q); else if (q.vErr < dup.vErr) Object.assign(dup, q) }
    return uniq
}

/** All the cubes that can be read directly from the lines at this camera (the isolated ones win when the same cube is found both ways) */
function cubePoses(cam, img, an, segs, lab) {
    let poses = posesOfIsolatedCubes(cam, img, an, lab)
    for (let c of posesOfCornerCubes(cam, an, segs)) if (!poses.some((q) => Math.hypot(q.P[0] - c.P[0], q.P[1] - c.P[1], q.P[2] - c.P[2]) < 0.4)) poses.push(c)
    return poses
}
