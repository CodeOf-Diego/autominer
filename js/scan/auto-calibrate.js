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
        let f = focalPx(fov, an.h)
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

/** selectCellsByRay: cost of covering a non-purple pixel, and of one more cube, in the score of a set of cells */
let CUBE_COST = 60, CUBE_BG_WEIGHT = 1.2

const AUTOCAL_CANCELLED = { cancelled: true }
const tick = () => new Promise((r) => setTimeout(r, 0))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
