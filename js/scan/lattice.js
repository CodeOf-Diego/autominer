/**
 * Cubes sit at integer offsets from each other: each pose in turn is the reference and predicts where the others should be; the reference most of them agree with wins (a wrong pose agrees with nobody).
 * Returns {O: origin, sup: [{q: pose, n: [i,j,k]}], px: rms misfit on the screen} or null.
 */
function latticeConsensus(poses, cam, W, H, maxPx) {
    let ax = cameraAxes(cam.pitch, cam.yaw), E = [ax.ex, ax.ey, ax.ez], f = focalPx(cam.fov, H), best = null
    const pr = (X) => [W / 2 + f * X[0] / X[2], H / 2 + f * X[1] / X[2]]
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    for (let r of poses) {
        let sup = [], err = 0
        for (let q of poses) {
            let d = [q.P[0] - r.P[0], q.P[1] - r.P[1], q.P[2] - r.P[2]], c = E.map((e) => Math.round(dot(d, e))), bq = null, qs = pr(q.P)
            for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let g = -1; g <= 1; g++) { // depth is less certain than the screen position: the nearest integers are compared on the screen
                let n = [c[0] + a, c[1] + b, c[2] + g], X = r.P.map((x, i) => x + n[0] * E[0][i] + n[1] * E[1][i] + n[2] * E[2][i])
                if (X[2] < 1) continue
                let zr = X[2] / q.P[2]
                if (zr < 0.85 || zr > 1.18) continue
                let s = pr(X), e = Math.hypot(s[0] - qs[0], s[1] - qs[1]), cost = Math.hypot(e, 20 * (zr - 1))
                if (!bq || cost < bq.cost) bq = { n, e, cost }
            }
            if (bq && bq.e <= maxPx) { sup.push({ q, n: bq.n }); err += bq.cost * bq.cost }
        }
        let key = sup.length * 1000 - err
        if (!best || key > best.key) best = { key, O: r.P.slice(), sup, px: Math.sqrt(err / Math.max(1, sup.length)) }
    }
    return best
}

/** Signed distances (px) of the ends and the middle of every assigned line from its lattice edge, for v = [pitch, yaw, fov, Ox, Oy, Oz]; asg = [{s: segment, u: axis, pos: lattice coords of the edge}] */
function lineResiduals(v, asg, W, H, v0) {
    let E0 = cameraAxes(v[0], v[1]), E = [E0.ex, E0.ey, E0.ez], f = (H / 2) / Math.tan(v[2] * Math.PI / 360), cx = W / 2, cy = H / 2, r = []
    const at = (p) => [v[3] + p[0] * E[0][0] + p[1] * E[1][0] + p[2] * E[2][0], v[4] + p[0] * E[0][1] + p[1] * E[1][1] + p[2] * E[2][1], v[5] + p[0] * E[0][2] + p[1] * E[1][2] + p[2] * E[2][2]]
    for (let a of asg) {
        let p1 = a.pos.slice(), p2 = a.pos.slice(); p1[a.u] = 0; p2[a.u] = 1
        let A = at(p1), B = at(p2)
        if (A[2] < 0.3 || B[2] < 0.3) { r.push(50, 50, 50); continue }
        let ax = cx + f * A[0] / A[2], ay = cy + f * A[1] / A[2], dx = cx + f * B[0] / B[2] - ax, dy = cy + f * B[1] / B[2] - ay, n = Math.hypot(dx, dy) || 1, l0 = -dy / n, l1 = dx / n, l2 = -(l0 * ax + l1 * ay), s = a.s
        let w = Math.sqrt(Math.min(s.len || 60, 120) / 40)
        r.push(w * (l0 * s.x1 + l1 * s.y1 + l2), w * (l0 * (s.x1 + s.x2) / 2 + l1 * (s.y1 + s.y2) / 2 + l2), w * (l0 * s.x2 + l1 * s.y2 + l2))
    }
    if (v0) { let z = 0.1 * Math.max(1, Math.abs(v0[5])), sc = [1, 1, 2, z, z, z]; for (let i = 0; i < 6; i++) r.push(0.5 * (v[i] - v0[i]) / sc[i]) } // a weak pull to the start: 6 unknowns can be barely constrained by few lines
    return r
}

/**
 * Pitch, yaw, FOV and lattice origin that bring the lattice edges onto the measured lines (Levenberg-Marquardt with a Huber loss). The direction of every step comes from the derivatives of the
 * residuals: nothing is tried at random, and the cost falls at every accepted step. frozen = indices of v that must not move. Returns v.
 */
function solveCameraOnLines(v0, asg, W, H, frozen) {
    const delta = 2, rho = (x) => Math.abs(x) <= delta ? x * x : delta * (2 * Math.abs(x) - delta)
    const cost = (u) => lineResiduals(u, asg, W, H, v0).reduce((s, x) => s + rho(x), 0)
    let v = v0.slice(), c = cost(v), lam = 1e-2, z = 1e-3 * Math.max(1, Math.abs(v0[5])), h = [0.005, 0.005, 0.01, z, z, z]
    for (let it = 0; it < 25; it++) {
        let r0 = lineResiduals(v, asg, W, H, v0), n = r0.length, J = []
        for (let q = 0; q < 6; q++) {
            if (frozen.includes(q)) { J.push(null); continue }
            let t = v.slice(); t[q] += h[q]
            let r1 = lineResiduals(t, asg, W, H, v0)
            J.push(r1.map((x, i) => (x - r0[i]) / h[q]))
        }
        let wr = r0.map((x) => Math.abs(x) <= delta ? 1 : delta / Math.abs(x)), Hm = [0, 1, 2, 3, 4, 5].map(() => [0, 0, 0, 0, 0, 0]), g = [0, 0, 0, 0, 0, 0]
        for (let a = 0; a < 6; a++) {
            if (!J[a]) continue
            for (let i = 0; i < n; i++) g[a] += wr[i] * J[a][i] * r0[i]
            for (let b = 0; b < 6; b++) { if (!J[b]) continue; let s = 0; for (let i = 0; i < n; i++) s += wr[i] * J[a][i] * J[b][i]; Hm[a][b] = s }
        }
        let improved = false
        for (let tries = 0; tries < 8; tries++) {
            let d = solveLinear(Hm.map((row, i) => row.map((x, j) => i === j ? x * (1 + lam) + (J[i] ? 0 : 1) : x)), g.map((x) => -x))
            if (!d) { lam *= 10; continue }
            let t = v.map((x, i) => x + (J[i] ? d[i] : 0)), ct = cost(t)
            if (ct < c - 1e-9) { v = t; c = ct; lam = Math.max(1e-6, lam / 4); improved = true; break }
            lam *= 5
        }
        if (!improved) break
    }
    return v
}

/** Which lattice edge does each line lie on: the nearest edge of the same family among the visible faces of these cells, within gate px, overlapping along its length. Returns the assignment for solveCameraOnLines. */
function assignLinesToCells(v, cells, segs, W, H, gate) {
    let ax = cameraAxes(v[0], v[1]), E = [ax.ex, ax.ey, ax.ez], f = (H / 2) / Math.tan(v[2] * Math.PI / 360), cx = W / 2, cy = H / 2
    const at = (p) => [v[3] + p[0] * E[0][0] + p[1] * E[1][0] + p[2] * E[2][0], v[4] + p[0] * E[0][1] + p[1] * E[1][1] + p[2] * E[2][1], v[5] + p[0] * E[0][2] + p[1] * E[1][2] + p[2] * E[2][2]]
    let lines = new Map()
    for (let c of cells) {
        let ci = [c.i, c.j, c.k], P = at(ci)
        for (let a = 0; a < 3; a++) for (let s of [-1, 1]) {
            let n = E[a].map((x) => x * s), ctr = P.map((x, i) => x + 0.5 * n[i])
            if (n[0] * ctr[0] + n[1] * ctr[1] + n[2] * ctr[2] >= 0) continue // back face
            let u = (a + 1) % 3, w = (a + 2) % 3
            for (let [ua, wa] of [[u, w], [w, u]]) for (let q of [-1, 1]) {
                let pos = [0, 0, 0]; pos[a] = ci[a] + s * 0.5; pos[wa] = ci[wa] + q * 0.5
                let key = ua + ':' + pos.map((x, i) => i === ua ? 'n' : x * 2).join(',')
                let L = lines.get(key)
                if (!L) { L = { u: ua, pos, ext: [] }; lines.set(key, L) }
                let t0 = ci[ua] - 0.5
                if (!L.ext.includes(t0)) L.ext.push(t0)
            }
        }
    }
    const proj = (L, t) => { let p = L.pos.slice(); p[L.u] = t; let X = at(p); return [cx + f * X[0] / X[2], cy + f * X[1] / X[2], X[2]] }
    let out = []
    for (let s of segs) {
        if (!(s.axis >= 0)) continue
        let best = null, bs = gate
        for (let L of lines.values()) {
            if (L.u !== s.axis) continue
            let A = proj(L, L.ext[0]), B = proj(L, L.ext[0] + 1)
            if (A[2] < 0.3 || B[2] < 0.3) continue
            let dx = B[0] - A[0], dy = B[1] - A[1], n = Math.hypot(dx, dy)
            if (n < 1e-6) continue
            let l0 = -dy / n, l1 = dx / n, l2 = -(l0 * A[0] + l1 * A[1]), sc = Math.max(Math.abs(l0 * s.x1 + l1 * s.y1 + l2), Math.abs(l0 * s.x2 + l1 * s.y2 + l2))
            if (sc >= bs) continue
            let tx = dx / n, ty = dy / n, t1 = (s.x1 - A[0]) * tx + (s.y1 - A[1]) * ty, t2 = (s.x2 - A[0]) * tx + (s.y2 - A[1]) * ty, lo = Math.min(t1, t2), hi = Math.max(t1, t2), ov = 0
            for (let e of L.ext) { let p = proj(L, e), q = proj(L, e + 1), s1 = (p[0] - A[0]) * tx + (p[1] - A[1]) * ty, s2 = (q[0] - A[0]) * tx + (q[1] - A[1]) * ty; ov = Math.max(ov, Math.min(hi, Math.max(s1, s2)) - Math.max(lo, Math.min(s1, s2))) }
            if (ov < 0.25 * Math.min(hi - lo, n)) continue
            bs = sc; best = L
        }
        if (best) out.push({ s, u: best.u, pos: best.pos })
    }
    return out
}

/**
 * The lattice from the cubes read directly: poses -> agreement on the integer offsets -> camera and origin solved on the lines of the agreeing cubes (their lattice edges are known, no matching) -> poses again
 * with the better camera. Stops when the camera stops moving. Needs 2 agreeing cubes. Returns {pitch, yaw, fov, origin, ax, support, px, allSegs} or null.
 */
function solveLattice(startCam, img, an, segs, lab, opts) {
    let o = Object.assign({ iters: 4, maxPx: 3, minSupport: 2, fovFixed: false }, opts)
    let W = an.w, H = an.h, cam = { pitch: startCam.pitch, yaw: startCam.yaw, fov: startCam.fov }, best = null
    for (let it = 0; it < o.iters; it++) {
        let poses = cubePoses(cam, img, an, segs, lab)
        if (poses.length < o.minSupport) break
        let con = latticeConsensus(poses, cam, W, H, o.maxPx)
        if (!con || con.sup.length < o.minSupport) break
        let asg = [], measured = []
        for (let s of con.sup) for (let q of s.q.segs) { asg.push({ s: q, u: q.axis, pos: [s.n[0] + q.off[0], s.n[1] + q.off[1], s.n[2] + q.off[2]] }); measured.push(q) }
        // the candidate carries the camera and origin SOLVED on the lines of its agreeing cubes, not the camera it started from: when a later round
        // loses a borderline cube and agrees on fewer, this round wins, and its unsolved camera was ~1 deg off (geode-03: 37 wrong cubes instead of 28)
        let v = asg.length >= 6 ? solveCameraOnLines([cam.pitch, cam.yaw, cam.fov, con.O[0], con.O[1], con.O[2]], asg, W, H, o.fovFixed ? [2] : []) : [cam.pitch, cam.yaw, cam.fov, con.O[0], con.O[1], con.O[2]]
        let cand = { pitch: v[0], yaw: v[1], fov: v[2], origin: [v[3], v[4], v[5]], ax: cameraAxes(v[0], v[1]), refIoU: 0, support: con.sup.length, px: con.px, allSegs: segs.concat(measured) }
        if (!best || cand.support > best.support || (cand.support === best.support && cand.px < best.px)) best = cand
        if (asg.length < 6) break
        let moved = Math.abs(v[0] - cam.pitch) + Math.abs(v[1] - cam.yaw) + Math.abs(v[2] - cam.fov)
        cam = { pitch: v[0], yaw: v[1], fov: v[2] }
        if (moved < 0.02) break
    }
    return best
}

/**
 * Cells and geometry fix each other: pick the cells, solve the camera on all the lines those cells explain, pick again. Keeps the round with the best score (mask + texture). onStep shows each round.
 * Returns the geometry with cubesRay.
 */
async function finishLattice(geo, an, tex, segs, opts) {
    let o = Object.assign({ rounds: 2, fovFixed: false, gate: 6, onStep: null }, opts), W = an.w, H = an.h
    let g = chooseCells(geo, an, tex), best = g
    const show = async (x) => { if (o.onStep && o.onStep(Object.assign({ phase: 'cells', cubes: x.cubesRay, score: x.cubesRay.score }, { origin: x.origin, ax: x.ax, fov: x.fov, pitch: x.pitch, yaw: x.yaw })) === false) throw AUTOCAL_CANCELLED; await tick() }
    await show(g)
    for (let r = 0; r < o.rounds; r++) {
        let v = [g.pitch, g.yaw, g.fov, g.origin[0], g.origin[1], g.origin[2]]
        for (let pass = 0; pass < 4; pass++) { // the assignment depends on the geometry and the geometry on the assignment: re-assign until it settles
            let asg = assignLinesToCells(v, g.cubesRay, segs, W, H, o.gate)
            if (asg.length < 3) break
            let u = solveCameraOnLines(v, asg, W, H, o.fovFixed ? [2] : []), moved = u.reduce((s, x, i) => s + Math.abs(x - v[i]), 0)
            v = u
            if (moved < 1e-3) break
        }
        g = chooseCells(Object.assign({}, geo, { pitch: v[0], yaw: v[1], fov: v[2], origin: [v[3], v[4], v[5]], ax: cameraAxes(v[0], v[1]) }), an, tex)
        await show(g)
        if (g.cubesRay.total > best.cubesRay.total) best = g
    }
    return best
}
