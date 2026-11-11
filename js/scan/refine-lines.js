/**
 * Second pass over the lines of extractMaskLines: the HSV purple mask gives the rough position (it is binary and its
 * outline is off by a pixel or two, more where the cube is pale or shaded), the exact position is then measured on the
 * ORIGINAL colour photo, using all three RGB channels:
 *  1. along each segment, two colour samples are taken a few px away from it, one on the purple side and one on the
 *     rock side (mean + 3x3 covariance of the RGB values: the rock is noisy, so the spread matters as much as the mean);
 *  2. the Fisher discriminant w = S^-1 (mean_in - mean_out) turns every pixel into one number s: ~1 amethyst, ~0 rock,
 *     using whichever combination of R, G, B separates the two colours best (it is not a hue threshold any more);
 *  3. at stations every ~2 px along the segment, the profile of s across the segment (averaged over a short stretch
 *     to beat the texture noise) is fitted with a step function, the edge being where the best step sits (sub-pixel);
 *  4. a straight line d = a + b*t is fitted to those edge points with iterative re-weighting (outliers such as a neighbouring
 *     cube or a pale texel on the edge get ignored). If too few stations agree, the mask line is kept.
 * Returns new segments (same shape, coords at an's resolution) with .refined, .shift (px moved at photo resolution, mean)
 * and .ox1.. (the original mask line). Works at the photo's own resolution (up to maxW px wide), not the mask's.
 */
let REFINE_PIXELS = null
function refineLinesRGB(img, an, segs, opts) {
    let o = Object.assign({ maxW: 2400, R: 10, bandIn: 5, bandOut: 14, avgAlong: 4, minStations: 0.35, maxRms: 1.6 }, opts)
    let scale = Math.min(1, o.maxW / img.naturalWidth), w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
    if (!REFINE_PIXELS || REFINE_PIXELS.src !== img.src || REFINE_PIXELS.w !== w) { // the photo is read once, not at every call
        REFINE_PIXELS = { src: img.src, w, data: photoCanvas(img, w, h).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data }
    }
    let px = REFINE_PIXELS.data, k = w / an.w // an coords -> refine coords
    const rgbAt = (x, y, out) => { // bilinear
        x = Math.min(w - 1.001, Math.max(0, x)); y = Math.min(h - 1.001, Math.max(0, y))
        let x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = (y0 * w + x0) * 4, j = i + w * 4
        for (let c = 0; c < 3; c++) out[c] = (px[i + c] * (1 - fx) + px[i + 4 + c] * fx) * (1 - fy) + (px[j + c] * (1 - fx) + px[j + 4 + c] * fx) * fy
    }
    const maskAt = (x, y) => { // x,y in photo-resolution coords; the "is it amethyst here" test reads the mask (an coords)
        let xi = Math.round(x / k), yi = Math.round(y / k); return xi >= 0 && xi < an.w && yi >= 0 && yi < an.h ? an.data[yi * an.w + xi] : 0
    }
    const inv3 = (m) => {
        let [a, b, c, d, e, f, g, h2, i] = m, A = e * i - f * h2, B = -(d * i - f * g), C = d * h2 - e * g, det = a * A + b * B + c * C
        if (Math.abs(det) < 1e-9) return null
        return [A / det, -(b * i - c * h2) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h2 - b * g) / det, (a * e - b * d) / det]
    }
    let out = [], tmp = [0, 0, 0]
    for (let seg of segs) {
        let keep = Object.assign({}, seg, { refined: false, shift: 0, ox1: seg.x1, oy1: seg.y1, ox2: seg.x2, oy2: seg.y2 })
        out.push(keep)
        let x1 = seg.x1 * k, y1 = seg.y1 * k, x2 = seg.x2 * k, y2 = seg.y2 * k, L = Math.hypot(x2 - x1, y2 - y1)
        if (L < 24) continue
        let tx = (x2 - x1) / L, ty = (y2 - y1) / L, nx = -ty, ny = tx
        // which side of the segment is purple (mask, 6 px away): flip the normal so that +d points into the amethyst
        let plus = 0, minus = 0, cnt = 0
        for (let t = 0.15 * L; t <= 0.85 * L; t += 4) { plus += maskAt(x1 + tx * t + nx * 8, y1 + ty * t + ny * 8); minus += maskAt(x1 + tx * t - nx * 8, y1 + ty * t - ny * 8); cnt++ }
        if (plus === minus) continue
        if (minus > plus) { nx = -nx; ny = -ny }
        // colour statistics of the two sides
        let st = [{ n: 0, m: [0, 0, 0], q: new Array(9).fill(0) }, { n: 0, m: [0, 0, 0], q: new Array(9).fill(0) }] // [rock, amethyst]
        for (let t = 0.1 * L; t <= 0.9 * L; t += 2) for (let side = 0; side < 2; side++) for (let d = o.bandIn; d <= o.bandOut; d += 3) {
            let sd = side ? d : -d
            rgbAt(x1 + tx * t + nx * sd, y1 + ty * t + ny * sd, tmp)
            let S = st[side]; S.n++
            for (let a = 0; a < 3; a++) { S.m[a] += tmp[a]; for (let b = 0; b < 3; b++) S.q[a * 3 + b] += tmp[a] * tmp[b] }
        }
        if (st[0].n < 20 || st[1].n < 20) continue
        let cov = new Array(9).fill(0)
        for (let S of st) { for (let a = 0; a < 3; a++) S.m[a] /= S.n; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a * 3 + b] += (S.q[a * 3 + b] / S.n - S.m[a] * S.m[b]) / 2 }
        for (let a = 0; a < 3; a++) cov[a * 4] += 4 // ridge: keeps the inverse sane when a channel is nearly constant
        let ci = inv3(cov)
        if (!ci) continue
        let dm = [st[1].m[0] - st[0].m[0], st[1].m[1] - st[0].m[1], st[1].m[2] - st[0].m[2]]
        let wv = [0, 1, 2].map((a) => ci[a * 3] * dm[0] + ci[a * 3 + 1] * dm[1] + ci[a * 3 + 2] * dm[2])
        let s0 = wv[0] * st[0].m[0] + wv[1] * st[0].m[1] + wv[2] * st[0].m[2], s1 = wv[0] * st[1].m[0] + wv[1] * st[1].m[1] + wv[2] * st[1].m[2]
        if (s1 - s0 < 1e-6) continue
        const score = (x, y) => { rgbAt(x, y, tmp); return ((wv[0] * tmp[0] + wv[1] * tmp[1] + wv[2] * tmp[2]) - s0) / (s1 - s0) } // 0 = rock, 1 = amethyst
        // edge position at each station: best step function over d in [-R, R] (step 0.5 px, then a parabola for sub-pixel)
        let nd = Math.round(4 * o.R) + 1, prof = new Float32Array(nd), pts = []
        for (let t = 2; t <= L - 2; t += 2) {
            for (let i = 0; i < nd; i++) {
                let d = -o.R + i * 0.5, acc = 0, m = 0
                for (let a = -o.avgAlong; a <= o.avgAlong; a += 2) { acc += score(x1 + tx * (t + a) + nx * d, y1 + ty * (t + a) + ny * d); m++ }
                prof[i] = Math.max(-0.5, Math.min(1.5, acc / m))
            }
            // SSE(e) for an edge between samples e-1 and e: samples before e should be 0, from e on 1
            let before = 0, after = 0
            for (let i = 0; i < nd; i++) after += (1 - prof[i]) * (1 - prof[i])
            let best = Infinity, bi = -1, sse = new Float32Array(nd + 1), flat0 = 0, flat1 = after
            for (let i = 0; i < nd; i++) flat0 += prof[i] * prof[i]
            for (let e = 0; e <= nd; e++) {
                sse[e] = before + after
                if (e < nd) { before += prof[e] * prof[e]; after -= (1 - prof[e]) * (1 - prof[e]) }
            }
            for (let e = 2; e <= nd - 2; e++) if (sse[e] < best) { best = sse[e]; bi = e }
            if (bi < 0 || best > 0.5 * Math.min(flat0, flat1)) continue // no clear step here
            let off = 0
            if (bi > 0 && bi < nd) { let a = sse[bi - 1], b = sse[bi], c = sse[bi + 1], den = a - 2 * b + c; if (den > 1e-9) off = Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) }
            pts.push({ t, d: -o.R + (bi - 0.5 + off) * 0.5 })
        }
        if (o.dbg) o.dbg.push({ L: Math.round(L), st: Math.floor((L - 4) / 2), pts: pts.length })
        if (pts.length < o.minStations * (L / 2) || pts.length < 8) continue
        // robust line d = a + b t (iterative re-weighting, Tukey bisquare on residuals)
        let A = 0, B = 0, wts = pts.map(() => 1), rms = 0
        for (let it = 0; it < 12; it++) {
            let sw = 0, st2 = 0, sd = 0, stt = 0, std = 0
            pts.forEach((p, i) => { let ww = wts[i]; sw += ww; st2 += ww * p.t; sd += ww * p.d; stt += ww * p.t * p.t; std += ww * p.t * p.d })
            let den = sw * stt - st2 * st2
            if (Math.abs(den) < 1e-9) break
            B = (sw * std - st2 * sd) / den; A = (sd - B * st2) / sw
            let res = pts.map((p) => p.d - (A + B * p.t)), sorted = res.map(Math.abs).sort((a, b) => a - b), mad = sorted[sorted.length >> 1] / 0.6745 + 0.15, c = 4.7 * mad
            wts = res.map((r) => Math.abs(r) < c ? Math.pow(1 - (r / c) * (r / c), 2) : 0)
        }
        let inl = pts.filter((_, i) => wts[i] > 0.05)
        if (inl.length < Math.max(8, o.minStations * (L / 2))) continue
        rms = Math.sqrt(inl.reduce((s, p) => s + (p.d - (A + B * p.t)) ** 2, 0) / inl.length)
        if (rms > o.maxRms || Math.abs(B) > 0.15) continue
        let da = A, db = A + B * L // offsets of the two ends along the normal (+ = towards the amethyst)
        keep.x1 = (x1 + nx * da) / k; keep.y1 = (y1 + ny * da) / k; keep.x2 = (x2 + nx * db) / k; keep.y2 = (y2 + ny * db) / k
        keep.len = Math.hypot(keep.x2 - keep.x1, keep.y2 - keep.y1)
        keep.refined = true; keep.shift = (Math.abs(da) + Math.abs(db)) / 2; keep.res = rms; keep.stations = inl.length
    }
    return out
}

/** For each line: the world axis (0=X, 1=Y/vertical, 2=Z) whose vanishing point, for camera `cal`, it points at best, and the angular error in degrees (axis = -1 if the error is over tolDeg). Sets line.axis and line.err. */
function classifyLines(lines, cal, tolDeg) {
    let an = cal.an, f = focalPx(cal.fov, an.h), cx = an.w / 2, cy = an.h / 2
    let ax = cameraAxes(cal.pitch, cal.yaw)
    let V = [ax.ex, ax.ey, ax.ez].map((d) => ({ w: d[2], x: cx * d[2] + f * d[0], y: cy * d[2] + f * d[1] }))
    for (let L of lines) {
        let mx = (L.x1 + L.x2) / 2, my = (L.y1 + L.y2) / 2, tx = (L.x2 - L.x1) / L.len, ty = (L.y2 - L.y1) / L.len
        let best = -1, bestErr = Infinity
        V.forEach((v, a) => {
            let dx = v.x - mx * v.w, dy = v.y - my * v.w, n = Math.hypot(dx, dy)
            if (n < 1e-9) return
            let err = Math.asin(Math.min(1, Math.abs(tx * dy - ty * dx) / n)) * 180 / Math.PI
            if (err < bestErr) { bestErr = err; best = a }
        })
        L.err = bestErr; L.axis = bestErr <= tolDeg ? best : -1
    }
}
