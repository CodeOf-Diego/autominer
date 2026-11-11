/**
 * Step 0 of the real-world reconstruction idea: given a Minecraft screenshot of a geode, find
 * the camera's FOV/orientation so the ore blocks visible in the photo can be placed back into
 * the 3D grid. This file holds the automatic fit + cube finder (OpenCV.js).
 *
 * OpenCV.js is loaded async from a CDN (index.html) and can take a few seconds (~10MB) - cvReady
 * flips once it's usable; callers should check it first.
 */
let cvReady = false
// The script's onload fires when the file is downloaded, NOT when the WASM runtime is initialised: at that moment cv can be
// a promise, or an object without cv.Mat yet ("cv.Mat is not a constructor"). So cvReady only flips once cv.Mat really exists.
function onOpenCvReady(resolved) {
    if (!resolved && typeof cv !== 'undefined' && cv && typeof cv.then === 'function') { // some builds expose cv as a promise of the module
        cv.then((m) => { window.cv = m; onOpenCvReady(true) }) // `true`: do not take this branch again (the module itself may still have a .then)
        return
    }
    let tries = 0
    let poll = setInterval(() => {
        if (typeof cv !== 'undefined' && cv && typeof cv.Mat === 'function') { clearInterval(poll); cvReady = true }
        else if (++tries > 600) clearInterval(poll) // 60 s: give up quietly
    }, 100)
}
// opencv.js is async: from cache it can load before this deferred file runs, so its onload found no onOpenCvReady and only set the flag
if (window.cvScriptLoaded) onOpenCvReady()
