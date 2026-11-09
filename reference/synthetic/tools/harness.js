const { chromium } = require('playwright')
exports.open = async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1600, height: 900 } })
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message))
  await p.goto('file:///C:/Users/Diego/Documents/projects/git/autominer/index.html'); await p.waitForTimeout(1500)
  await p.keyboard.press('1') // first visit to stage 1 attaches the photo-select listener
  await p.waitForFunction(() => autoCalState === 'done', null, { timeout: 120000 })
  return { b, p }
}
exports.photo = async (p, ph) => { // switch photo and wait until the run for THAT photo is done
  await p.evaluate((v) => { calibration_photo.value = v; calibration_photo.dispatchEvent(new Event('change')) }, ph)
  await p.keyboard.press('1')
  await p.waitForFunction((k) => autoCalState === 'done' && PHOTO_DATA[k] === calibrationImage.src, ph, { timeout: 120000 })
}
