// Independent judge: texture correlation (template learned from photos 1/2, verified on photo 3's reliable cubes) of the cells of each result on photo 3
const H = require('./harness')
;(async () => {
  const { b, p } = await H.open()
  await H.photo(p, 'geode02') // learns + caches the template
  for (const noTex of [true, false]) {
    await p.evaluate((v) => { window.__noTex = v }, noTex)
    await H.photo(p, 'geode03')
    const r = await p.evaluate(async () => {
      const A = autoCubes, an = autoCal.an, tex = await makeTextureContext(calibrationImage)
      const cells = selectCellsByRay(A, an, { tex, minNcc: -2 }) // same geometry, ungated, with the ncc of every cell
      const n = cells.map(c => c.ncc).filter(x => x !== null).sort((a, b) => a - b)
      const good = n.filter(x => x >= 0.5).length
      return { cubesInResult: A.cubes.length, ungatedCells: cells.length, judged: n.length, median: n.length ? +n[n.length >> 1].toFixed(2) : null, q25: n.length ? +n[Math.floor(n.length * 0.25)].toFixed(2) : null, goodAbove05: good, templateFrom: tex.learned, quality: A.texUsed }
    })
    console.log(noTex ? 'noTex ' : 'withTex', JSON.stringify(r))
  }
  await b.close()
})()
