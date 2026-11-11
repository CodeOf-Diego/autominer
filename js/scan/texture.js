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
    let d = photoCanvas(img, W, H).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data, lum = new Float32Array(W * H)
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
    let W = tex.W, H = tex.H, f = focalPx(cal.fov, H), ax = cameraAxes(cal.pitch, cal.yaw), axs = [ax.ex, ax.ey, ax.ez]
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
    let W = tex.W, H = tex.H, f = focalPx(cal.fov, H), ax = cameraAxes(cal.pitch, cal.yaw), axs = [ax.ex, ax.ey, ax.ez], vals = []
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
 * Returns {ncc, valid} (ncc averaged over faces weighted by their area in the photo) or null when fewer than 48 texels can be judged.
 */
function textureScore(tex, an, geo, P, cov) {
    let W = tex.W, H = tex.H, f = focalPx(geo.fov, H), ax = geo.ax, k = an.w / W, axs = [ax.ex, ax.ey, ax.ez]
    const lumAt = (x, y) => { x = Math.min(W - 1.001, Math.max(0, x)); y = Math.min(H - 1.001, Math.max(0, y)); let x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0, L = tex.lum; return (L[i] * (1 - fx) + L[i + 1] * fx) * (1 - fy) + (L[i + W] * (1 - fx) + L[i + W + 1] * fx) * fy }
    let sum = 0, wsum = 0, tval = 0, patch = new Float32Array(256), ok = new Uint8Array(256)
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
        // weight = area of the face in the photo (x the fraction of its texels that can be judged): a face seen edge-on still has 256 texels, all sampled
        // from a sliver of a few pixels, and its correlation is noise (a real cube scored 0.47 with 0.97 on its front face and 0.09 on a 1 px face)
        let cs = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([a1, b1]) => { let X = fc[0] + a1 * U[0] + b1 * V[0], Y = fc[1] + a1 * U[1] + b1 * V[1], Z = fc[2] + a1 * U[2] + b1 * V[2]; return [W / 2 + f * X / Z, H / 2 + f * Y / Z] }), ar = 0
        for (let m = 0; m < 4; m++) ar += cs[m][0] * cs[(m + 1) % 4][1] - cs[(m + 1) % 4][0] * cs[m][1]
        let wt = Math.abs(ar) / 2 * k * k * nvalid / 256
        sum += best * wt; wsum += wt; tval += nvalid
    }
    return tval >= 48 && wsum > 0 ? { ncc: sum / wsum, valid: tval } : null
}
