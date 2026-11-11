/** Purple (amethyst) mask at <= maxW px wide, plus a random sample of its boundary pixels with local tangent direction */
/**
 * The photo's pixels at w x h, as a canvas, identical in every browser. Each browser shrinks an image in drawImage with its own filter
 * (and Firefox on the GPU with yet another): the purple mask of the same photo came out 3 pixels different, and on a fragile photo that
 * was enough to give 37 wrong cubes instead of 28 right ones. So the photo is read once at its own size (that read is exact everywhere)
 * and shrunk here, each target pixel being the plain average of the source pixels under it.
 */
let PHOTO_PIXELS = null
function photoCanvas(img, w, h) {
    let W = img.naturalWidth, H = img.naturalHeight
    if (!PHOTO_PIXELS || PHOTO_PIXELS.src !== img.src) {
        let c0 = document.createElement('canvas'); c0.width = W; c0.height = H
        let g0 = c0.getContext('2d', { willReadFrequently: true }); g0.drawImage(img, 0, 0)
        PHOTO_PIXELS = { src: img.src, data: g0.getImageData(0, 0, W, H).data, sized: new Map() }
    }
    let key = w + 'x' + h, out = PHOTO_PIXELS.sized.get(key)
    if (!out) {
        let S = PHOTO_PIXELS.data, D = new Uint8ClampedArray(w * h * 4)
        if (w === W && h === H) D.set(S)
        else for (let y = 0; y < h; y++) {
            let y0 = Math.floor(y * H / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * H / h))
            for (let x = 0; x < w; x++) {
                let x0 = Math.floor(x * W / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * W / w)), r = 0, g = 0, b = 0, n = (x1 - x0) * (y1 - y0)
                for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { let i = (yy * W + xx) * 4; r += S[i]; g += S[i + 1]; b += S[i + 2] }
                let o = (y * w + x) * 4; D[o] = Math.round(r / n); D[o + 1] = Math.round(g / n); D[o + 2] = Math.round(b / n); D[o + 3] = 255
            }
        }
        out = new ImageData(D, w, h)
        PHOTO_PIXELS.sized.set(key, out)
    }
    let c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d', { willReadFrequently: true }).putImageData(out, 0, 0)
    return c
}

function amethystAnalysis(img, o) {
    let scale = Math.min(1, o.maxW / img.naturalWidth)
    let w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
    let hsv = photoHSV(img, w, h), hueShift = amethystHueShift(hsv), win = purpleWindows(hueShift), { raw, filled } = purpleMask(hsv, win)
    // looser "purple-ish" test used only to judge whether a cube's visible part is really amethyst: also accepts the pale pink texels
    // (low saturation) of big close cubes, still rejects brown dirt (orange hue) and grey stone (no saturation)
    let loose = new cv.Mat() // hue from 125 (amethyst ~131-141) so bluish rock never counts; V from 18 for dim light
    purpleInRange(hsv, win.looseLo, win.looseHi, loose)
    let data = new Uint8Array(w * h), rawData = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) { data[i] = filled.data[i] ? 1 : 0; rawData[i] = loose.data[i] ? 1 : 0 }

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

    for (let m of [hsv, filled, raw, loose, mf, gx, gy]) m.delete()
    return { w, h, scale, data, raw: rawData, samples, hueShift }
}

/**
 * Does this browser give back the pixels it was given? Some privacy settings and extensions add noise to what a page reads from a canvas
 * (canvas fingerprinting protection); the whole stage 1 reads the photo that way. Draws a known 64x64 pattern and reads it back:
 * returns the number of altered pixels (0 = exact). Plus a fingerprint of the photo as read (FNV-1a of its RGB at natural size), to compare browsers.
 */
function canvasReadbackCheck(img) {
    let c = document.createElement('canvas'); c.width = 64; c.height = 64
    let g = c.getContext('2d', { willReadFrequently: true })
    for (let i = 0; i < 64; i++) { g.fillStyle = 'rgb(' + (i * 4) + ',' + (255 - i * 4) + ',' + ((i * 37) % 256) + ')'; g.fillRect(i, 0, 1, 64) }
    let d = g.getImageData(0, 0, 64, 64).data, altered = 0
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { let k = (y * 64 + x) * 4; if (d[k] !== x * 4 || d[k + 1] !== 255 - x * 4 || d[k + 2] !== (x * 37) % 256) altered++ }
    let photo = null
    if (img && img.naturalWidth) {
        let p = document.createElement('canvas'); p.width = img.naturalWidth; p.height = img.naturalHeight
        let pg = p.getContext('2d', { willReadFrequently: true }); pg.drawImage(img, 0, 0)
        let pd = pg.getImageData(0, 0, p.width, p.height).data, h = 2166136261
        for (let i = 0; i < pd.length; i += 4) for (let ch = 0; ch < 3; ch++) { h ^= pd[i + ch]; h = Math.imul(h, 16777619) >>> 0 }
        photo = h.toString(16).padStart(8, '0')
    }
    return { altered, photo }
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
