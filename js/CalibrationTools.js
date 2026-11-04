/**
 * Step 0 of the real-world reconstruction idea: given a Minecraft screenshot of a geode, find
 * the camera's FOV/orientation so the ore blocks visible in the photo can eventually be placed
 * back into the 3D grid. This file is the line-detection half (Canny + probabilistic Hough,
 * via OpenCV.js) and the vanishing-point math; main.js wires stage 1 to just show the detected
 * lines for now, before vanishing-point clustering is trusted enough to drive anything.
 *
 * OpenCV.js is loaded async from a CDN (index.html) and can take a few seconds (~10MB) - cvReady
 * flips once it's usable; callers should check it first.
 */
let cvReady = false
function onOpenCvReady() { cvReady = true }

/** Normalized homogeneous line (a,b,c) through 2 points, a^2+b^2=1 */
function lineFromPoints(x1, y1, x2, y2) {
    let a = y1 - y2, b = x2 - x1, c = x1 * y2 - x2 * y1
    let norm = Math.sqrt(a * a + b * b)
    if (norm < 1e-9) return null
    return { a: a / norm, b: b / norm, c: c / norm }
}

/** Homogeneous intersection of 2 normalized lines -> {x,y,w} (w~0 means "at infinity") */
function intersectLines(l1, l2) {
    let x = l1.b * l2.c - l1.c * l2.b
    let y = l1.c * l2.a - l1.a * l2.c
    let w = l1.a * l2.b - l1.b * l2.a
    return { x, y, w }
}

/** Point minimizing sum of squared perpendicular distances to a set of normalized lines (a,b,c) */
function leastSquaresIntersection(geoLines) {
    let Saa = 0, Sab = 0, Sbb = 0, Sac = 0, Sbc = 0
    for (let l of geoLines) {
        Saa += l.a * l.a; Sab += l.a * l.b; Sbb += l.b * l.b
        Sac += l.a * l.c; Sbc += l.b * l.c
    }
    let det = Saa * Sbb - Sab * Sab
    if (Math.abs(det) < 1e-9) return null
    let x = (-Sbb * Sac + Sab * Sbc) / det
    let y = (Sab * Sac - Saa * Sbc) / det
    return { x, y }
}

/**
 * Runs Canny + probabilistic Hough on `img` (an already-loaded <img>), downscaled to at most
 * `maxDim` px on the long side first - this is the main noise-suppression knob for a busy scene
 * (crystal facets, calcite texture): fine texture disappears while long structural edges (wall
 * corners, block grid lines) survive. Returns segments in the IMAGE's own full-res pixel space
 * (scaled back up), each {x1,y1,x2,y2,length}.
 */
function detectLines(img, params) {
    let p = Object.assign({ maxDim: 1200, canny1: 50, canny2: 150, houghThresh: 50, minLen: 100, maxGap: 10 }, params)

    let srcCanvas = document.createElement('canvas')
    srcCanvas.width = img.naturalWidth
    srcCanvas.height = img.naturalHeight
    srcCanvas.getContext('2d').drawImage(img, 0, 0)

    let src = cv.imread(srcCanvas)
    let scale = Math.min(1, p.maxDim / Math.max(src.cols, src.rows))
    let working = src
    if (scale < 1) {
        working = new cv.Mat()
        cv.resize(src, working, new cv.Size(Math.round(src.cols * scale), Math.round(src.rows * scale)), 0, 0, cv.INTER_AREA)
    }

    let gray = new cv.Mat()
    cv.cvtColor(working, gray, cv.COLOR_RGBA2GRAY)
    let blurred = new cv.Mat()
    cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0)
    let edges = new cv.Mat()
    cv.Canny(blurred, edges, p.canny1, p.canny2, 3)

    let lines = new cv.Mat()
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, p.houghThresh, p.minLen, p.maxGap)

    let segments = []
    let inv = 1 / scale
    for (let i = 0; i < lines.rows; i++) {
        let x1 = lines.data32S[i * 4] * inv, y1 = lines.data32S[i * 4 + 1] * inv
        let x2 = lines.data32S[i * 4 + 2] * inv, y2 = lines.data32S[i * 4 + 3] * inv
        segments.push({ x1, y1, x2, y2, length: Math.hypot(x2 - x1, y2 - y1) })
    }

    src.delete(); gray.delete(); blurred.delete(); edges.delete(); lines.delete()
    if (working !== src) working.delete()
    return segments
}

/**
 * RANSAC-ish pairwise intersection voting: proposes vanishing point candidates from pairs of
 * detected lines, clusters nearby proposals (spatial grid keeps this near-linear instead of
 * O(candidates^2)), refines each cluster with a least-squares line intersection, and scores it
 * by the total length of member lines actually consistent with the refined point. Returns
 * clusters sorted by score, best first. NOT yet wired into the stage-1 view (see main.js) -
 * on the one real screenshot tried so far it didn't converge to a valid orthogonal pair, see
 * README.md.
 */
function findVanishingPoints(segments, imgW, imgH) {
    let diag = Math.sqrt(imgW * imgW + imgH * imgH)
    let lines = segments.map(s => ({ ...s, geo: lineFromPoints(s.x1, s.y1, s.x2, s.y2) })).filter(s => s.geo)

    const MAX_LINES = 220
    if (lines.length > MAX_LINES) {
        lines.sort((a, b) => b.length - a.length)
        lines = lines.slice(0, MAX_LINES)
    }

    let candidates = []
    for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
            let li = lines[i], lj = lines[j]
            let cross = li.geo.a * lj.geo.b - li.geo.b * lj.geo.a
            if (Math.abs(cross) < 0.05) continue
            let p = intersectLines(li.geo, lj.geo)
            if (Math.abs(p.w) < 1e-6) continue
            let x = p.x / p.w, y = p.y / p.w
            if (Math.abs(x) > 30 * diag || Math.abs(y) > 30 * diag) continue
            candidates.push({ x, y, weight: Math.min(li.length, lj.length) * Math.abs(cross), i, j })
        }
    }

    let clusterRadius = diag * 0.04
    let grid = new Map()
    candidates.forEach((c, idx) => {
        let key = Math.round(c.x / clusterRadius) + ',' + Math.round(c.y / clusterRadius)
        if (!grid.has(key)) grid.set(key, [])
        grid.get(key).push(idx)
    })

    let clusters = []
    let used = new Array(candidates.length).fill(false)
    let order = candidates.map((c, idx) => idx).sort((a, b) => candidates[b].weight - candidates[a].weight)

    for (let si of order) {
        if (used[si]) continue
        let seed = candidates[si]
        let members = new Set()
        let sumX = 0, sumY = 0, sumW = 0
        let gx = Math.round(seed.x / clusterRadius), gy = Math.round(seed.y / clusterRadius)
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                let bucket = grid.get((gx + dx) + ',' + (gy + dy))
                if (!bucket) continue
                for (let ci of bucket) {
                    if (used[ci]) continue
                    let c = candidates[ci]
                    if (Math.hypot(c.x - seed.x, c.y - seed.y) < clusterRadius) {
                        used[ci] = true
                        members.add(c.i); members.add(c.j)
                        sumX += c.x * c.weight; sumY += c.y * c.weight; sumW += c.weight
                    }
                }
            }
        }
        if (sumW <= 0) continue
        let cx = sumX / sumW, cy = sumY / sumW
        let refined = leastSquaresIntersection([...members].map(idx => lines[idx].geo))
        if (refined) { cx = refined.x; cy = refined.y }

        let score = 0
        for (let idx of members) {
            let s = lines[idx]
            if (Math.abs(s.geo.a * cx + s.geo.b * cy + s.geo.c) < clusterRadius) score += s.length
        }
        clusters.push({ x: cx, y: cy, score, members: [...members].map(idx => lines[idx]) })
    }

    clusters.sort((a, b) => b.score - a.score)
    return clusters
}

/** f such that the 2 given vanishing points are consistent with orthogonal world directions, or null if the pair isn't geometrically valid (see the orthogonality constraint in README.md) */
function calibrateFromPair(v1, v2, cx, cy) {
    let f2 = -((v1.x - cx) * (v2.x - cx) + (v1.y - cy) * (v2.y - cy))
    return f2 > 0 ? Math.sqrt(f2) : null
}
