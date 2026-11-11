/**
 * Straight edges of the purple silhouettes, found the standard way (contour chain -> split -> merge ->
 * least-squares fit -> validation), see EDLines (Akinlar & Topal) and split-and-merge contour methods:
 *  1. purple mask at the photo's own resolution (the original is sharp: no anti-aliasing, a pixel is amethyst or it is not);
 *     blob outlines are walked pixel by pixel (findContours, no simplification);
 *  2. each closed chain is rotated to start at its most protruding point (a real corner), so a straight side is
 *     never cut by the start point (the known Douglas-Peucker failure that produced 2 lines for 1 side);
 *  3. recursive split at the point farthest from the chord while it is > epsilon px away;
 *  4. neighbouring pieces are merged back while the merged piece still fits one straight line (same slope within
 *     collinDeg, every chain point within epsilon of it);
 *  5. each piece is fitted with a total-least-squares line (sub-pixel direction); pieces shorter than minLen or with
 *     residual rms > maxRms are dropped; pieces lying on the image border are dropped;
 *  6. validation on the two sides: along the middle 70% of the segment, in bands 3-7 px to each side, the purple side
 *     must be >= minSide purple and the other side >= minSide NOT purple.
 * Returns {segs, rejected} (coords scaled to an's resolution; each seg has x1,y1,x2,y2,len,rms,inFrac,outFrac).
 */
function extractMaskLines(img, an, opts) {
    let o = Object.assign({ maxW: 1600, epsilon: 1.5, minLen: 14, collinDeg: 3, maxRms: 1.0, minSide: 0.9, convexSolidity: 0.93, quadLoss: 0.012 }, opts)
    let scale = Math.min(1, o.maxW / img.naturalWidth), w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
    let hsv = photoHSV(img, w, h), { raw, filled: mask } = purpleMask(hsv, purpleWindows(an.hueShift))
    let M = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) M[i] = mask.data[i] ? 1 : 0

    let contours = new cv.MatVector(), hier = new cv.Mat()
    cv.findContours(mask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE)
    let segs = [], rejected = []
    for (let ci = 0; ci < contours.size(); ci++) {
        let c = contours.get(ci), n = c.rows
        if (n >= 24) {
            let P = []
            for (let i = 0; i < n; i++) P.push([c.data32S[i * 2], c.data32S[i * 2 + 1]])
            let gx = 0, gy = 0
            for (let p of P) { gx += p[0]; gy += p[1] }
            gx /= n; gy /= n
            // An isolated cube's silhouette is a convex hexagon (3 faces visible) or a quadrilateral (2 faces / unlucky perspective).
            // So for a convex blob the sides are not discovered by cutting the outline where it bends: the convex hull is reduced
            // to 6 vertices (repeatedly dropping the vertex that loses the least area), or to 4 if that costs under 1.2% of the area.
            const polyArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { let u = pts[i], v = pts[(i + 1) % pts.length]; a += u.x * v.y - v.x * u.y } return Math.abs(a / 2) }
            let hullPts = convexHull(P.map((p) => ({ x: p[0], y: p[1] })))
            let convexIdx = null
            if (hullPts.length >= 4 && polyArea(P.map((p) => ({ x: p[0], y: p[1] }))) / polyArea(hullPts) >= o.convexSolidity) {
                const lossOf = (poly, i) => { let a = poly[(i + poly.length - 1) % poly.length], b = poly[i], c = poly[(i + 1) % poly.length]; return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2 }
                const reduceTo = (poly, k) => { poly = poly.slice(); while (poly.length > k) { let bi = 0, bl = Infinity; poly.forEach((_, i) => { let l = lossOf(poly, i); if (l < bl) { bl = l; bi = i } }); poly.splice(bi, 1) } return poly }
                let hullA = polyArea(hullPts), p6 = reduceTo(hullPts, 6), p4 = reduceTo(hullPts, 4)
                let poly = polyArea(p6) - polyArea(p4) < o.quadLoss * hullA ? p4 : p6
                convexIdx = poly.map((v) => P.findIndex((q) => q[0] === v.x && q[1] === v.y)).filter((i) => i >= 0).sort((p, q) => p - q)
                if (convexIdx.length < 4) convexIdx = null
                if (o.dbg) o.dbg.k.push(poly.length + '>' + (convexIdx ? convexIdx.length : 'x'))
            }
            let st = 0, far = -1, Q, cuts
            if (convexIdx) {
                st = convexIdx[0]
                Q = P.slice(st).concat(P.slice(0, st), [P[st]])
                cuts = convexIdx.map((i) => (i - st + n) % n).concat([Q.length - 1])
            } else {
                P.forEach((p, i) => { let d = Math.hypot(p[0] - gx, p[1] - gy); if (d > far) { far = d; st = i } }) // most protruding point = a corner
                Q = P.slice(st).concat(P.slice(0, st), [P[st]]) // open chain, starts and ends at the corner
                let mid = 0, midD = -1 // the chain is closed (starts and ends at the same corner): first split at the point farthest from it, else the first chord has length 0
                Q.forEach((p, i) => { let d = Math.hypot(p[0] - Q[0][0], p[1] - Q[0][1]); if (d > midD) { midD = d; mid = i } })
                cuts = [0, mid, Q.length - 1]
                const split = (a, b) => { // recursive split at the farthest point from chord a-b
                    let ax = Q[a][0], ay = Q[a][1], bx = Q[b][0], by = Q[b][1], L = Math.hypot(bx - ax, by - ay) || 1, best = -1, bd = 0
                    for (let i = a + 1; i < b; i++) { let d = Math.abs((bx - ax) * (ay - Q[i][1]) - (ax - Q[i][0]) * (by - ay)) / L; if (d > bd) { bd = d; best = i } }
                    if (bd > o.epsilon) { cuts.push(best); split(a, best); split(best, b) }
                }
                split(0, mid); split(mid, Q.length - 1)
                cuts.sort((p, q) => p - q)
            }
            // total least squares line through chain points a..b: {cx,cy,tx,ty,maxDev,rms}
            const fit = (a, b) => {
                let mx = 0, my = 0, cnt = b - a + 1
                for (let i = a; i <= b; i++) { mx += Q[i][0]; my += Q[i][1] }
                mx /= cnt; my /= cnt
                let sxx = 0, sxy = 0, syy = 0
                for (let i = a; i <= b; i++) { let dx = Q[i][0] - mx, dy = Q[i][1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy }
                let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), tx = Math.cos(ang), ty = Math.sin(ang), maxDev = 0, ss = 0
                for (let i = a; i <= b; i++) { let d = Math.abs((Q[i][0] - mx) * ty - (Q[i][1] - my) * tx); maxDev = Math.max(maxDev, d); ss += d * d }
                return { cx: mx, cy: my, tx, ty, maxDev, rms: Math.sqrt(ss / cnt) }
            }
            let merged = true // merge neighbours that are still one straight line
            while (!convexIdx && merged && cuts.length > 2) {
                merged = false
                for (let q = 1; q < cuts.length - 1; q++) {
                    let f1 = fit(cuts[q - 1], cuts[q]), f2 = fit(cuts[q], cuts[q + 1])
                    let dAng = Math.acos(Math.min(1, Math.abs(f1.tx * f2.tx + f1.ty * f2.ty))) * 180 / Math.PI
                    if (dAng > o.collinDeg) continue
                    let fm = fit(cuts[q - 1], cuts[q + 1])
                    if (fm.maxDev <= o.epsilon + 0.5) { cuts.splice(q, 1); merged = true; break }
                }
            }
            const at = (x, y) => { let xi = Math.round(x), yi = Math.round(y); return xi >= 0 && xi < w && yi >= 0 && yi < h ? M[yi * w + xi] : 0 }
            for (let q = 0; q < cuts.length - 1; q++) {
                let a = cuts[q], b = cuts[q + 1]
                if (b - a < 3) continue
                let f = fit(a, b), t1 = (Q[a][0] - f.cx) * f.tx + (Q[a][1] - f.cy) * f.ty, t2 = (Q[b][0] - f.cx) * f.tx + (Q[b][1] - f.cy) * f.ty
                let x1 = f.cx + t1 * f.tx, y1 = f.cy + t1 * f.ty, x2 = f.cx + t2 * f.tx, y2 = f.cy + t2 * f.ty, len = Math.hypot(x2 - x1, y2 - y1)
                if (o.dbg && convexIdx) o.dbg.sides.push([Math.round(len), +f.rms.toFixed(2)])
                if (len < (convexIdx ? 8 : o.minLen) || f.rms > (convexIdx ? 2.5 : o.maxRms)) continue // hexagon sides are already constrained by the shape; the two-sided colour test below is what validates them
                if ((x1 <= 1.5 && x2 <= 1.5) || (x1 >= w - 2.5 && x2 >= w - 2.5) || (y1 <= 1.5 && y2 <= 1.5) || (y1 >= h - 2.5 && y2 >= h - 2.5)) continue
                // validation on both sides of the segment
                let nx = -f.ty, ny = f.tx, plus = 0, minus = 0, cntS = 0
                let dx = (x2 - x1) / len, dy = (y2 - y1) / len
                for (let t = 0.15 * len; t <= 0.85 * len; t += 2) for (let d = 3; d <= 7; d++) {
                    let px = x1 + dx * t, py = y1 + dy * t
                    plus += at(px + nx * d, py + ny * d); minus += at(px - nx * d, py - ny * d); cntS++
                }
                let pf = plus / cntS, mf = minus / cntS
                let inFrac = Math.max(pf, mf), outFrac = 1 - Math.min(pf, mf) // purple side vs non-purple side
                let ks = an.w / w, seg = { blob: ci, convex: !!convexIdx, x1: x1 * ks, y1: y1 * ks, x2: x2 * ks, y2: y2 * ks, len: len * ks, rms: f.rms, inFrac, outFrac }
                if (inFrac >= o.minSide && outFrac >= o.minSide) segs.push(seg); else rejected.push(seg)
            }
        }
        c.delete()
    }
    for (let mm of [hsv, raw, mask]) mm.delete()
    contours.delete(); hier.delete()
    // one straight side can still come out as 2+ pieces when a 1-2 px dent in the outline (a pale pixel on the edge) cut it: glue
    // pieces of the same blob that lie on one line (same direction within collinDeg, ends within collinPx of each other's line)
    // when the gap between them is small (<= 6 px, or 70% of the shorter piece)
    const along = (u, x, y) => (x - u.x1) * (u.x2 - u.x1) / u.len + (y - u.y1) * (u.y2 - u.y1) / u.len
    const dist = (u, x, y) => Math.abs((x - u.x1) * (u.y2 - u.y1) / u.len - (y - u.y1) * (u.x2 - u.x1) / u.len)
    let glued = true
    while (glued) {
        glued = false
        outer: for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
            let u = segs[i], v = segs[j]
            if (u.blob !== v.blob) continue
            let ang = Math.acos(Math.min(1, Math.abs(((u.x2 - u.x1) * (v.x2 - v.x1) + (u.y2 - u.y1) * (v.y2 - v.y1)) / (u.len * v.len)))) * 180 / Math.PI
            if (ang > o.collinDeg) continue
            let tol = o.collinPx * an.w / w
            if (dist(u, v.x1, v.y1) > tol || dist(u, v.x2, v.y2) > tol || dist(v, u.x1, u.y1) > tol || dist(v, u.x2, u.y2) > tol) continue
            let b1 = along(u, v.x1, v.y1), b2 = along(u, v.x2, v.y2)
            let gap = Math.max(Math.min(b1, b2) - u.len, -Math.max(b1, b2), 0)
            if (gap > Math.max(6, 0.7 * Math.min(u.len, v.len))) continue
            let pts = [[u.x1, u.y1, 0], [u.x2, u.y2, u.len], [v.x1, v.y1, b1], [v.x2, v.y2, b2]].sort((p, q) => p[2] - q[2])
            let a = pts[0], b = pts[3], L = Math.hypot(b[0] - a[0], b[1] - a[1])
            segs[i] = { blob: u.blob, x1: a[0], y1: a[1], x2: b[0], y2: b[1], len: L, rms: Math.max(u.rms, v.rms), inFrac: Math.min(u.inFrac, v.inFrac), outFrac: Math.min(u.outFrac, v.outFrac) }
            segs.splice(j, 1); glued = true
            break outer
        }
    }
    return { segs, rejected }
}
