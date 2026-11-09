/**
 * Step 0 of the real-world reconstruction idea: given a Minecraft screenshot of a geode, find
 * the camera's FOV/orientation so the ore blocks visible in the photo can be placed back into
 * the 3D grid. This file holds the automatic fit + cube finder (OpenCV.js).
 *
 * OpenCV.js is loaded async from a CDN (index.html) and can take a few seconds (~10MB) - cvReady
 * flips once it's usable; callers should check it first.
 */
let cvReady = false
// The script's onload fires when the file is downloaded, NOT when the WASM runtime is initialised: at that moment cv can be
// a promise, or an object without cv.Mat yet ("cv.Mat is not a constructor"). So cvReady only flips once cv.Mat really exists.
function onOpenCvReady(resolved) {
    if (!resolved && typeof cv !== 'undefined' && cv && typeof cv.then === 'function') { // some builds expose cv as a promise of the module
        cv.then((m) => { window.cv = m; onOpenCvReady(true) }) // `true`: do not take this branch again (the module itself may still have a .then)
        return
    }
    let tries = 0
    let poll = setInterval(() => {
        if (typeof cv !== 'undefined' && cv && typeof cv.Mat === 'function') { clearInterval(poll); cvReady = true }
        else if (++tries > 600) clearInterval(poll) // 60 s: give up quietly
    }, 100)
}

/* ------------------------------------------------------------------------------------------
 * Automatic calibration (no human input). Hough on the whole photo is hopeless on a busy rock
 * wall, but the amethyst blocks are easy to segment by colour and their silhouette edges are
 * clean, axis-aligned world lines. Minecraft has no camera roll, so the camera is fully described
 * by pitch / yaw / vertical FOV; we grid-search those 3 numbers so that as many silhouette edge
 * pixels as possible point at one of the 3 world-axis vanishing points. Then the lattice is
 * anchored on the blob that best looks like a single isolated cube, and every other lattice cell
 * is tested against the mask to list the cubes (integer offsets from that reference cube).
 * ---------------------------------------------------------------------------------------- */

/** Amethyst colour range in OpenCV HSV (H 0-180): shared by the camera-fit mask and the line extractor */
const PURPLE_LO = [115, 70, 20, 0], PURPLE_HI = [160, 255, 255, 255] // V >= 20, not 70: in survival / dim caves the amethyst is dark but keeps its hue and saturation (rock stays low-saturation)

/** World axes (X, Y=up, Z) expressed in camera coords (x right, y down, z forward) for a camera pitched `pitch` deg down and yawed `yaw` deg about the vertical */
function cameraAxes(pitchDeg, yawDeg) {
    let th = pitchDeg * Math.PI / 180, ps = yawDeg * Math.PI / 180
    let st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(ps), cp = Math.cos(ps)
    let r = [cp, 0, -sp], dn = [-st * sp, -ct, -st * cp], fw = [ct * sp, -st, ct * cp]
    return { ex: [r[0], dn[0], fw[0]], ey: [r[1], dn[1], fw[1]], ez: [r[2], dn[2], fw[2]] }
}

/** Purple (amethyst) mask at <= maxW px wide, plus a random sample of its boundary pixels with local tangent direction */
function amethystAnalysis(img, o) {
    let scale = Math.min(1, o.maxW / img.naturalWidth)
    let w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
    let canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    let src = cv.imread(canvas), rgb = new cv.Mat(), hsv = new cv.Mat(), mask = new cv.Mat()
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB)
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)
    let lo = new cv.Mat(h, w, hsv.type(), PURPLE_LO), hi = new cv.Mat(h, w, hsv.type(), PURPLE_HI)
    cv.inRange(hsv, lo, hi, mask)
    let k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3))
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k)
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, k)
    let raw = mask.clone() // unfilled mask: the camera fit uses its edges (filling changes silhouettes enough to shift the fit)
    // looser "purple-ish" test used only to judge whether a cube's visible part is really amethyst: also accepts the pale pink texels
    // (low saturation) of big close cubes, still rejects brown dirt (orange hue) and grey stone (no saturation)
    let loose = new cv.Mat(), llo = new cv.Mat(h, w, hsv.type(), [125, 25, 18, 0]), lhi = new cv.Mat(h, w, hsv.type(), [175, 255, 255, 255]) // hue from 125 (amethyst ~131-141) so bluish rock never counts; V from 18 for dim light
    cv.inRange(hsv, llo, lhi, loose)
    // fill holes: the pale pink highlights of a big (close) cube texture fail the saturation threshold and would punch holes in its silhouette
    let contours = new cv.MatVector(), hier = new cv.Mat()
    cv.findContours(mask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    for (let i = 0; i < contours.size(); i++) cv.drawContours(mask, contours, i, new cv.Scalar(255), -1)
    contours.delete(); hier.delete()
    let data = new Uint8Array(w * h), rawData = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) { data[i] = mask.data[i] ? 1 : 0; rawData[i] = loose.data[i] ? 1 : 0 }

    let mf = new cv.Mat(), gx = new cv.Mat(), gy = new cv.Mat()
    raw.convertTo(mf, cv.CV_32F, 1 / 255)
    cv.GaussianBlur(mf, mf, new cv.Size(0, 0), 1.3)
    cv.Sobel(mf, gx, cv.CV_32F, 1, 0, 3); cv.Sobel(mf, gy, cv.CV_32F, 0, 1, 3)
    let cand = []
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
        let i = y * w + x, a = gx.data32F[i], b = gy.data32F[i], m = Math.hypot(a, b)
        if (m > 0.5) cand.push({ x, y, tx: b / m, ty: -a / m })
    }
    let seed = 12345
    let rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    for (let i = cand.length - 1; i > 0; i--) { let j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]] }
    let samples = cand.slice(0, o.nPix)

    for (let m of [src, rgb, hsv, mask, raw, loose, llo, lhi, lo, hi, k, mf, gx, gy]) m.delete()
    return { w, h, scale, data, raw: rawData, samples }
}

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
    let canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    let src = cv.imread(canvas), rgb = new cv.Mat(), hsv = new cv.Mat(), mask = new cv.Mat()
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB)
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)
    let lo = new cv.Mat(h, w, hsv.type(), PURPLE_LO), hi = new cv.Mat(h, w, hsv.type(), PURPLE_HI)
    cv.inRange(hsv, lo, hi, mask)
    let k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3))
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k)
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, k)
    let fillC = new cv.MatVector(), fillH = new cv.Mat()
    cv.findContours(mask, fillC, fillH, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    for (let i = 0; i < fillC.size(); i++) cv.drawContours(mask, fillC, i, new cv.Scalar(255), -1)
    fillC.delete(); fillH.delete()
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
    for (let mm of [src, rgb, hsv, mask, lo, hi, k]) mm.delete()
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
        let canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        let ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, w, h)
        REFINE_PIXELS = { src: img.src, w, data: ctx.getImageData(0, 0, w, h).data }
    }
    let px = REFINE_PIXELS.data, k = w / an.w // an coords -> refine coords
    const rgbAt = (x, y, out) => { // bilinear
        x = Math.min(w - 1.001, Math.max(0, x)); y = Math.min(h - 1.001, Math.max(0, y))
        let x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = (y0 * w + x0) * 4, j = i + w * 4
        for (let c = 0; c < 3; c++) out[c] = (px[i + c] * (1 - fx) + px[i + 4 + c] * fx) * (1 - fy) + (px[j + c] * (1 - fx) + px[j + 4 + c] * fx) * fy
    }
    const maskAt = (x, y) => { // x,y in photo-resolution coords; the "is it amethyst here" test works in `an` coords (the mask by default, or o.sideFn)
        if (o.sideFn) return o.sideFn(x / k, y / k)
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

/**
 * EXPERIMENT: lines found with no binary mask. The HSV mask is used ONLY to learn what amethyst and rock look like in RGB
 * (global Fisher discriminant, amethyst seeds vs pixels >= 12 px away from any seed); from there on the geometry comes from
 * the soft map P (0 rock .. 1 amethyst, per pixel, from all three channels): Canny on P, probabilistic Hough, duplicate
 * suppression, then refineLinesRGB (side of the amethyst read from P, not from the mask).
 * Returns segments in an's resolution, same shape as extractMaskLines().segs (+ refined/shift/res).
 */
function extractSoftLines(img, an, opts) {
    let o = Object.assign({ maxW: 1600, blur: 1.2, canny1: 35, canny2: 90, houghThr: 35, minLen: 24, maxGap: 4, dupPx: 3, dupDeg: 3 }, opts)
    let scale = Math.min(1, o.maxW / img.naturalWidth), w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
    let canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    let src = cv.imread(canvas), rgb = new cv.Mat(), hsv = new cv.Mat(), seed = new cv.Mat(), near = new cv.Mat()
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB); cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)
    let lo = new cv.Mat(h, w, hsv.type(), PURPLE_LO), hi = new cv.Mat(h, w, hsv.type(), PURPLE_HI)
    cv.inRange(hsv, lo, hi, seed)
    let kk = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(25, 25))
    cv.dilate(seed, near, kk)
    // class statistics (mean, covariance) of amethyst seeds and of rock far from any seed
    let S = [{ n: 0, m: [0, 0, 0], q: new Array(9).fill(0) }, { n: 0, m: [0, 0, 0], q: new Array(9).fill(0) }], d = rgb.data
    for (let i = 0; i < w * h; i += 3) { // every 3rd pixel is plenty
        let c = seed.data[i] ? 1 : near.data[i] ? -1 : 0
        if (c < 0) continue
        let s = S[c], r = d[i * 3], g = d[i * 3 + 1], b = d[i * 3 + 2], v = [r, g, b]
        s.n++
        for (let a = 0; a < 3; a++) { s.m[a] += v[a]; for (let e = 0; e < 3; e++) s.q[a * 3 + e] += v[a] * v[e] }
    }
    let P = null
    if (S[0].n > 500 && S[1].n > 200) {
        let cov = new Array(9).fill(0)
        for (let s of S) { for (let a = 0; a < 3; a++) s.m[a] /= s.n; for (let a = 0; a < 3; a++) for (let e = 0; e < 3; e++) cov[a * 3 + e] += (s.q[a * 3 + e] / s.n - s.m[a] * s.m[e]) / 2 }
        for (let a = 0; a < 3; a++) cov[a * 4] += 4
        let [ca, cb, cc, cd, ce, cf, cg, ch, ci2] = cov, A = ce * ci2 - cf * ch, B = -(cd * ci2 - cf * cg), C = cd * ch - ce * cg, det = ca * A + cb * B + cc * C
        let inv = [A, -(cb * ci2 - cc * ch), cb * cf - cc * ce, B, ca * ci2 - cc * cg, -(ca * cf - cc * cd), C, -(ca * ch - cb * cg), ca * ce - cb * cd].map((v) => v / det)
        let dm = [0, 1, 2].map((a) => S[1].m[a] - S[0].m[a]), wv = [0, 1, 2].map((a) => inv[a * 3] * dm[0] + inv[a * 3 + 1] * dm[1] + inv[a * 3 + 2] * dm[2])
        let s0 = wv[0] * S[0].m[0] + wv[1] * S[0].m[1] + wv[2] * S[0].m[2], s1 = wv[0] * S[1].m[0] + wv[1] * S[1].m[1] + wv[2] * S[1].m[2]
        P = new Float32Array(w * h)
        for (let i = 0; i < w * h; i++) P[i] = Math.max(0, Math.min(1, ((wv[0] * d[i * 3] + wv[1] * d[i * 3 + 1] + wv[2] * d[i * 3 + 2]) - s0) / (s1 - s0)))
    }
    let segs = []
    if (P) {
        let p8 = new cv.Mat(h, w, cv.CV_8U), edges = new cv.Mat(), lines = new cv.Mat()
        for (let i = 0; i < w * h; i++) p8.data[i] = Math.round(P[i] * 255)
        cv.GaussianBlur(p8, p8, new cv.Size(0, 0), o.blur)
        cv.Canny(p8, edges, o.canny1, o.canny2)
        cv.HoughLinesP(edges, lines, 1, Math.PI / 360, o.houghThr, o.minLen, o.maxGap)
        let raw = []
        for (let i = 0; i < lines.rows; i++) { let x1 = lines.data32S[i * 4], y1 = lines.data32S[i * 4 + 1], x2 = lines.data32S[i * 4 + 2], y2 = lines.data32S[i * 4 + 3]; raw.push({ x1, y1, x2, y2, len: Math.hypot(x2 - x1, y2 - y1) }) }
        raw.sort((a, b) => b.len - a.len)
        const dist = (u, x, y) => Math.abs((x - u.x1) * (u.y2 - u.y1) - (y - u.y1) * (u.x2 - u.x1)) / u.len
        let kept = []
        for (let s of raw) { // drop a segment that lies on a longer one already kept (same direction, both ends on its line)
            let dup = kept.some((u) => Math.acos(Math.min(1, Math.abs(((u.x2 - u.x1) * (s.x2 - s.x1) + (u.y2 - u.y1) * (s.y2 - s.y1)) / (u.len * s.len)))) * 180 / Math.PI < o.dupDeg && dist(u, s.x1, s.y1) < o.dupPx && dist(u, s.x2, s.y2) < o.dupPx)
            if (!dup) kept.push(s)
        }
        let ks = an.w / w
        segs = kept.map((s) => ({ x1: s.x1 * ks, y1: s.y1 * ks, x2: s.x2 * ks, y2: s.y2 * ks, len: s.len * ks, rms: 0, inFrac: 1, outFrac: 1 }))
        for (let m of [p8, edges, lines]) m.delete()
    }
    for (let m of [src, rgb, hsv, seed, near, lo, hi, kk]) m.delete()
    if (!P) return { segs: [], P: null }
    let kS = w / an.w // an coords -> P coords
    let sideFn = (x, y) => { let xi = Math.round(x * kS), yi = Math.round(y * kS); return xi >= 0 && xi < w && yi >= 0 && yi < h && P[yi * w + xi] > 0.5 ? 1 : 0 }
    return { segs: refineLinesRGB(img, an, segs, { sideFn }), P, w, h }
}

/** For each line: the world axis (0=X, 1=Y/vertical, 2=Z) whose vanishing point, for camera `cal`, it points at best, and the angular error in degrees (axis = -1 if the error is over tolDeg). Sets line.axis and line.err. */
function classifyLines(lines, cal, tolDeg) {
    let an = cal.an, f = (an.h / 2) / Math.tan(cal.fov * Math.PI / 360), cx = an.w / 2, cy = an.h / 2
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

/** Last template learned from a photo (8 orientations): photos taken in the same game share the texture, and a photo whose cubes are too small/far to learn from can start from it. A wrong one is caught by the texUsed safeguard. */
let TEMPLATE_CACHE = null

/**
 * The real 16x16 amethyst texture is identical on all faces of all amethyst blocks, so a face warped back to 16x16 with the right
 * geometry must look like it. Context = luminance of the photo (<= 2400 px wide) + the texture in its 8 orientations. Needs the global
 * TEXTURE_DATA (js/TextureData.js). Returns null if the texture can't be loaded.
 */
async function makeTextureContext(img) {
    if (typeof TEXTURE_DATA === 'undefined' || !TEXTURE_DATA.amethyst_block) return null
    let W = Math.min(2400, img.naturalWidth), sc = W / img.naturalWidth, H = Math.round(img.naturalHeight * sc)
    let c = document.createElement('canvas')
    c.width = W; c.height = H
    let g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, 0, 0, W, H)
    let d = g.getImageData(0, 0, W, H).data, lum = new Float32Array(W * H)
    for (let i = 0; i < W * H; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
    let timg = await new Promise((res) => { let im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = TEXTURE_DATA.amethyst_block })
    if (!timg) return null
    let tc = document.createElement('canvas')
    tc.width = 16; tc.height = 16
    let tg = tc.getContext('2d')
    tg.drawImage(timg, 0, 0)
    let td = tg.getImageData(0, 0, 16, 16).data, T = new Float32Array(256)
    for (let i = 0; i < 256; i++) T[i] = 0.299 * td[i * 4] + 0.587 * td[i * 4 + 1] + 0.114 * td[i * 4 + 2]
    let Tv = []
    for (let k = 0; k < 8; k++) { // the 8 dihedral variants (rotations x flip): the orientation of the texture on each face is not assumed
        let o = new Float32Array(256)
        for (let v = 0; v < 16; v++) for (let u = 0; u < 16; u++) { let uu = u, vv = v; if (k & 1) uu = 15 - uu; if (k & 2) vv = 15 - vv; if (k & 4) { let t = uu; uu = vv; vv = t } o[v * 16 + u] = T[vv * 16 + uu] }
        Tv.push(o)
    }
    if (TEMPLATE_CACHE) return { W, H, lum, Tv: TEMPLATE_CACHE, learned: -1 } // learned: -1 = taken from the previous photo (still truthy: it is a learned-quality template)
    return { W, H, lum, Tv }
}

/**
 * The texture in a photo is not necessarily the one in js/TextureData.js (other version / resource pack / lighting): on photo 01 the faces
 * of different cubes agree with EACH OTHER at NCC 0.95 but only 0.46 with the project's amethyst_block.png. So the template is learned from
 * the photo: the visible faces of the cubes whose pose is reliable (poses from cubePoses, >= 4 refined edges) are rectified to
 * 16x16, aligned to each other (best of 8 orientations), and the faces that agree are averaged. Replaces tex.Tv when >= 4 faces agree.
 * Returns the number of faces averaged (0 = kept the project texture).
 */
function learnTexture(tex, cal, poses) {
    let W = tex.W, H = tex.H, f = (H / 2) / Math.tan(cal.fov * Math.PI / 360), ax = cameraAxes(cal.pitch, cal.yaw), axs = [ax.ex, ax.ey, ax.ez]
    const lumAt = (x, y) => { x = Math.min(W - 1.001, Math.max(0, x)); y = Math.min(H - 1.001, Math.max(0, y)); let x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0, L = tex.lum; return (L[i] * (1 - fx) + L[i + 1] * fx) * (1 - fy) + (L[i + W] * (1 - fx) + L[i + W + 1] * fx) * fy }
    const norm = (a) => { let m = 0; for (let i = 0; i < 256; i++) m += a[i]; m /= 256; let s = 0; for (let i = 0; i < 256; i++) s += (a[i] - m) ** 2; s = Math.sqrt(s / 256) || 1; let o = new Float32Array(256); for (let i = 0; i < 256; i++) o[i] = (a[i] - m) / s; return o }
    const dih = (a, k) => { let o = new Float32Array(256); for (let v = 0; v < 16; v++) for (let u = 0; u < 16; u++) { let uu = u, vv = v; if (k & 1) uu = 15 - uu; if (k & 2) vv = 15 - vv; if (k & 4) { let t = uu; uu = vv; vv = t } o[v * 16 + u] = a[vv * 16 + uu] } return o }
    const corr = (a, b) => { let s = 0; for (let i = 0; i < 256; i++) s += a[i] * b[i]; return s / 256 } // both are z-scored
    let faces = []
    for (let q of poses) {
        if (q.nref < 4 || q.z > 14) continue
        for (let a = 0; a < 3; a++) for (let sg of [-1, 1]) {
            let A = axs[a], U = axs[(a + 1) % 3], V = axs[(a + 2) % 3], P = q.P, fc = [P[0] + sg * 0.5 * A[0], P[1] + sg * 0.5 * A[1], P[2] + sg * 0.5 * A[2]]
            if (sg * (A[0] * fc[0] + A[1] * fc[1] + A[2] * fc[2]) >= 0) continue
            let patch = new Float32Array(256)
            for (let v = 0; v < 16; v++) for (let u = 0; u < 16; u++) {
                let acc = 0
                for (let sv = 0; sv < 3; sv++) for (let su = 0; su < 3; su++) { let uu = (u + (su + 0.5) / 3) / 16 - 0.5, vv = (v + (sv + 0.5) / 3) / 16 - 0.5, X = fc[0] + uu * U[0] + vv * V[0], Y = fc[1] + uu * U[1] + vv * V[1], Z = fc[2] + uu * U[2] + vv * V[2]; acc += lumAt(W / 2 + f * X / Z, H / 2 + f * Y / Z) }
                patch[v * 16 + u] = acc / 9
            }
            faces.push({ cube: q, p: norm(patch) })
        }
    }
    if (faces.length < 4) return 0
    // reference = the face that agrees best with the others (from different cubes), orientation-free
    let bestRef = -1, bestSum = -1
    for (let i = 0; i < faces.length; i++) {
        let sum = 0
        for (let j = 0; j < faces.length; j++) { if (faces[j].cube === faces[i].cube) continue; let b = -2; for (let k = 0; k < 8; k++) b = Math.max(b, corr(dih(faces[j].p, k), faces[i].p)); sum += Math.max(0, b) }
        if (sum > bestSum) { bestSum = sum; bestRef = i }
    }
    let ref = faces[bestRef].p, acc = new Float32Array(256), n = 0
    for (let it = 0; it < 2; it++) { // average the faces that agree with the reference (2 rounds: the second one uses the average itself as reference)
        acc.fill(0); n = 0
        for (let fcs of faces) {
            let b = -2, bk = 0
            for (let k = 0; k < 8; k++) { let c = corr(dih(fcs.p, k), ref); if (c > b) { b = c; bk = k } }
            if (b < 0.8) continue
            let al = dih(fcs.p, bk)
            for (let i = 0; i < 256; i++) acc[i] += al[i]
            n++
        }
        if (n < 4) return 0
        ref = norm(acc)
    }
    let Tv = []
    for (let k = 0; k < 8; k++) Tv.push(dih(ref, k))
    tex.Tv = Tv
    tex.learned = n
    TEMPLATE_CACHE = Tv
    return n
}

/**
 * Is the template (tex.Tv) really what the cubes with a reliable pose show in THIS photo? Mean correlation (best of 8 orientations) of
 * their rectified faces with the template, over the best 70% of the faces. A wrong template (other texture pack, bad geometry) does worse
 * than 0.5 and must not steer the lattice. Returns null when fewer than 3 faces can be judged.
 */
function templateQuality(tex, cal, poses) {
    let W = tex.W, H = tex.H, f = (H / 2) / Math.tan(cal.fov * Math.PI / 360), ax = cameraAxes(cal.pitch, cal.yaw), axs = [ax.ex, ax.ey, ax.ez], vals = []
    const lumAt = (x, y) => { x = Math.min(W - 1.001, Math.max(0, x)); y = Math.min(H - 1.001, Math.max(0, y)); let x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0, L = tex.lum; return (L[i] * (1 - fx) + L[i + 1] * fx) * (1 - fy) + (L[i + W] * (1 - fx) + L[i + W + 1] * fx) * fy }
    const z = (a) => { let m = 0; for (let i = 0; i < 256; i++) m += a[i]; m /= 256; let s = 0; for (let i = 0; i < 256; i++) s += (a[i] - m) ** 2; s = Math.sqrt(s / 256) || 1; let o = new Float32Array(256); for (let i = 0; i < 256; i++) o[i] = (a[i] - m) / s; return o }
    let Tz = tex.Tv.map(z)
    for (let q of poses) {
        if (q.nref < 3 || q.z > 16) continue
        for (let a = 0; a < 3; a++) for (let sg of [-1, 1]) {
            let A = axs[a], U = axs[(a + 1) % 3], V = axs[(a + 2) % 3], P = q.P, fc = [P[0] + sg * 0.5 * A[0], P[1] + sg * 0.5 * A[1], P[2] + sg * 0.5 * A[2]]
            if (sg * (A[0] * fc[0] + A[1] * fc[1] + A[2] * fc[2]) >= 0) continue
            let patch = new Float32Array(256)
            for (let v = 0; v < 16; v++) for (let u = 0; u < 16; u++) {
                let acc = 0
                for (let sv = 0; sv < 3; sv++) for (let su = 0; su < 3; su++) { let uu = (u + (su + 0.5) / 3) / 16 - 0.5, vv = (v + (sv + 0.5) / 3) / 16 - 0.5, X = fc[0] + uu * U[0] + vv * V[0], Y = fc[1] + uu * U[1] + vv * V[1], Zc = fc[2] + uu * U[2] + vv * V[2]; acc += lumAt(W / 2 + f * X / Zc, H / 2 + f * Y / Zc) }
                patch[v * 16 + u] = acc / 9
            }
            let pz = z(patch), best = -2
            for (let t = 0; t < 8; t++) { let s = 0; for (let i = 0; i < 256; i++) s += pz[i] * Tz[t][i]; best = Math.max(best, s / 256) }
            vals.push(best)
        }
    }
    if (vals.length < 3) return null
    vals.sort((a, b) => b - a)
    let top = vals.slice(0, Math.max(3, Math.ceil(vals.length * 0.7)))
    return top.reduce((s, x) => s + x, 0) / top.length
}

/**
 * How well the real texture explains the visible faces of the cube centred at P (camera coords) for the geometry geo = {fov, ax}:
 * each visible face is sampled on a 16x16 grid (2x2 per texel) from the photo and correlated (zero-mean NCC, shading-invariant) with the
 * texture, best of 8 orientations. Texels whose pixel is not purple (an.raw) or is already explained by a nearer cell (cov) are ignored.
 * Returns {ncc, valid} (ncc averaged over faces weighted by valid texels) or null when fewer than 48 texels can be judged.
 */
function textureScore(tex, an, geo, P, cov) {
    let W = tex.W, H = tex.H, f = (H / 2) / Math.tan(geo.fov * Math.PI / 360), ax = geo.ax, k = an.w / W, axs = [ax.ex, ax.ey, ax.ez]
    const lumAt = (x, y) => { x = Math.min(W - 1.001, Math.max(0, x)); y = Math.min(H - 1.001, Math.max(0, y)); let x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0, L = tex.lum; return (L[i] * (1 - fx) + L[i + 1] * fx) * (1 - fy) + (L[i + W] * (1 - fx) + L[i + W + 1] * fx) * fy }
    let sum = 0, wsum = 0, patch = new Float32Array(256), ok = new Uint8Array(256)
    for (let a = 0; a < 3; a++) for (let sg of [-1, 1]) {
        let A = axs[a], U = axs[(a + 1) % 3], V = axs[(a + 2) % 3], fc = [P[0] + sg * 0.5 * A[0], P[1] + sg * 0.5 * A[1], P[2] + sg * 0.5 * A[2]]
        if (sg * (A[0] * fc[0] + A[1] * fc[1] + A[2] * fc[2]) >= 0) continue // back face
        let nvalid = 0
        for (let v = 0; v < 16; v++) for (let u = 0; u < 16; u++) {
            let acc = 0, n = 0
            for (let sv = 0; sv < 2; sv++) for (let su = 0; su < 2; su++) {
                let uu = (u + (su + 0.5) / 2) / 16 - 0.5, vv = (v + (sv + 0.5) / 2) / 16 - 0.5
                let X = fc[0] + uu * U[0] + vv * V[0], Y = fc[1] + uu * U[1] + vv * V[1], Z = fc[2] + uu * U[2] + vv * V[2]
                if (Z < 0.3) continue
                let xx = W / 2 + f * X / Z, yy = H / 2 + f * Y / Z, ix = Math.round(xx * k), iy = Math.round(yy * k)
                if (ix < 0 || iy < 0 || ix >= an.w || iy >= an.h) continue
                let idx = iy * an.w + ix
                if ((cov && cov[idx]) || !an.raw[idx]) continue
                acc += lumAt(xx, yy); n++
            }
            let i = v * 16 + u
            if (n >= 3) { patch[i] = acc / n; ok[i] = 1; nvalid++ } else ok[i] = 0
        }
        if (nvalid < 48) continue
        let ma = 0
        for (let i = 0; i < 256; i++) if (ok[i]) ma += patch[i]
        ma /= nvalid
        let best = -2
        for (let t = 0; t < 8; t++) {
            let Tt = tex.Tv[t], mb = 0
            for (let i = 0; i < 256; i++) if (ok[i]) mb += Tt[i]
            mb /= nvalid
            let sab = 0, saa = 0, sbb = 0
            for (let i = 0; i < 256; i++) if (ok[i]) { let x = patch[i] - ma, y = Tt[i] - mb; sab += x * y; saa += x * x; sbb += y * y }
            let r = sab / (Math.sqrt(saa * sbb) || 1)
            if (r > best) best = r
        }
        sum += best * nvalid; wsum += nvalid
    }
    return wsum >= 48 ? { ncc: sum / wsum, valid: wsum } : null
}

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
function selectCellsByRay(res, an, opts) {
    let o = Object.assign({ minPurple: 0.97, loose: true, minFresh: 0.3, minFreshPx: 60, radius: 14, tex: null, minNcc: 0.25, texBase: opts && opts.tex && opts.tex.learned ? 0.4 : 0.25, texW: 120, texPen: 3.5, strongNcc: 0.75, minFreshStrong: 25 }, opts)
    let w = an.w, h = an.h, f = (h / 2) / Math.tan(res.fov * Math.PI / 360), ax = res.ax, O = res.origin
    const T = o.loose ? an.raw : an.data // mask the 'all purple inside' test reads: the strict one, or the loose one that also accepts pale pink texels
    const at = (i, j, k) => [O[0] + i * ax.ex[0] + j * ax.ey[0] + k * ax.ez[0], O[1] + i * ax.ex[1] + j * ax.ey[1] + k * ax.ez[1], O[2] + i * ax.ex[2] + j * ax.ey[2] + k * ax.ez[2]]
    let pool = []
    for (let i = -o.radius; i <= o.radius; i++) for (let j = -o.radius; j <= o.radius; j++) for (let k = -o.radius; k <= o.radius; k++) {
        let P = at(i, j, k)
        if (P[2] < 0.8) continue
        let sx = Math.round(w / 2 + f * P[0] / P[2]), sy = Math.round(h / 2 + f * P[1] / P[2])
        if (sx >= 0 && sx < w && sy >= 0 && sy < h && !T[sy * w + sx]) continue // the centre of a cube whose whole projection is purple is purple: cheap reject before building the hull
        let hl = cubeHull(P, ax, f, w / 2, h / 2)
        if (!hl) continue
        let px = [], pur = 0
        forEachPixelInHull(hl, w, h, (x, y) => { px.push(y * w + x); pur += T[y * w + x] })
        if (px.length < 60 || px.length > w * h / 2 || pur / px.length < o.minPurple) continue
        pool.push({ i, j, k, P, px, purple: pur / px.length })
    }
    pool.sort((p, q) => p.P[2] - q.P[2]) // nearest first
    let cov = new Uint8Array(w * h), cells = [], M = an.data, score = 0, texSum = 0
    for (let c of pool) {
        let fresh = 0
        for (let q of c.px) if (!cov[q]) fresh++
        let small = fresh / c.px.length < o.minFresh || fresh < o.minFreshPx // little of it is visible: a nearer cube hides most of it
        if (small && !(o.tex && o.tex.learned && fresh >= o.minFreshStrong)) continue
        let ncc = null
        if (o.tex) { // the real texture, warped onto the cell's visible faces, must look like the photo there (cells already explained by nearer ones are excluded)
            let ts = textureScore(o.tex, an, res, c.P, cov)
            if (ts) { ncc = ts.ncc; if (ncc < o.minNcc) continue }
            if (small && !(ts && ncc >= o.strongNcc)) continue // a cube mostly hidden behind a nearer one is accepted only when its visible sliver matches the texture strongly (the sliver is real purple that a farther cell would otherwise explain wrongly)
        }
        for (let q of c.px) if (!cov[q]) { cov[q] = 1; score += M[q] ? 1 : -CUBE_BG_WEIGHT }
        if (ncc !== null) texSum += ncc >= o.texBase ? ncc - o.texBase : o.texPen * (ncc - o.texBase) // reward above the baseline, a much harsher penalty below it (a mask gain must not pay for a cell the texture rejects)
        cells.push({ i: c.i, j: c.j, k: c.k, P: c.P, coverage: c.purple, ncc })
    }
    cells.score = score - CUBE_COST * cells.length // how well this lattice geometry explains the mask: used to tune the geometry
    cells.total = cells.score + o.texW * texSum // + how well the real texture fits the chosen cells (smooth in depth, unlike the mask)
    return cells
}

/**
 * The lattice is solved, not searched. With the camera known, a measured line with coefficients (a, b, c) in centred pixels is a plane through the
 * camera with normal n = (a f, b f, c), and the cube edge X it shows lies in that plane: n . X = 0. X is the cube position P plus a known offset
 * (half a side along two axes), so every line is ONE LINEAR EQUATION IN P. Three lines give P; more lines over-determine it and the residual says
 * whether the hypothesis "this is one cube" holds. FOV and distance are not independent trials either: both enter the same equations.
 */

/** Solves A x = b for a 3x3 system (Gaussian elimination, partial pivoting); null when singular */
function solve3x3(A, b) {
    let M = A.map((r, i) => r.concat([b[i]]))
    for (let i = 0; i < 3; i++) {
        let p = i
        for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k
        if (Math.abs(M[p][i]) < 1e-9) return null
        ;[M[i], M[p]] = [M[p], M[i]]
        for (let k = i + 1; k < 3; k++) { let c = M[k][i] / M[i][i]; for (let j = i; j < 4; j++) M[k][j] -= c * M[i][j] }
    }
    let x = [0, 0, 0]
    for (let i = 2; i >= 0; i--) { let s = M[i][3]; for (let j = i + 1; j < 3; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i] }
    return x
}

/** Connected purple blobs of the filled mask, and each blob's outline thinned to ~160 points. Depends only on the mask, so it is computed once per photo. */
function labelBlobs(an) {
    let w = an.w, h = an.h, M = an.data, label = new Int32Array(w * h), blobs = []
    for (let s0 = 0; s0 < w * h; s0++) {
        if (!M[s0] || label[s0]) continue
        let id = blobs.length + 1, stack = [s0], n = 0, sx = 0, sy = 0
        label[s0] = id
        while (stack.length) {
            let q = stack.pop(), x = q % w, y = (q - x) / w
            n++; sx += x; sy += y
            if (x > 0 && M[q - 1] && !label[q - 1]) { label[q - 1] = id; stack.push(q - 1) }
            if (x < w - 1 && M[q + 1] && !label[q + 1]) { label[q + 1] = id; stack.push(q + 1) }
            if (y > 0 && M[q - w] && !label[q - w]) { label[q - w] = id; stack.push(q - w) }
            if (y < h - 1 && M[q + w] && !label[q + w]) { label[q + w] = id; stack.push(q + w) }
        }
        blobs.push({ id, n, u: sx / n, v: sy / n, pts: [] })
    }
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        let l = label[y * w + x]
        if (!l) continue
        if (label[y * w + x - 1] !== l || label[y * w + x + 1] !== l || label[(y - 1) * w + x] !== l || label[(y + 1) * w + x] !== l) blobs[l - 1].pts.push([x + 0.5, y + 0.5])
    }
    for (let b of blobs) { let st = Math.max(1, Math.floor(b.pts.length / 160)); b.pts = b.pts.filter((_, i) => i % st === 0) }
    return { label, blobs }
}

/** Line through a segment as (a, b, c) with a^2 + b^2 = 1, in pixels centred on the principal point */
function segmentLine(s, cx, cy) {
    let x1 = s.x1 - cx, y1 = s.y1 - cy, dx = s.x2 - s.x1, dy = s.y2 - s.y1, n = Math.hypot(dx, dy) || 1, a = -dy / n, b = dx / n
    return [a, b, -(a * x1 + b * y1)]
}

/** The visible edges of a unit cube at P: {a: axis it runs along, off: offsets from P along the other two axes (0 on axis a), sil: on the silhouette (one adjacent face visible, not both), p, q: projected ends} */
function cubeEdges(P, ax, f, cx, cy) {
    let E = [ax.ex, ax.ey, ax.ez], out = []
    let vis = [0, 1, 2].map((a) => { let o = {}; for (let s of [-1, 1]) { let n = E[a].map((x) => x * s), c = P.map((x, i) => x + 0.5 * n[i]); o[s] = n[0] * c[0] + n[1] * c[1] + n[2] * c[2] < 0 } return o })
    let at = (o) => [P[0] + o[0] * E[0][0] + o[1] * E[1][0] + o[2] * E[2][0], P[1] + o[0] * E[0][1] + o[1] * E[1][1] + o[2] * E[2][1], P[2] + o[0] * E[0][2] + o[1] * E[1][2] + o[2] * E[2][2]]
    let pr = (X) => [cx + f * X[0] / X[2], cy + f * X[1] / X[2]]
    for (let a = 0; a < 3; a++) {
        let u = (a + 1) % 3, w = (a + 2) % 3
        for (let su of [-1, 1]) for (let sw of [-1, 1]) {
            let v1 = vis[u][su], v2 = vis[w][sw]
            if (!v1 && !v2) continue
            let off = [0, 0, 0]; off[u] = su * 0.5; off[w] = sw * 0.5
            let o1 = off.slice(), o2 = off.slice(); o1[a] = -0.5; o2[a] = 0.5
            let A = at(o1), B = at(o2)
            if (A[2] < 0.3 || B[2] < 0.3) continue
            out.push({ a, off, sil: v1 !== v2, p: pr(A), q: pr(B) })
        }
    }
    return out
}

/** Offset in lattice units -> camera coordinates */
function latticeOffset(off, ax) {
    return [off[0] * ax.ex[0] + off[1] * ax.ey[0] + off[2] * ax.ez[0], off[0] * ax.ex[1] + off[1] * ax.ey[1] + off[2] * ax.ez[1], off[0] * ax.ex[2] + off[1] * ax.ey[2] + off[2] * ax.ez[2]]
}

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
    let w = an.w, h = an.h, cx = w / 2, cy = h / 2, f = (h / 2) / Math.tan(cam.fov * Math.PI / 360), ax = cameraAxes(cam.pitch, cam.yaw), label = lab.label
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
    let w = an.w, h = an.h, cx = w / 2, cy = h / 2, f = (h / 2) / Math.tan(cam.fov * Math.PI / 360), ax = cameraAxes(cam.pitch, cam.yaw), T = an.raw, M = an.data
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

/**
 * Cubes sit at integer offsets from each other: each pose in turn is the reference and predicts where the others should be; the reference most of them agree with wins (a wrong pose agrees with nobody).
 * Returns {O: origin, sup: [{q: pose, n: [i,j,k]}], px: rms misfit on the screen} or null.
 */
function latticeConsensus(poses, cam, W, H, maxPx) {
    let ax = cameraAxes(cam.pitch, cam.yaw), E = [ax.ex, ax.ey, ax.ez], f = (H / 2) / Math.tan(cam.fov * Math.PI / 360), best = null
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

/** Gaussian elimination with partial pivoting for any size; null when singular */
function solveLinear(A, b) {
    let n = b.length, M = A.map((r, i) => r.concat([b[i]]))
    for (let i = 0; i < n; i++) {
        let p = i
        for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k
        if (Math.abs(M[p][i]) < 1e-12) return null
        ;[M[i], M[p]] = [M[p], M[i]]
        for (let k = i + 1; k < n; k++) { let c = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= c * M[i][j] }
    }
    let x = new Array(n)
    for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i] }
    return x
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
        let cand = { pitch: cam.pitch, yaw: cam.yaw, fov: cam.fov, origin: con.O, ax: cameraAxes(cam.pitch, cam.yaw), refIoU: 0, support: con.sup.length, px: con.px, allSegs: segs.concat(measured) }
        if (!best || cand.support > best.support || (cand.support === best.support && cand.px < best.px)) best = cand
        if (asg.length < 6) break
        let v = solveCameraOnLines([cam.pitch, cam.yaw, cam.fov, con.O[0], con.O[1], con.O[2]], asg, W, H, o.fovFixed ? [2] : [])
        let moved = Math.abs(v[0] - cam.pitch) + Math.abs(v[1] - cam.yaw) + Math.abs(v[2] - cam.fov)
        cam = { pitch: v[0], yaw: v[1], fov: v[2] }
        if (moved < 0.02) break
    }
    return best
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
    } else cur = selectCellsByRay(g, an, {})
    g.cubesRay = cur
    return g
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

/** Robust cost of a camera against lines: length-weighted mean of (angular error to the nearest world-axis VP, capped at 4 deg)^2 */
function lineCameraCost(segs, an, c) {
    classifyLines(segs, { pitch: c[0], yaw: c[1], fov: c[2], an }, 0)
    let t = 0, L = 0
    for (let s of segs) { let e = Math.min(s.err, 4); t += s.len * e * e; L += s.len }
    return L ? t / L : Infinity
}

/**
 * Camera (pitch, yaw, FOV) from the colour-refined lines. Minecraft has no roll, so the vertical edges of the blocks all cross the centre column of the image
 * at one height: the vertical vanishing point. Given that height, the pitch is a formula of the FOV (pitch = atan(f / (vpY - cy))), so only FOV x rotation
 * are scanned (18 x 30 cameras instead of 14.760 x 2), each scored by how well ALL the lines point at one of the 3 vanishing points (lineCameraCost).
 * The height is the densest crossing of the steep lines; with few lines the densest one can be a group of horizontal edges, so the 4 densest distinct
 * heights are all tried and the camera that explains the lines best wins. Then a step-halving refinement of the 3 numbers.
 * opts.fovFix keeps the FOV. Returns {pitch, yaw, fov, cost, vpY} or null when there are too few steep lines.
 */
function cameraFromLines(segs, an, opts) {
    let o = Object.assign({ fovMin: 40, fovMax: 110, fovStep: 4, yawStep: 3, nCand: 4, fovFix: null }, opts)
    let cx = an.w / 2, cy = an.h / 2, us = []
    for (let s of segs) {
        let dx = s.x2 - s.x1, dy = s.y2 - s.y1
        if (Math.abs(dy) < Math.abs(dx) * 1.2) continue // steep lines only (within ~40 deg of vertical)
        let len = s.len || Math.hypot(dx, dy)
        if (Math.abs(dx) < 1e-9) { us.push([Math.PI / 2 * Math.sign(dy || 1), len]); continue } // parallel to the column: vanishing point at infinity
        let y = s.y1 + (cx - s.x1) / dx * dy
        us.push([Math.atan((y - cy) / an.h), len]) // angle space: a far vanishing point is handled like a near one
    }
    if (us.length < 2) return null
    let groups = us.map(([u0]) => { let sw = 0, su = 0; for (let [u, w] of us) if (Math.abs(u - u0) < 0.01) { sw += w; su += w * u } return { sw, u: su / sw } }).sort((p, q) => q.sw - p.sw)
    let cands = []
    for (let g of groups) { if (cands.length >= o.nCand) break; if (cands.every((q) => Math.abs(q.u - g.u) > 0.03)) cands.push(g) }
    let S = segs.map((s) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, len: s.len })), best = [Infinity], vpY = 0
    let fovs = []
    if (o.fovFix) fovs.push(o.fovFix); else for (let f = o.fovMin; f <= o.fovMax; f += o.fovStep) fovs.push(f)
    for (let g of cands) {
        let vy = cy + Math.tan(g.u) * an.h
        for (let fov of fovs) {
            let f = (an.h / 2) / Math.tan(fov * Math.PI / 360), pitch = Math.atan(f / (vy - cy)) * 180 / Math.PI // vanishing point below the centre = looking down
            for (let yaw = 0; yaw < 90; yaw += o.yawStep) { let v = lineCameraCost(S, an, [pitch, yaw, fov]); if (v < best[0]) { best = [v, pitch, yaw, fov]; vpY = vy } }
        }
    }
    let cam = [best[1], best[2], best[3]], cost = best[0], step = [2, 2, 3]
    for (let it = 0; it < 80; it++) {
        let improved = false
        for (let d = 0; d < 3; d++) for (let sg of [-1, 1]) {
            if (d === 2 && o.fovFix) continue
            let t = cam.slice(); t[d] += sg * step[d]
            if (t[2] < o.fovMin - 5 || t[2] > o.fovMax + 5) continue
            let v = lineCameraCost(S, an, t)
            if (v < cost) { cost = v; cam = t; improved = true }
        }
        if (!improved) { step = step.map((s) => s / 2); if (step[0] < 0.02) break }
    }
    return { pitch: cam[0], yaw: ((cam[1] % 90) + 90) % 90, fov: cam[2], cost, vpY }
}

/** FALLBACK only (fewer than 6 refined lines, or no steep line): Fits pitch/yaw/FOV to the amethyst silhouette edges; returns {pitch, yaw, fov, support, an} (support = fraction of sampled edge pixels explained by a world axis), or null if there's too little purple to go on */
async function autoCalibrate(img, opts) {
    let o = Object.assign({ maxW: 800, nPix: 1500, tauDeg: 3, fovMin: 40, fovMax: 110, fovFix: null, onMask: null, onStep: null }, opts)
    let an = amethystAnalysis(img, o)
    if (o.onMask && (await o.onMask(an)) === false) return null
    let last = performance.now()
    async function pumpFit(cur, S) {
        if (performance.now() - last < 40) return
        if (o.onStep && o.onStep({ phase: 'fit', pitch: cur.pitch, yaw: cur.yaw, fov: cur.fov, support: cur.sc / S.length }) === false) throw AUTOCAL_CANCELLED
        await tick()
        last = performance.now()
    }
    try {
    let S = an.samples
    if (S.length < 200) return null
    let cx = an.w / 2, cy = an.h / 2, tau = Math.sin(o.tauDeg * Math.PI / 180)

    /** How many of the sampled edge pixels (weighted) point at one of the 3 world-axis vanishing points for this camera; tolSin = sin of the angular tolerance */
    function score(pitch, yaw, fov, samples, tolSin) {
        let f = (an.h / 2) / Math.tan(fov * Math.PI / 360)
        let ax = cameraAxes(pitch, yaw)
        let V = [ax.ex, ax.ey, ax.ez].map((d) => ({ w: d[2], x: cx * d[2] + f * d[0], y: cy * d[2] + f * d[1] }))
        let tot = 0
        for (let s of samples) {
            let best = 0
            for (let v of V) {
                let dx = v.x - s.x * v.w, dy = v.y - s.y * v.w, n = Math.hypot(dx, dy)
                if (n < 1e-9) continue
                let sn = Math.abs(s.tx * dy - s.ty * dx) / n, q = 1 - (sn / tolSin) * (sn / tolSin)
                if (q > best) best = q
            }
            tot += best
        }
        return tot
    }

    // Coarse-to-fine: (1) coarse grid over pitch/yaw/FOV on a small sample with a wide angular tolerance
    // (the basin is wide enough that a 3 deg grid can't miss it), (2) keep the best few distinct seeds,
    // (3) refine each by coordinate descent on all samples with the real tolerance, keep the best.
    // ~50x fewer evaluations than a fine grid everywhere, same answer.
    let fovs = []
    if (o.fovFix) fovs.push(o.fovFix); else for (let v = o.fovMin; v <= o.fovMax; v += 6) fovs.push(v)
    let coarseS = S.slice(0, 300), coarseTol = Math.sin(6 * Math.PI / 180), seeds = []
    let cur = { sc: -1, pitch: 0, yaw: 0, fov: o.fovFix || 70 }
    for (let fov of fovs) for (let pitch = -60; pitch <= 60; pitch += 3) {
        for (let yaw = 0; yaw < 90; yaw += 3) seeds.push({ sc: score(pitch, yaw, fov, coarseS, coarseTol), pitch, yaw, fov })
        await pumpFit({ pitch, yaw: 0, fov, sc: 0 }, S)
    }
    seeds.sort((p, q) => q.sc - p.sc)
    let picked = []
    const yawDist = (p, q) => { let d = Math.abs(p - q) % 90; return Math.min(d, 90 - d) }
    for (let sd of seeds) {
        if (picked.length >= 8) break
        if (picked.every((q) => Math.abs(sd.pitch - q.pitch) > 6 || yawDist(sd.yaw, q.yaw) > 9 || Math.abs(sd.fov - q.fov) > 12)) picked.push(sd)
    }
    for (let sd of picked) {
        let c = { sc: score(sd.pitch, sd.yaw, sd.fov, S, tau), pitch: sd.pitch, yaw: sd.yaw, fov: sd.fov }
        for (let st of [[2, 2, 4], [0.7, 0.7, 1.5], [0.25, 0.25, 0.5], [0.08, 0.08, 0.2]]) {
            for (let round = 0; round < 8; round++) {
                let improved = false, base = c // pitch/yaw/FOV are strongly correlated: look at the whole 3x3x3 neighbourhood, not one axis at a time
                for (let dp = -1; dp <= 1; dp++) for (let dy = -1; dy <= 1; dy++) for (let df = -1; df <= 1; df++) {
                    if ((dp === 0 && dy === 0 && df === 0) || (df && o.fovFix)) continue
                    let pitch = base.pitch + dp * st[0], yaw = base.yaw + dy * st[1], fov = base.fov + df * st[2]
                    let sc = score(pitch, yaw, fov, S, tau)
                    if (sc > c.sc + 1e-9) { c = { sc, pitch, yaw, fov }; improved = true }
                }
                if (!improved) break
            }
            await pumpFit(c.sc > cur.sc ? c : cur, S)
        }
        if (c.sc > cur.sc) cur = c
    }
    return { pitch: cur.pitch, yaw: ((cur.yaw % 90) + 90) % 90, fov: cur.fov, fovFixed: !!o.fovFix, support: cur.sc / S.length, an }
    } catch (e) {
        if (e === AUTOCAL_CANCELLED) return null
        throw e
    }
}

/** Project camera-space point p=[x,y,z] to pixels for a camera with focal length f and principal point (cx,cy) */
function projectCam(p, f, cx, cy) { return { x: cx + f * p[0] / p[2], y: cy + f * p[1] / p[2], z: p[2] } }

/** The 8 corners of the unit cube centred at camera-space point P (axes ex/ey/ez are the world axes in camera coords) */
function cubeCorners(P, ax) {
    let out = []
    for (let a of [-0.5, 0.5]) for (let b of [-0.5, 0.5]) for (let c of [-0.5, 0.5])
        out.push([P[0] + a * ax.ex[0] + b * ax.ey[0] + c * ax.ez[0], P[1] + a * ax.ex[1] + b * ax.ey[1] + c * ax.ez[1], P[2] + a * ax.ex[2] + b * ax.ey[2] + c * ax.ez[2]])
    return out
}

function convexHull(pts) {
    pts = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y)
    let cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    let lower = [], upper = []
    for (let p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p) }
    for (let i = pts.length - 1; i >= 0; i--) { let p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p) }
    return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/** Calls fn(x,y) for every integer pixel inside the convex polygon `hull` (either winding), clipped to [0,w)x[0,h) */
function forEachPixelInHull(hull, w, h, fn) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let p of hull) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y) }
    let n = hull.length, sign = hullArea(hull) >= 0 ? 1 : -1
    for (let y = Math.max(0, Math.ceil(minY)); y <= Math.min(h - 1, Math.floor(maxY)); y++)
        for (let x = Math.max(0, Math.ceil(minX)); x <= Math.min(w - 1, Math.floor(maxX)); x++) {
            let inside = true
            for (let i = 0; i < n && inside; i++) {
                let a = hull[i], b = hull[(i + 1) % n]
                if (sign * ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) < 0) inside = false
            }
            if (inside) fn(x, y)
        }
}

function hullArea(hull) {
    let s = 0
    for (let i = 0; i < hull.length; i++) { let a = hull[i], b = hull[(i + 1) % hull.length]; s += a.x * b.y - b.x * a.y }
    return s / 2
}

/** Silhouette (convex hull) of the unit cube centred at camera-space P, or null if any corner is too close to / behind the camera */
function cubeHull(P, ax, f, cx, cy) {
    let pts = []
    for (let c of cubeCorners(P, ax)) {
        if (c[2] < 0.3) return null
        pts.push(projectCam(c, f, cx, cy))
    }
    return convexHull(pts)
}

/** selectCellsByRay: cost of covering a non-purple pixel, and of one more cube, in the score of a set of cells */
let CUBE_COST = 60, CUBE_BG_WEIGHT = 1.2

const AUTOCAL_CANCELLED = { cancelled: true }
const tick = () => new Promise((r) => setTimeout(r, 0))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
