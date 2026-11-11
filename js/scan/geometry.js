/** World axes (X, Y=up, Z) expressed in camera coords (x right, y down, z forward) for a camera pitched `pitch` deg down and yawed `yaw` deg about the vertical */
function cameraAxes(pitchDeg, yawDeg) {
    let th = pitchDeg * Math.PI / 180, ps = yawDeg * Math.PI / 180
    let st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(ps), cp = Math.cos(ps)
    let r = [cp, 0, -sp], dn = [-st * sp, -ct, -st * cp], fw = [ct * sp, -st, ct * cp]
    return { ex: [r[0], dn[0], fw[0]], ey: [r[1], dn[1], fw[1]], ez: [r[2], dn[2], fw[2]] }
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
/** Focal length in px of a camera with vertical FOV fov (deg) on an image h px tall */
function focalPx(fov, h) { return (h / 2) / Math.tan(fov * Math.PI / 360) }

/** Camera-space centre of lattice cell (i, j, k) of a result {origin, ax} */
function latticePoint(res, i, j, k) { let d = latticeOffset([i, j, k], res.ax); return [res.origin[0] + d[0], res.origin[1] + d[1], res.origin[2] + d[2]] }

function latticeOffset(off, ax) {
    return [off[0] * ax.ex[0] + off[1] * ax.ey[0] + off[2] * ax.ez[0], off[0] * ax.ex[1] + off[1] * ax.ey[1] + off[2] * ax.ez[1], off[0] * ax.ex[2] + off[1] * ax.ey[2] + off[2] * ax.ez[2]]
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
