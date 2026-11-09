// Writes synthetic scenes (PNG + ground-truth JSON) into the project: reference/synthetic/. Never deletes anything.
// usage: node synth_save.js <seeds comma list> <brightness comma list>
const { chromium } = require('playwright'), fs = require('fs'), path = require('path')
const OUT = 'C:/Users/Diego/Documents/projects/git/autominer/reference/synthetic'
;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1600, height: 900 } })
  await p.goto('file:///C:/Users/Diego/Documents/projects/git/autominer/index.html'); await p.waitForTimeout(1500)
  await p.addScriptTag({ path: path.join(__dirname, 'synth_page.js') })
  if (process.env.SYNTH_TEX !== '0') await p.evaluate(async () => { const i = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = TEXTURE_DATA.amethyst_block }); const c = document.createElement('canvas'); c.width = 16; c.height = 16; const g = c.getContext('2d'); g.drawImage(i, 0, 0); window.__tex = g.getImageData(0, 0, 16, 16).data })
  const extra = JSON.parse(process.argv[4] || '{}'), label = process.argv[5] || '', seeds = (process.argv[2] || '1,2,3,4,5,6,7,8').split(',').map(Number), brights = (process.argv[3] || '1').split(',').map(Number)
  for (const bright of brights) for (const seed of seeds) {
    const name = `synth${label}-seed${seed}-b${bright}`
    const r = await p.evaluate(({ seed, bright, extra }) => { const s = makeSynth(seed, Object.assign({ bright }, extra)); return { url: s.url, truth: s.truth } }, { seed, bright, extra })
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.url.split(',')[1], 'base64'))
    fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify({ seed, bright, pitch: r.truth.pitch, yaw: r.truth.yaw, fov: r.truth.fov, cubes: r.truth.cubes.map(c => c.c) }))
  }
  console.log('saved', seeds.length * brights.length, 'scenes in', OUT)
  await b.close()
})()
