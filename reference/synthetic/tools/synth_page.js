// Synthetic geode screenshots with known ground truth. window.makeSynth(seed, opts) -> {url, truth}
window.makeSynth = function (seed, o) {
  o = Object.assign({ W: 1600, H: 856, bright: 1.0, nCubes: 34, pitchR: [5, 35], yawR: [20, 70], fovR: [70, 100], hidMin: 0.35, noise: 0, DR: [11, 16], RR: [4.5, 6.5] }, o)
  let s = (seed * 2654435761) >>> 0
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  const rr = (a, b) => a + (b - a) * rnd()
  const W = o.W, H = o.H, cx = W / 2, cy = H / 2
  const pitch = rr(...o.pitchR), yaw = rr(...o.yawR), fov = rr(...o.fovR), f = (H / 2) / Math.tan(fov * Math.PI / 360)
  const ax = cameraAxes(pitch, yaw), D = rr(...o.DR), Rsph = rr(...o.RR)
  const Oc = [rr(-1, 1), rr(-1, 1), D]
  const at = (a, b, c) => [Oc[0] + a * ax.ex[0] + b * ax.ey[0] + c * ax.ez[0], Oc[1] + a * ax.ex[1] + b * ax.ey[1] + c * ax.ez[1], Oc[2] + a * ax.ex[2] + b * ax.ey[2] + c * ax.ez[2]]
  // cells in a shell, grown in clusters
  const shell = []
  const N = Math.ceil(Rsph) + 1
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) for (let k = -N; k <= N; k++) { const d = Math.hypot(i, j, k); if (d >= Rsph - 1.3 && d <= Rsph + 0.6) shell.push([i, j, k]) }
  const key = (c) => c.join(','), chosen = new Map()
  const nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  let guard = 0
  while (chosen.size < o.nCubes && guard++ < 5000) {
    const c = shell[Math.floor(rnd() * shell.length)]
    if (chosen.has(key(c))) continue
    chosen.set(key(c), c)
    if (rnd() < 0.55) { const n = nb[Math.floor(rnd() * 6)], c2 = [c[0] + n[0], c[1] + n[1], c[2] + n[2]]; const d = Math.hypot(...c2); if (d >= Rsph - 1.6 && d <= Rsph + 0.9 && chosen.size < o.nCubes) chosen.set(key(c2), c2) }
  }
  let cells = [...chosen.values()].map((c) => ({ c, P: at(...c) })).filter((q) => q.P[2] > 2.5)
  // visibility: drop cubes that are (almost) completely hidden behind nearer ones
  const pxOf = (hl) => { const a = []; forEachPixelInHull(hl, W, H, (x, y) => a.push(y * W + x)); return a }
  cells.forEach((q) => { q.hl = cubeHull(q.P, ax, f, cx, cy); q.px = q.hl ? pxOf(q.hl) : [] })
  cells = cells.filter((q) => q.px.length > 150)
  cells.sort((a, b) => a.P[2] - b.P[2])
  const cov = new Uint8Array(W * H), vis = []
  for (const q of cells) { let fresh = 0; for (const p of q.px) if (!cov[p]) fresh++; if (fresh / q.px.length >= o.hidMin) { vis.push(q); for (const p of q.px) cov[p] = 1 } }
  cells = vis
  // render
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const g = cv.getContext('2d')
  const B = 14
  for (let y = 0; y < H; y += B) for (let x = 0; x < W; x += B) { const v = 45 + rnd() * 60, brown = rnd() < 0.04; g.fillStyle = brown ? `rgb(${v + 25},${v},${v - 20})` : `rgb(${v},${v},${v + 4})`; g.fillRect(x, y, B, B) }
  const bright = o.bright
  const PAL = [[150, 100, 225], [120, 70, 190], [95, 55, 160], [170, 120, 235], [75, 40, 130], [225, 175, 245]]
  const shadeOf = (a, sg) => a === 1 && sg > 0 ? 1.0 : a === 0 ? 0.8 : 0.6
  const Tn = 16
  const proj = (p) => [cx + f * p[0] / p[2], cy + f * p[1] / p[2]]
  for (const q of [...cells].reverse()) { // far to near
    const C = q.P
    for (let a = 0; a < 3; a++) for (const sg of [-1, 1]) {
      const axs = [ax.ex, ax.ey, ax.ez], A = axs[a], U = axs[(a + 1) % 3], V = axs[(a + 2) % 3]
      const fc = [C[0] + sg * 0.5 * A[0], C[1] + sg * 0.5 * A[1], C[2] + sg * 0.5 * A[2]]
      if (sg * (A[0] * fc[0] + A[1] * fc[1] + A[2] * fc[2]) >= 0) continue // back face
      const sh = shadeOf(a, sg) * bright
      for (let u = 0; u < Tn; u++) for (let v = 0; v < Tn; v++) {
        const pt = (uu, vv) => proj([fc[0] + (uu / Tn - 0.5) * U[0] + (vv / Tn - 0.5) * V[0], fc[1] + (uu / Tn - 0.5) * U[1] + (vv / Tn - 0.5) * V[1], fc[2] + (uu / Tn - 0.5) * U[2] + (vv / Tn - 0.5) * V[2]])
        const c0 = pt(u, v), c1 = pt(u + 1, v), c2 = pt(u + 1, v + 1), c3 = pt(u, v + 1)
        let base, j
        if (window.__tex) { const o4 = (v * 16 + u) * 4; base = [window.__tex[o4], window.__tex[o4 + 1], window.__tex[o4 + 2]]; j = 1 } // the real 16x16 amethyst texture, identical on every face
        else { base = PAL[Math.floor(rnd() * (rnd() < 0.12 ? 6 : 5))]; j = 0.9 + rnd() * 0.2 }
        g.fillStyle = `rgb(${Math.min(255, base[0] * sh * j) | 0},${Math.min(255, base[1] * sh * j) | 0},${Math.min(255, base[2] * sh * j) | 0})`
        g.beginPath(); g.moveTo(c0[0], c0[1]); g.lineTo(c1[0], c1[1]); g.lineTo(c2[0], c2[1]); g.lineTo(c3[0], c3[1]); g.closePath(); g.fill()
      }
    }
  }
  // lighting on the rock (survival: darker) + optional pixel noise
  const id = g.getImageData(0, 0, W, H), d = id.data
  const covAny = new Uint8Array(W * H); for (const q of cells) for (const p of q.px) covAny[p] = 1
  for (let i = 0; i < W * H; i++) { if (!covAny[i]) { d[i * 4] *= bright; d[i * 4 + 1] *= bright; d[i * 4 + 2] *= bright } if (o.noise) { const n = (rnd() - 0.5) * o.noise; d[i * 4] += n; d[i * 4 + 1] += n; d[i * 4 + 2] += n } }
  g.putImageData(id, 0, 0)
  return { url: cv.toDataURL('image/png'), truth: { pitch, yaw, fov, cubes: cells.map((q) => ({ c: q.c, P: q.P })), n: cells.length } }
}
