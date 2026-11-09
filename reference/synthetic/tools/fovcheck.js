const H = require('./harness')
;(async () => {
  const { b, p } = await H.open()
  for (const noTex of [true, false]) {
    await p.evaluate((v) => { window.__noTex = v }, noTex)
    for (const ph of ['geode01', 'geode02', 'geode03']) {
      await p.evaluate((k) => { calibration_photo.value = k; calibration_photo.dispatchEvent(new Event('change')) }, ph)
      await p.keyboard.press('1')
      await p.waitForFunction((k) => autoCalState === 'done' && PHOTO_DATA[k] === calibrationImage.src, ph, { timeout: 300000 })
      const r = await p.evaluate(() => { const A = autoCubes, ncc = A.cubes.map(c => c.ncc).filter(x => x != null); const med = ncc.slice().sort((a, b) => a - b)[ncc.length >> 1]; return { cam: [A.pitch, A.yaw, A.fov].map(v => +v.toFixed(1)), n: A.cubes.length, texUsed: A.texUsed, medNcc: ncc.length ? +med.toFixed(2) : null, fromPoses: A.fromPoses } })
      console.log(noTex ? 'noTex ' : 'withTex', ph, JSON.stringify(r))
    }
  }
  await b.close()
})()
