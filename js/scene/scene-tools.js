class SceneTools {
	axes = ['x','y','z']
	
	scene
	renderer
	axesLines
	camera
	Ocamera = {}
	controls
	

	new() {
		// Create a new Three.js scene
		ST.scene = new THREE.Scene();

	}
	
	/**
	 * Where the scene is drawn inside the full-window canvas: the main (perspective) view starts x0 px from the left (the
	 * landing page keeps the left side for its panel), and with ortho on the right third holds the 3 orthogonal per-axis
	 * views (debug only). Change it with setView(); layout() recomputes every size from the window.
	 */
	view = { x0: 0, ortho: false }
	debug = false
	visible3D = true

	tweenId = 0

	/**
	 * Toggles the 3D scene (renderer canvas + the XY/XZ/YZ viewport labels) on/off - used by
	 * stage 1 (photo + detected lines), which shows a 2D view in #calibration_view
	 * instead. Group labels are handled separately via clearGroupLabels().
	 */
	set3DVisible(visible) {
		ST.visible3D = visible
		ST.renderer.domElement.style.display = visible ? '' : 'none'
		ST.updateLabelVisibility()
	}

	// Render the scene with each camera
	animate() {
		requestAnimationFrame(ST.animate);
		if (!ST.visible3D) return // stage 1 shows the photo instead

		// the canvas is transparent: clear all of it, then draw each viewport in its scissor box
		ST.renderer.setScissorTest(false);
		ST.renderer.clear();
		ST.renderer.setScissorTest(true);

		// Render main camera
		ST.renderer.setScissor(ST.view.x0, 0, ST.Wmain, ST.H);
		ST.renderer.setViewport(ST.view.x0, 0, ST.Wmain, ST.H);
		ST.renderer.render(ST.scene, ST.camera);

		// Render othogonal cameras (debug only)
		if (ST.view.ortho) ST.axes.forEach((axis,pos)=> {
			ST.renderer.setScissor(ST.W - ST.Worth, ST.Horth*pos, ST.Worth, ST.Horth);
			ST.renderer.setViewport(ST.W - ST.Worth, ST.Horth*pos, ST.Worth, ST.Horth);
			ST.renderer.render(ST.scene, ST.Ocamera[axis]);
		})

		ST.controls.update();
	}
}

const ST = new SceneTools()
