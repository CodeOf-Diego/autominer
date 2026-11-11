/** More SceneTools methods (the class is in js/scene/scene-tools.js; ST is its single instance) */
Object.assign(SceneTools.prototype, {
	setUpCameras() {
		ST.axesLines  = new THREE.AxesHelper();
		ST.axesLines.visible = false // debug only, see setDebug()
		ST.scene.add(ST.axesLines);

		// transparent, so the page background shows behind the geode
		ST.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
		ST.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
		ST.renderer.setClearColor(0x000000, 0);
		ST.renderer.domElement.id = 'scene_canvas'
		document.body.appendChild(ST.renderer.domElement);

		ST.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
		ST.camera.position.set(-12, 10, 12);

		ST.controls = new THREE.OrbitControls(ST.camera, ST.renderer.domElement);
		ST.controls.enableDamping = true;
		ST.controls.dampingFactor = 0.05;
		ST.controls.addEventListener('start', () => { ST.tweenId++ }); // grabbing the view cancels a camera glide

		// what plane each orthogonal camera looks at, since it's not obvious from the viewport alone
		let planeNames = { x: 'XY', y: 'XZ', z: 'YZ' }
		ST.viewportLabelEls = []
		ST.axes.forEach((axis) => {
			ST.Ocamera[axis] = new THREE.OrthographicCamera(1, -1, -1, 1, 1, 1000); // real frustum set by layout()
			ST.Ocamera[axis].position.set(axis=='z'?500:0, axis=='y'?500:0, axis=='x'?500:0);
			ST.Ocamera[axis].lookAt(ST.scene.position);

			let label = document.createElement('span')
			label.className = 'viewport-label'
			label.textContent = planeNames[axis]
			document.body.appendChild(label)
			ST.viewportLabelEls.push(label)
		})
		window.addEventListener('resize', () => { ST.layout(); if (ST.onLayout) ST.onLayout() })
		ST.layout()
	},

	setView(v) { Object.assign(ST.view, v); ST.layout() },

	/**
	 * Points the main camera at the world origin - the geode's center (see addMeshToScene's `center`), so it stays in the
	 * same spot whatever step is shown - and moves it back just enough to see everything drawn around it, keeping the
	 * current viewing direction (or `dir`, a vector from the target towards the camera)
	 */
	frame(dir) {
		ST.tweenId++
		ST.resetLens()
		let box = new THREE.Box3()
		ST.scene.children.forEach((c) => { if (c !== ST.axesLines) box.expandByObject(c) })
		if (box.isEmpty()) return
		let center = new THREE.Vector3(), r = 0
		for (let corner of [box.min, box.max].flatMap((a) => [box.min, box.max].flatMap((b) => [box.min, box.max].map((c) => new THREE.Vector3(a.x, b.y, c.z)))))
			r = Math.max(r, corner.length())
		let vfov = ST.camera.fov * Math.PI / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * ST.camera.aspect)
		let dist = 0.9 * r / Math.sin(Math.min(vfov, hfov) / 2) // the box's bounding sphere is loose: a bit closer still shows it all
		let d = dir ? dir.clone() : ST.camera.position.clone().sub(ST.controls.target)
		if (d.lengthSq() < 1e-9) d.set(-12, 10, 12)
		ST.controls.target.copy(center)
		ST.camera.position.copy(center).addScaledVector(d.normalize(), dist)
		ST.controls.update()
	},

	/**
	 * Like frame(), but glides there over `ms`: position, target and - after matchCamera() - the lens (focal and principal
	 * point) are interpolated, so the photo's viewpoint opens out into the normal orbit view without a cut. Any manual
	 * camera move (drag/zoom) or another frame()/matchCamera() call cancels it.
	 */
	frameSmooth(ms = 800, dir) {
		let from = { pos: ST.camera.position.clone(), target: ST.controls.target.clone(), lens: ST.lens ? Object.assign({}, ST.lens) : null }
		ST.frame(dir)
		let to = { pos: ST.camera.position.clone(), target: ST.controls.target.clone() }
		ST.camera.position.copy(from.pos); ST.controls.target.copy(from.target)
		ST.lens = from.lens; ST.applyLens()
		let id = ++ST.tweenId, t0 = performance.now()
		let focalEnd = (ST.H / 2) / Math.tan(37.5 * Math.PI / 180) // the normal 75 deg lens
		let pxEnd = ST.view.x0 + ST.Wmain / 2, pyEnd = ST.H / 2
		let step = () => {
			if (id !== ST.tweenId) return
			let k = Math.min(1, (performance.now() - t0) / ms), e = k * k * (3 - 2 * k) // smoothstep
			ST.camera.position.lerpVectors(from.pos, to.pos, e)
			ST.controls.target.lerpVectors(from.target, to.target, e)
			if (from.lens && k < 1) {
				ST.lens = { focal: from.lens.focal + (focalEnd - from.lens.focal) * e, px: from.lens.px + (pxEnd - from.lens.px) * e, py: from.lens.py + (pyEnd - from.lens.py) * e }
				ST.applyLens()
			} else if (k >= 1) ST.resetLens()
			ST.controls.update()
			if (k < 1) requestAnimationFrame(step)
		}
		requestAnimationFrame(step)
	},

	/** Back to the normal lens (75 deg, optical axis in the middle of the view) after matchCamera() */
	resetLens() {
		ST.lens = null
		ST.camera.fov = 75
		ST.camera.clearViewOffset()
		ST.camera.updateProjectionMatrix()
	},

	/**
	 * Puts the main camera exactly where photoCameraPose() says the photo was taken from, with the photo's
	 * focal length and principal point on screen (in px), so the 3D view lines up pixel for pixel with the photo just
	 * hidden. Orbiting then turns around pose.target, which stays on that principal point; frame() undoes the lens.
	 */
	matchCamera(pose) {
		ST.tweenId++
		ST.camera.position.copy(pose.position)
		ST.camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(pose.right, pose.up, pose.back))
		ST.controls.target.copy(pose.target)
		ST.lens = { focal: pose.focal, px: pose.px, py: pose.py }
		ST.applyLens()
		ST.controls.update()
	},

	/** The matchCamera() lens on the current layout: vertical FOV from the focal, view offset for the principal point */
	applyLens() {
		let L = ST.lens, c = ST.camera
		if (!L) return
		c.fov = 2 * Math.atan((ST.H / 2) / L.focal) * 180 / Math.PI
		// with the full image the view's own size, shifting the window by (x, y) moves the optical axis from the
		// middle of the view to (Wmain/2 - x, H/2 - y)
		c.setViewOffset(ST.Wmain, ST.H, ST.Wmain / 2 - (L.px - ST.view.x0), ST.H / 2 - L.py, ST.Wmain, ST.H)
		c.updateProjectionMatrix()
	},

	/**
	 * Aims the 3 orthogonal per-axis cameras (debug) at world point {x,y,z}: the geode sits at the origin, but these
	 * views should show the whole display (geode + planes), so renderStage() points them at its middle on every render
	 */
	setOrthoTarget(t) {
		ST.axes.forEach((axis) => {
			let c = ST.Ocamera[axis]
			c.position.set(t.x + (axis=='z'?500:0), t.y + (axis=='y'?500:0), t.z + (axis=='x'?500:0))
			c.lookAt(t.x, t.y, t.z)
		})
	},

	setDebug(on) { ST.debug = on; ST.axesLines.visible = on },

	/** Sizes the renderer, the cameras and the XY/XZ/YZ labels from the window and ST.view */
	layout() {
		let W = window.innerWidth, H = window.innerHeight
		ST.W = W; ST.H = H
		ST.renderer.setSize(W, H)
		ST.Worth = ST.view.ortho ? Math.round(W / 3) : 0
		ST.Wmain = Math.max(1, W - ST.Worth - ST.view.x0)
		ST.Horth = H / 3
		ST.camera.aspect = ST.Wmain / H
		ST.camera.updateProjectionMatrix()
		ST.applyLens()
		let zoom = H / 30
		ST.axes.forEach((axis, pos) => {
			let c = ST.Ocamera[axis]
			c.left = ST.Worth / zoom; c.right = ST.Worth / -zoom; c.top = ST.Horth / -zoom; c.bottom = ST.Horth / zoom
			c.updateProjectionMatrix()
			let label = ST.viewportLabelEls[pos]
			label.style.left = (W - ST.Worth + 8) + 'px'
			// viewports are stacked bottom-up in WebGL coordinates, so row `pos` sits (pos+1) rows up from the bottom
			label.style.top = (H - ST.Horth * (pos + 1) + 10) + 'px'
		})
		ST.updateLabelVisibility()
	}
})
