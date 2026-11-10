// Runs the app's stage-1 pipeline on scenes with known truth and prints camera errors, lattice-relative recall/precision and the time.
// node synth_run.js <seeds> <brightness> [optsJSON]      e.g. node synth_run.js 1,2,3 1 '{"DR":[6,10],"RR":[3.5,5]}' for close-up scenes
// node synth_run.js photos [geode07,...]                  the real photos, all by default (no truth: texture correlation of the cells is the judge)
const H = require('./harness')
;(async () => {
  const { b, p } = await H.open()
  await p.addScriptTag({ path: __dirname + '/synth_page.js' })
  if (process.env.SYNTH_TEX !== '0') await p.evaluate(async () => { const i = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = TEXTURE_DATA.amethyst_block }); const c = document.createElement('canvas'); c.width = 16; c.height = 16; const g = c.getContext('2d'); g.drawImage(i, 0, 0); window.__tex = g.getImageData(0, 0, 16, 16).data })
  await p.evaluate(() => { window.__timeline = []; const o = runAutoCalibration; window.runAutoCalibration = async function () { const t = performance.now(); await o(); window.__ms = Math.round(performance.now() - t) } })
  if (process.argv[2] === 'photos') {
    for (const ph of (process.argv[3] || 'geode01,geode02,geode03,geode04,geode05,geode06,geode07').split(',')) {
      await H.photo(p, ph)
      console.log(ph, JSON.stringify(await p.evaluate(async () => {
        const A = autoCubes; if (!A) return { fail: true, ms: window.__ms }
        const n = A.cubes.map((c) => c.ncc).filter((x) => x !== null && x !== undefined).sort((a, b) => a - b)
        return { ms: window.__ms, fov: +A.fov.toFixed(2), pitch: +A.pitch.toFixed(2), yaw: +A.yaw.toFixed(2), cubes: A.cubes.length, medNcc: n.length ? +n[n.length >> 1].toFixed(2) : null, ncc05: n.filter((x) => x >= 0.5).length + '/' + n.length }
      })))
    }
    console.log('errors:', p.errs.length ? p.errs.slice(0, 3) : 'none'); await b.close(); return
  }
  const seeds = (process.argv[2] || '1,2,3').split(',').map(Number), bright = +(process.argv[3] || 1), extra = JSON.parse(process.argv[4] || '{}')
  const rows = []
  for (const seed of seeds) {
    await p.evaluate(({ seed, bright, extra }) => { const s = makeSynth(seed, Object.assign({ bright }, extra)); PHOTO_DATA.synth = s.url; window.__truth = s.truth; loadCalibrationPhoto('synth') }, { seed, bright, extra })
    await p.keyboard.press('1')
    try { await p.waitForFunction(() => autoCalState === 'done' && PHOTO_DATA.synth === calibrationImage.src, null, { timeout: 120000 }) } catch (e) { rows.push({ seed, timeout: true }); continue }
    rows.push(Object.assign({ seed }, await p.evaluate(() => {
      const T = window.__truth, A = autoCubes
      if (!A) return { fail: true, n: T.cubes.length, ms: window.__ms }
      // lattice-relative: best integer translation between the found cells and the true world cells (absolute depth is ambiguous with FOV)
      const gset = new Set(T.cubes.map((g) => g.c.join(','))); let best = 0
      for (let dx = -14; dx <= 14; dx++) for (let dy = -14; dy <= 14; dy++) for (let dz = -14; dz <= 14; dz++) { let n = 0; for (const c of A.cubes) if (gset.has((c.i + dx) + ',' + (c.j + dy) + ',' + (c.k + dz))) n++; if (n > best) best = n }
      return { ms: window.__ms, n: T.cubes.length, found: A.cubes.length, recall: +(best / T.cubes.length).toFixed(2), prec: +(best / Math.max(1, A.cubes.length)).toFixed(2), dFov: +(A.fov - T.fov).toFixed(2), dPitch: +(A.pitch - T.pitch).toFixed(2), dYaw: +(((A.yaw - T.yaw + 45 + 900) % 90) - 45).toFixed(2) }
    })))
  }
  for (const r of rows) console.log(JSON.stringify(r))
  const avg = (f) => { const v = rows.filter((r) => r[f] !== undefined).map((r) => Math.abs(r[f])); return v.length ? +(v.reduce((a, c) => a + c, 0) / v.length).toFixed(2) : null }
  console.log('AVG recall', avg('recall'), 'prec', avg('prec'), '|dFov|', avg('dFov'), '|dPitch|', avg('dPitch'), '|dYaw|', avg('dYaw'), 'ms', avg('ms'), '| failed:', rows.filter((r) => r.fail || r.timeout).length, '| errors:', p.errs.length ? p.errs.slice(0, 3) : 'none')
  await b.close()
})()
