// What did the texture comparison say about a given cell of a real photo?
const H = require('./harness')
;(async () => {
  const { b, p } = await H.open()
  const ph = process.argv[2] || 'geode01', target = (process.argv[3] || '8,-7,-4').split(',').map(Number)
  await H.photo(p, ph)
  const r = await p.evaluate(async ({ target }) => {
    const A = autoCubes, an = autoCal.an, tex = await makeTextureContext(calibrationImage)
    const all = A.cubes.map(c => ({ ijk: [c.i, c.j, c.k], ncc: c.ncc === null || c.ncc === undefined ? null : +c.ncc.toFixed(2), z: +c.P[2].toFixed(1) }))
    const t = A.cubes.find(c => c.i === target[0] && c.j === target[1] && c.k === target[2])
    const geo = { fov: A.fov, ax: A.ax }
    let detail = null
    if (t) {
      const ts = textureScore(tex, an, geo, t.P, null)
      const h = an.h, f = (h / 2) / Math.tan(A.fov * Math.PI / 360), hl = cubeHull(t.P, A.ax, f, an.w / 2, h / 2)
      let area = 0, purple = 0; forEachPixelInHull(hl, an.w, an.h, (x, y) => { area++; purple += an.data[y * an.w + x] })
      let cx = 0, cy = 0; for (const q of hl) { cx += q.x; cy += q.y }
      detail = { z: +t.P[2].toFixed(1), areaPx: area, purpleFrac: +(purple / area).toFixed(2), centreAn: [Math.round(cx / hl.length), Math.round(cy / hl.length)], coverageStored: t.coverage && +t.coverage.toFixed(2), nccStored: t.ncc, nccNow_noOcclusion: ts && { ncc: +ts.ncc.toFixed(2), validTexels: ts.valid } }
    }
    const sorted = all.filter(x => x.ncc !== null).sort((a, b) => a.ncc - b.ncc)
    return { n: A.cubes.length, texUsed: A.texUsed, gate: A.texGate && +A.texGate.toFixed(2), found: !!t, detail, notJudged: all.filter(x => x.ncc === null).length, lowest: sorted.slice(0, 6) }
  }, { target })
  console.log(JSON.stringify(r)); await b.close()
})()
