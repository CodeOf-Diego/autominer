/**
 * Cube cells chosen by a rule on each cell's 2D projection (no score summing), given the lattice geometry.
 * Every purple pixel has to be explained by a cell, and among the cells that could explain it the NEAREST one wins as long as its
 * whole projection is filled with purple:
 *  - a cell whose projection sticks out of the purple is too near, or not a cube: never taken;
 *  - cells are tried nearest first (a nearer cell hides what is behind it); a cell is taken if enough of its projection is not already
 *    explained (>= minFresh of it, and >= minFreshPx pixels): a far cell lying under a nearer taken one adds nothing, so it is skipped
 *    (two far cells that together tile a region are really one nearer cube, which is tried first).
 * `res` is the lattice geometry; returns [{i,j,k,P,coverage}] in the same format as res.cubes.
 */
/**
 * The pixels of a cube silhouette and how many of them are purple in mask T. A non-purple pixel whose sample point lies within
 * half a pixel diagonal (0.71 px) of the outline straddles it: part of it is outside the cube, so it is mixed, not evidence
 * against the cube, and counts as purple (pur); purStrict counts them as not purple. Without this a small cube (side ~19 px,
 * geode-04 cell -1,3,-4) failed the 97% rule on 13 such pixels all within 0.6 px of its outline, while its texture matched at 0.88.
 * But the cell one step nearer along the depth axis is only a fraction of a pixel larger, so it passes the lenient count too:
 * selectCellsByRay accepts a cell on the lenient count only when its texture matches strongly (synthetic far-9, close-2, close-5:
 * the nearer wrong cell had 0.61-0.69 and replaced the right one).
 */
function hullPurple(hl, w, h, T) {
    let px = [], pur = 0, purStrict = 0, n = hl.length, E = []
    for (let e = 0; e < n; e++) { let a = hl[e], b = hl[(e + 1) % n], dx = b.x - a.x, dy = b.y - a.y; E.push({ a, dx, dy, L2: dx * dx + dy * dy || 1 }) }
    const nearOutline = (x, y) => {
        for (let e of E) { let t = Math.max(0, Math.min(1, ((x - e.a.x) * e.dx + (y - e.a.y) * e.dy) / e.L2)), ex = x - e.a.x - t * e.dx, ey = y - e.a.y - t * e.dy; if (ex * ex + ey * ey <= 0.5) return true }
        return false
    }
    forEachPixelInHull(hl, w, h, (x, y) => { let q = y * w + x; px.push(q); if (T[q]) { pur++; purStrict++ } else if (nearOutline(x, y)) pur++ })
    return { px, pur, purStrict }
}

function selectCellsByRay(res, an, opts) {
    let o = Object.assign({ minPurple: 0.97, loose: true, minFresh: 0.3, minFreshPx: 60, radius: 14, tex: null, minNcc: 0.25, texBase: opts && opts.tex && opts.tex.learned ? 0.4 : 0.25, texW: 120, texPen: 3.5, strongNcc: 0.75, minFreshStrong: 25 }, opts)
    let w = an.w, h = an.h, f = focalPx(res.fov, h), ax = res.ax
    const T = o.loose ? an.raw : an.data // mask the 'all purple inside' test reads: the strict one, or the loose one that also accepts pale pink texels
    let pool = []
    for (let i = -o.radius; i <= o.radius; i++) for (let j = -o.radius; j <= o.radius; j++) for (let k = -o.radius; k <= o.radius; k++) {
        let P = latticePoint(res, i, j, k)
        if (P[2] < 0.8) continue
        let sx = Math.round(w / 2 + f * P[0] / P[2]), sy = Math.round(h / 2 + f * P[1] / P[2])
        if (sx >= 0 && sx < w && sy >= 0 && sy < h && !T[sy * w + sx]) continue // the centre of a cube whose whole projection is purple is purple: cheap reject before building the hull
        let hl = cubeHull(P, ax, f, w / 2, h / 2)
        if (!hl) continue
        let { px, pur, purStrict } = hullPurple(hl, w, h, T)
        if (px.length < 60 || px.length > w * h / 2 || pur / px.length < o.minPurple) continue
        pool.push({ i, j, k, P, px, purple: pur / px.length, borderOnly: purStrict / px.length < o.minPurple })
    }
    pool.sort((p, q) => p.P[2] - q.P[2]) // nearest first
    let cov = new Uint8Array(w * h), cells = [], M = an.data, score = 0, texSum = 0, owner = o.record ? new Int32Array(w * h) : null
    for (let c of pool) {
        let fresh = 0
        for (let q of c.px) if (!cov[q]) fresh++
        let small = fresh / c.px.length < o.minFresh || fresh < o.minFreshPx // little of it is visible: a nearer cube hides most of it
        if (small && !(o.tex && o.tex.learned && fresh >= o.minFreshStrong)) continue
        let ncc = null
        if (c.borderOnly && !o.tex) continue // no texture to confirm it: the strict count decides
        if (o.tex) { // the real texture, warped onto the cell's visible faces, must look like the photo there (cells already explained by nearer ones are excluded)
            let ts = textureScore(o.tex, an, res, c.P, cov)
            if (ts) { ncc = ts.ncc; if (ncc < o.minNcc) continue }
            if (c.borderOnly && !(ts && ncc >= o.strongNcc)) continue // purple enough only thanks to the pixels straddling its outline: the texture must confirm it (see hullPurple)
            if (small && !(ts && ncc >= o.strongNcc)) continue // a cube mostly hidden behind a nearer one is accepted only when its visible sliver matches the texture strongly (the sliver is real purple that a farther cell would otherwise explain wrongly)
        }
        for (let q of c.px) if (!cov[q]) { cov[q] = 1; score += M[q] ? 1 : -CUBE_BG_WEIGHT; if (owner) owner[q] = cells.length + 1 }
        if (ncc !== null) texSum += ncc >= o.texBase ? ncc - o.texBase : o.texPen * (ncc - o.texBase) // reward above the baseline, a much harsher penalty below it (a mask gain must not pay for a cell the texture rejects)
        cells.push({ i: c.i, j: c.j, k: c.k, P: c.P, coverage: c.purple, ncc })
    }
    cells.score = score - CUBE_COST * cells.length // how well this lattice geometry explains the mask: used to tune the geometry
    cells.total = cells.score + o.texW * texSum // + how well the real texture fits the chosen cells (smooth in depth, unlike the mask)
    if (o.record) Object.assign(o.record, { owner, cells, opts: o })
    return cells
}

/**
 * Why selectCellsByRay takes or rejects cell (i, j, k): every test it makes, with the value and the threshold, in the order it makes them. `record` comes from a
 * selectCellsByRay call with the same geometry and options ({record: {}}): the cells are tried nearest first, so at this cell's turn the pixels already taken are
 * exactly those of the accepted cells nearer than it, which the record tells. Also returns the pixels of the cell's silhouette split into free+purple,
 * free+not purple and covered (mask resolution), to draw them.
 */
function explainCell(res, an, record, i, j, k) {
    let o = record.opts, w = an.w, h = an.h, f = focalPx(res.fov, h), ax = res.ax, T = o.loose ? an.raw : an.data
    let P = latticePoint(res, i, j, k)
    let out = { i, j, k, P, z: P[2], checks: [], pix: { free: [], freeNotPurple: [], covered: [] }, coveredBy: [], ncc: null }
    const check = (name, ok, value, need) => { out.checks.push({ name, ok, value, need }); return ok }
    let fails = []
    const test = (name, ok, value, need, reason) => { if (!check(name, ok, value, need)) fails.push(reason); return ok }
    test('within the radius considered', Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) <= o.radius, 'max(|i|,|j|,|k|) = ' + Math.max(Math.abs(i), Math.abs(j), Math.abs(k)), '≤ ' + o.radius, 'too far from the lattice centre: never considered')
    if (!test('in front of the camera', P[2] >= 0.8, 'distance ' + P[2].toFixed(2), '≥ 0.8', 'behind or touching the camera')) { out.reason = fails[0]; out.taken = false; return out }
    let sx = Math.round(w / 2 + f * P[0] / P[2]), sy = Math.round(h / 2 + f * P[1] / P[2]), inside = sx >= 0 && sx < w && sy >= 0 && sy < h
    test('silhouette centre purple (quick check)', !inside || !!T[sy * w + sx], inside ? (T[sy * w + sx] ? 'yes' : 'no') : 'outside the photo', 'yes', 'the silhouette centre is not purple')
    let hl = cubeHull(P, ax, f, w / 2, h / 2)
    if (!hl) { fails.push('silhouette not computable'); out.reason = fails[0]; out.taken = false; return out }
    let { px, pur, purStrict } = hullPurple(hl, w, h, T)
    out.purpleStrict = px.length ? purStrict / px.length : 0
    out.n = px.length; out.purple = px.length ? pur / px.length : 0
    test('silhouette size', px.length >= 60 && px.length <= w * h / 2, px.length + ' px', '60 - ' + Math.round(w * h / 2) + ' px', px.length < 60 ? 'silhouette too small' : 'silhouette too large')
    test('purple inside the silhouette (pixels straddling the outline count as purple)', out.purple >= o.minPurple, (100 * out.purple).toFixed(1) + '% (without them: ' + (100 * out.purpleStrict).toFixed(1) + '%)', '≥ ' + Math.round(100 * o.minPurple) + '%', 'the silhouette leaves the purple')
    let borderOnly = out.purple >= o.minPurple && out.purpleStrict < o.minPurple
    // pixels already taken at this cell's turn: those of the accepted cells nearer than it
    let cov = new Uint8Array(w * h), by = new Map(), fresh = 0
    for (let q = 0; q < w * h; q++) { let ow = record.owner[q]; if (ow && record.cells[ow - 1].P[2] < P[2]) cov[q] = 1 }
    for (let q of px) {
        if (cov[q]) { out.pix.covered.push(q); let cc = record.cells[record.owner[q] - 1], key = cc.i + ',' + cc.j + ',' + cc.k; by.set(key, (by.get(key) || 0) + 1) }
        else { fresh++; (T[q] ? out.pix.free : out.pix.freeNotPurple).push(q) }
    }
    out.coveredBy = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, n }))
    out.fresh = fresh; out.freeFrac = px.length ? fresh / px.length : 0
    let small = out.freeFrac < o.minFresh || fresh < o.minFreshPx, strongOk = o.tex && o.tex.learned && fresh >= o.minFreshStrong
    test('free part (not covered by nearer cubes already chosen)', !small || strongOk, fresh + ' px = ' + (100 * out.freeFrac).toFixed(0) + '%', '≥ ' + Math.round(100 * o.minFresh) + '% and ≥ ' + o.minFreshPx + ' px' + (o.tex && o.tex.learned ? ' (or ≥ ' + o.minFreshStrong + ' px if the texture matches ≥ ' + o.strongNcc + ')' : ''), 'almost all covered by nearer cubes')
    if (o.tex) {
        let ts = textureScore(o.tex, an, res, P, cov)
        out.ncc = ts ? ts.ncc : null
        if (o.minNcc > -1) test('match with the photo texture', !ts || ts.ncc >= o.minNcc, ts ? ts.ncc.toFixed(2) : 'not measurable', '≥ ' + o.minNcc.toFixed(2) + ' (threshold of this photo)', 'the texture does not match')
        else check('match with the photo texture', true, ts ? ts.ncc.toFixed(2) : 'not measurable', 'no threshold: on this photo the texture is not used as a filter')
        if (borderOnly) test('purple only thanks to the outline pixels: the texture must match strongly', !!ts && ts.ncc >= o.strongNcc, ts ? ts.ncc.toFixed(2) : 'not measurable', '≥ ' + o.strongNcc, 'purple only thanks to the outline and the texture does not confirm it')
        if (small && strongOk) test('visible strip very similar to the texture', !!ts && ts.ncc >= o.strongNcc, ts ? ts.ncc.toFixed(2) : 'not measurable', '≥ ' + o.strongNcc, 'almost covered and the visible strip does not match the texture enough')
    } else {
        check('match with the photo texture', true, '-', 'texture not available on this photo')
        if (borderOnly) test('purple only thanks to the outline pixels', false, 'no texture to confirm it', 'texture', 'purple only thanks to the outline and the texture does not confirm it')
    }
    out.taken = !fails.length
    out.reason = fails[0] || null
    out.inResult = record.cells.some((q) => q.i === i && q.j === j && q.k === k)
    return out
}

/** Cells of the lattice crossed by the ray from the camera along direction d (camera coords, d[2] = 1), nearest first, as {i, j, k, z} (z = depth of the cell centre) */
function latticeRayCells(res, d, zMin, zMax) {
    let E = [res.ax.ex, res.ax.ey, res.ax.ez], O = res.origin, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    let A = E.map((e) => -dot(O, e)), D = E.map((e) => dot(d, e)) // the ray in lattice coordinates: A + t D, t = depth along the camera axis
    let t = zMin, cell = A.map((a, n) => Math.round(a + t * D[n])), out = []
    let step = D.map((x) => Math.sign(x)), tDelta = D.map((x) => x ? 1 / Math.abs(x) : Infinity), tNext = D.map((x, n) => x ? (cell[n] + 0.5 * step[n] - A[n]) / x : Infinity)
    while (t < zMax && out.length < 500) { // cell boundaries are at half-integers: the next one crossed is the nearest along the ray (voxel traversal)
        let z = O[2] + cell[0] * E[0][2] + cell[1] * E[1][2] + cell[2] * E[2][2]
        out.push({ i: cell[0], j: cell[1], k: cell[2], z })
        let m = tNext[0] < tNext[1] ? (tNext[0] < tNext[2] ? 0 : 2) : (tNext[1] < tNext[2] ? 1 : 2)
        t = tNext[m]; cell[m] += step[m]; tNext[m] += tDelta[m]
    }
    return out
}

/**
 * The cells at this geometry: selectCellsByRay, with the texture as a filter relative to how well it fits THIS photo (half the 75th percentile of the correlations of the unfiltered cells, kept in
 * 0.3..0.6 with the template learned from the photo, 0.15..0.25 at 40% with the project's texture; chance level is ~0.11), unless the filter removes most of them (then the texture is not usable here).
 * Returns a copy of `geo` with cubesRay.
 */
function chooseCells(geo, an, tex) {
    let g = Object.assign({}, geo), cur
    if (tex) {
        let plain = selectCellsByRay(g, an, { tex, minNcc: -2 }), nccs = plain.map((c) => c.ncc).filter((x) => x !== null).sort((a, b) => a - b)
        let q75 = nccs.length ? nccs[Math.floor(nccs.length * 0.75)] : 0.5, thr = tex.learned ? Math.max(0.3, Math.min(0.6, 0.5 * q75)) : Math.max(0.15, Math.min(0.25, 0.4 * q75))
        let gated = selectCellsByRay(g, an, { tex, minNcc: thr })
        g.texGate = thr
        g.texUsed = gated.length >= 0.7 * plain.length
        cur = g.texUsed ? gated : plain
        g.selOpts = { tex, minNcc: g.texUsed ? thr : -2 }
    } else { cur = selectCellsByRay(g, an, {}); g.selOpts = {} }
    g.cubesRay = cur
    return g
}
