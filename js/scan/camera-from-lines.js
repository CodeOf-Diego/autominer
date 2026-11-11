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
            let f = focalPx(fov, an.h), pitch = Math.atan(f / (vy - cy)) * 180 / Math.PI // vanishing point below the centre = looking down
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
