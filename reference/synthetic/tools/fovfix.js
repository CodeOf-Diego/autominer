// What happens when the FOV is given by hand (panel field), per photo?
const H = require('./harness')
;(async () => {
  const { b, p } = await H.open()
  const fov = process.argv[3] || '90'
  for (const ph of (process.argv[2] || 'geode03').split(',')) {
    await p.evaluate((v) => { calibration_fov.value = v }, fov)
    await H.photo(p, ph)
    const r = await p.evaluate(() => { const A = autoCubes, ncc = A.cubes.map(c => c.ncc).filter(x => x != null).sort((a, b) => a - b); return { cam: [A.pitch, A.yaw, A.fov].map(v => +v.toFixed(1)), n: A.cubes.length, texUsed: A.texUsed, gate: A.texGate && +A.texGate.toFixed(2), medNcc: ncc.length ? +ncc[ncc.length >> 1].toFixed(2) : null, minNcc: ncc.length ? +ncc[0].toFixed(2) : null, fromPoses: A.fromPoses } })
    console.log('fov', fov, ph, JSON.stringify(r))
  }
  await b.close()
})()
