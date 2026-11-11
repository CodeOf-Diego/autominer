/** More SceneTools methods (the class is in js/scene/scene-tools.js; ST is its single instance) */
Object.assign(SceneTools.prototype, {
	updateLabelVisibility() {
		let on = ST.visible3D && ST.view.ortho
		ST.viewportLabelEls.forEach((el) => el.style.display = on ? '' : 'none')
	},

	clearGroupLabels() {
		if (ST.groupLabelEls) ST.groupLabelEls.forEach((el) => el.remove());
		ST.groupLabelEls = [];
	},

	/**
	 * Draws a small number over each final group's centroid in the 3 orthogonal viewports, so a
	 * specific group can be pointed at by index ("group 0", "group 5", ...) unambiguously.
	 * center is the same display index addMeshToScene() drew at the world origin; originalSize is the vein's own {x,y,z}; gap/invert must match whatever was
	 * passed to Tools3D.buildDisplay() for this render, so labels land where the blueprint
	 * actually is. show (default all true) skips an axis entirely when its blueprint is hidden.
	 */
	updateGroupLabels(data_layers, center, originalSize, gap, invert, show={x:true,y:true,z:true}) {
		ST.clearGroupLabels();
		const voxelSize = 1;
		const pos = { x: 0, y: 1, z: 2 }; // row index of each axis's viewport, matches ST.axes order
		const shift = {
			x: invert.x ? gap + 1 : 0,
			y: invert.y ? gap + 1 : 0,
			z: invert.z ? gap + 1 : 0,
		}

		// An axis's blueprint slab is flat on that axis (fixed coordinate) and spread on the
		// other two - so it only renders as a readable 2D shape through the camera whose own
		// *depth* direction is that same axis (depth hides the fixed coordinate, letting the two
		// varying ones map to screen X/Y). Camera 'x' sits on Z (depth=Z), 'y' sits on Y
		// (depth=Y), 'z' sits on X (depth=X) - see setUpCameras(). So axis x's blueprint reads
		// correctly through camera 'z', axis z's through camera 'x', and axis y through itself.
		const cameraForAxis = { x: 'z', y: 'y', z: 'x' }

		ST.axes.forEach((axis) => {
			if (!show[axis]) return;
			let ppd = perpendicular(axis);
			let cameraAxis = cameraForAxis[axis];
			let camera = ST.Ocamera[cameraAxis];
			camera.updateMatrixWorld();

			for (let label of data_layers[axis].groupLabels) {
				let world = { x: 0, y: 0, z: 0 };
				world[axis] = invert[axis] ? 0 : (originalSize[axis] + shift[axis] + gap);
				world[ppd[0]] = shift[ppd[0]] + label.i;
				world[ppd[1]] = shift[ppd[1]] + label.j;

				let point = new THREE.Vector3(
					(world.x - center.x) * voxelSize,
					(world.y - center.y) * voxelSize,
					(world.z - center.z) * voxelSize
				);
				point.project(camera);
				if (point.z < -1 || point.z > 1) continue; // behind/outside this camera

				let screenX = ST.W - ST.Worth + (point.x + 1) / 2 * ST.Worth;
				let screenY = (ST.H - ST.Horth * (pos[cameraAxis] + 1)) + (1 - point.y) / 2 * ST.Horth;

				let el = document.createElement('span');
				el.textContent = label.index;
				el.style.position = 'absolute';
				el.style.zIndex = 11;
				el.style.color = 'white';
				el.style.opacity = '0.65';
				el.style.fontSize = '39px';
				el.style.fontWeight = 'bold';
				el.style.textShadow = '0 0 2px black, 0 0 2px black';
				el.style.left = screenX + 'px';
				el.style.top = (screenY - 8) + 'px'; // a few px above the group's centroid
				el.style.transform = 'translate(-50%, -50%)';
				el.style.pointerEvents = 'none';
				document.body.appendChild(el);
				ST.groupLabelEls.push(el);
			}
		})
	}
})
