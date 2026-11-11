/**
 * Right after a scan: plays steps 2 to 7 in about a second, starting from the photo's own viewpoint, so the build
 * is seen coming together. Stops as soon as the user goes to another step. Settings > Skip the build animation
 * jumps straight to step 7 instead.
 */
Object.assign(App, (() => {
	let playToken = 0
	function playBuild() {
		if (currentStage !== 1) return
		let token = ++playToken
		if (settings.skipAnimation) { App.goStep(7); ST.frame(); return }
		App.goStep(2)
		const STEP_MS = 200
		let next = (n) => setTimeout(() => {
			if (token !== playToken || currentStage !== n - 1) return
			App.goStep(n)
			if (n < 7) next(n + 1)
			else ST.frameSmooth(800) // the photo's viewpoint opens out to the whole build
		}, STEP_MS)
		next(3)
	}
	return { playBuild }
})())
