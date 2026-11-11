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
/**
 * Where the amethyst hue actually is in this photo: peak of the hue histogram of the saturated pixels in 115-175 (smoothed +-5).
 * Normally 132-135; a warm or tinted screenshot moves it (geode-05: 157, the amethyst spread over 140-179 and the fixed
 * window 115-160 cut it to ragged pieces). Returns the shift from 134, 0 within +-5 so ordinary photos are untouched.
 */
function amethystHueShift(hsv) {
    let d = hsv.data, n = hsv.rows * hsv.cols, hist = new Float64Array(180)
    for (let q = 0; q < n; q++) if (d[q * 3 + 1] >= 70 && d[q * 3 + 2] >= 20) hist[d[q * 3]]++
    let best = -1, peak = 134
    for (let x = 115; x <= 175; x++) { let s = 0; for (let t = -5; t <= 5; t++) s += hist[(x + t) % 180]; if (s > best) { best = s; peak = x } }
    let s = peak - 134
    return Math.abs(s) <= 5 ? 0 : Math.max(-15, Math.min(25, s))
}
/**
 * The purple windows widened toward the photo's amethyst hue (only on that side: the other bound stays, see amethystHueShift).
 * The upper hue bound may pass 179: hue is a circle, and in a warm photo the pale pink texels of the amethyst go past magenta to 0-8.
 */
function purpleWindows(shift) {
    let s = shift || 0, dn = Math.min(0, s), up = Math.max(0, s)
    return { lo: [115 + dn, 70, 20, 0], hi: [160 + up, 255, 255, 255], looseLo: [125 + dn, 25, 18, 0], looseHi: [175 + up, 255, 255, 255] }
}
/** cv.inRange on HSV with a hue window that may wrap past 179 (lo/hi as from purpleWindows) */
function purpleInRange(hsv, lo, hi, dst) {
    let h = hsv.rows, w = hsv.cols, a = new cv.Mat(h, w, hsv.type(), lo), b = new cv.Mat(h, w, hsv.type(), [Math.min(179, hi[0]), hi[1], hi[2], hi[3]])
    cv.inRange(hsv, a, b, dst)
    if (hi[0] > 179) {
        let c = new cv.Mat(h, w, hsv.type(), [0, lo[1], lo[2], lo[3]]), d = new cv.Mat(h, w, hsv.type(), [hi[0] - 180, hi[1], hi[2], hi[3]]), m = new cv.Mat()
        cv.inRange(hsv, c, d, m); cv.bitwise_or(dst, m, dst)
        for (let x of [c, d, m]) x.delete()
    }
    a.delete(); b.delete()
}

/** The photo at w x h as an OpenCV HSV Mat (the caller deletes it) */
function photoHSV(img, w, h) {
    let src = cv.imread(photoCanvas(img, w, h)), rgb = new cv.Mat(), hsv = new cv.Mat()
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB); cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)
    src.delete(); rgb.delete()
    return hsv
}
/** Strict purple mask of an HSV photo (window from purpleWindows), 3x3 close + open against specks and pinholes. Returns {raw, filled} Mats (filled = holes inside each blob filled: the pale pink highlights of a close cube fail the saturation threshold); the caller deletes them */
function purpleMask(hsv, win) {
    let raw = new cv.Mat(), k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3))
    purpleInRange(hsv, win.lo, win.hi, raw)
    cv.morphologyEx(raw, raw, cv.MORPH_CLOSE, k); cv.morphologyEx(raw, raw, cv.MORPH_OPEN, k)
    let filled = raw.clone(), c = new cv.MatVector(), hier = new cv.Mat()
    cv.findContours(raw, c, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    for (let i = 0; i < c.size(); i++) cv.drawContours(filled, c, i, new cv.Scalar(255), -1)
    for (let m of [k, c, hier]) m.delete()
    return { raw, filled }
}
