/**
 * Real Minecraft block textures (16x16, pixelated), sourced from the MIT-licensed
 * PrismarineJS/minecraft-assets repo (a community repackaging of Mojang's vanilla assets for
 * tool use, not redistributed further than this local dev project) - see textures/blocks/.
 * Loaded from the base64 data URIs in js/TextureData.js (not from textures/blocks/*.png directly):
 * opening index.html via file:// instead of a local server treats each file:// resource as its
 * own origin, so the browser blocks the image fetch as cross-origin and every material renders
 * black. Data URIs need no fetch at all, so they work the same under file:// and http://.
 * Loaded once and cached so every voxel of the same texture shares one GPU texture.
 */
const TEXTURE_LOADER = new THREE.TextureLoader()
const TEXTURE_CACHE = {}
function loadTexture(name) {
    if (TEXTURE_CACHE[name] === undefined) {
        let tex = TEXTURE_LOADER.load(TEXTURE_DATA[name])
        tex.magFilter = THREE.NearestFilter
        tex.minFilter = THREE.NearestFilter
        if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace
        TEXTURE_CACHE[name] = tex
    }
    return TEXTURE_CACHE[name]
}
const MATERIAL_CACHE = {}
/** One texture on all 6 faces */
function uniformMaterial(name, opacity) {
    let key = name + ':' + (opacity||1)
    if (MATERIAL_CACHE[key] === undefined) {
        MATERIAL_CACHE[key] = new THREE.MeshBasicMaterial({ map: loadTexture(name), transparent: !!opacity, opacity: opacity||1 })
    }
    return MATERIAL_CACHE[key]
}
/** Different texture on top/bottom vs the 4 sides (e.g. honey block) */
function topBottomSideMaterial(topName, bottomName, sideName, opacity) {
    let key = 'tbs:' + topName + ':' + bottomName + ':' + sideName + ':' + (opacity||1)
    if (MATERIAL_CACHE[key] === undefined) {
        let side = uniformMaterial(sideName, opacity), top = uniformMaterial(topName, opacity), bottom = uniformMaterial(bottomName, opacity)
        // BoxGeometry face material order: +X, -X, +Y(top), -Y(bottom), +Z, -Z
        MATERIAL_CACHE[key] = [side, side, top, bottom, side, side]
    }
    return MATERIAL_CACHE[key]
}
/**
 * Directional block (piston, observer): a distinct texture on the face it's "facing", the
 * opposite face, and the 4 remaining sides. dir is a [dx,dy,dz] unit vector (exactly one
 * component is +-1) pointing at the facing face.
 */
function directionalMaterial(frontName, sideName, backName, dir, opacity) {
    let key = 'dir:' + frontName + ':' + sideName + ':' + backName + ':' + dir.join(',') + ':' + (opacity||1)
    if (MATERIAL_CACHE[key] === undefined) {
        let front = uniformMaterial(frontName, opacity), side = uniformMaterial(sideName, opacity), back = uniformMaterial(backName, opacity)
        let mats = [side, side, side, side, side, side] // +X,-X,+Y,-Y,+Z,-Z
        if (dir[0] === 1) { mats[0] = front; mats[1] = back }
        else if (dir[0] === -1) { mats[1] = front; mats[0] = back }
        else if (dir[1] === 1) { mats[2] = front; mats[3] = back }
        else if (dir[1] === -1) { mats[3] = front; mats[2] = back }
        else if (dir[2] === 1) { mats[4] = front; mats[5] = back }
        else if (dir[2] === -1) { mats[5] = front; mats[4] = back }
        MATERIAL_CACHE[key] = mats
    }
    return MATERIAL_CACHE[key]
}
/** Flat color material (debug markers, group palette), cached the same way as the textured ones */
function flatMaterial(color, opacity) {
    let key = 'flat:' + color + ':' + (opacity||1)
    if (MATERIAL_CACHE[key] === undefined) {
        MATERIAL_CACHE[key] = new THREE.MeshBasicMaterial({ color, transparent: !!opacity, opacity: opacity||1 })
    }
    return MATERIAL_CACHE[key]
}
/** Opacity used to still draw, but fade out, the layers below the current one in the layer view (main.js's layerView) */
const GHOST_OPACITY = 0.25
/**
 * Which voxel/plain/material/group cell values addMeshToScene() actually draws a mesh for (see
 * its materialForVoxel()). Kept separate so occupiedYRange() can find where a display's content
 * actually starts/ends without building real materials for every cell.
 */
function isRenderableCell(cell) {
    if (typeof cell === 'number' && (cell >= MATERIAL_ID_OFFSET || cell >= GROUP_ID_OFFSET)) return true
    return [Voxels.AMETHIST, Voxels.SLIME_BLOCK, Voxels.HONEY_BLOCK, Plains.ADJACENT, Plains.SUPPORT, Voxels.BLU, Voxels.RED].includes(cell)
}

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
	}

	setView(v) { Object.assign(ST.view, v); ST.layout() }

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
	}

	tweenId = 0

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
	}

	/** Back to the normal lens (75 deg, optical axis in the middle of the view) after matchCamera() */
	resetLens() {
		ST.lens = null
		ST.camera.fov = 75
		ST.camera.clearViewOffset()
		ST.camera.updateProjectionMatrix()
	}

	/**
	 * Puts the main camera exactly where main.js's photoCameraPose() says the photo was taken from, with the photo's
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
	}

	/** The matchCamera() lens on the current layout: vertical FOV from the focal, view offset for the principal point */
	applyLens() {
		let L = ST.lens, c = ST.camera
		if (!L) return
		c.fov = 2 * Math.atan((ST.H / 2) / L.focal) * 180 / Math.PI
		// with the full image the view's own size, shifting the window by (x, y) moves the optical axis from the
		// middle of the view to (Wmain/2 - x, H/2 - y)
		c.setViewOffset(ST.Wmain, ST.H, ST.Wmain / 2 - (L.px - ST.view.x0), ST.H / 2 - L.py, ST.Wmain, ST.H)
		c.updateProjectionMatrix()
	}

	/**
	 * Aims the 3 orthogonal per-axis cameras (debug) at world point {x,y,z}: the geode sits at the origin, but these
	 * views should show the whole display (geode + planes), so main.js points them at its middle on every render
	 */
	setOrthoTarget(t) {
		ST.axes.forEach((axis) => {
			let c = ST.Ocamera[axis]
			c.position.set(t.x + (axis=='z'?500:0), t.y + (axis=='y'?500:0), t.z + (axis=='x'?500:0))
			c.lookAt(t.x, t.y, t.z)
		})
	}

	setDebug(on) { ST.debug = on; ST.axesLines.visible = on }

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

	updateLabelVisibility() {
		let on = ST.visible3D && ST.view.ortho
		ST.viewportLabelEls.forEach((el) => el.style.display = on ? '' : 'none')
	}

	/**
	 * Toggles the 3D scene (renderer canvas + the XY/XZ/YZ viewport labels) on/off - used by
	 * main.js's stage 1 (photo + detected lines), which shows a 2D view in #calibration_view
	 * instead. Group labels are handled separately via clearGroupLabels().
	 */
	set3DVisible(visible) {
		ST.visible3D = visible
		ST.renderer.domElement.style.display = visible ? '' : 'none'
		ST.updateLabelVisibility()
	}



	
	/**
	 * layerY: when set (see main.js's layerView), draws only cells at or below that world Y
	 * instead of the whole vein/blueprint - the current layer (i.y === layerY) at full opacity,
	 * everything below it (already "built") faded with GHOST_OPACITY as a visual reference,
	 * anything above it left out entirely since it hasn't been reached yet.
	 * center: the matrix index {x,y,z} drawn at the world origin (cell i sits at i - center).
	 * main.js passes the geode's own center, so the geode stays put whatever the display around
	 * it grows into (planes, gap, inversions); defaults to the middle of the matrix.
	 */
	addMeshToScene(vein, layerY, center) {
		if (!center) center = { x: vein.maxX() / 2, y: vein.maxY() / 2, z: vein.maxZ() / 2 };

		// Define the size of each voxel
		let voxelSize = 1;

		// Create a new Three.js voxel geometry
		let  voxelGeometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);

		function materialForVoxel(cell, opacity) {
			if (cell === Voxels.AMETHIST) return uniformMaterial('amethyst_block', opacity)
			if (cell === Voxels.SLIME_BLOCK) return uniformMaterial('slime_block', opacity)
			if (cell === Voxels.HONEY_BLOCK) return topBottomSideMaterial('honey_block_top', 'honey_block_bottom', 'honey_block_side', opacity)
			if (cell === Plains.ADJACENT) return flatMaterial(0xffff00, opacity)
			if (cell === Plains.SUPPORT) return flatMaterial(0xffbb00, opacity)
			if (cell === Voxels.BLU) return ST.debug ? flatMaterial(0x0000ff, opacity) : undefined // debug markers
			if (cell === Voxels.RED) return ST.debug ? flatMaterial(0xff0000, opacity) : undefined
			return undefined
		}

		// Cells >= GROUP_ID_OFFSET (see BuildingTools.js) are a final group id rather than a
		// voxel/plain type. Fixed palette instead of a computed hue: a formula can place two
		// groups' colors close enough to look like one big group, especially with few groups in
		// a reduced hue range. Colors are assigned in first-encounter order so neighboring group
		// ids don't land next to each other in the cycle, and stay well clear of the fixed red
		// debug marker and the magenta/purple amethyst color.
		const GROUP_PALETTE = [0x2563eb, 0x16a34a, 0xf59e0b, 0x7c3aed, 0x06b6d4, 0xca8a04, 0x0d9488, 0x6366f1]
		let groupColorAssigned = {}
		function materialForGroup(groupId, opacity) {
			if (groupColorAssigned[groupId] === undefined) {
				groupColorAssigned[groupId] = GROUP_PALETTE[Object.keys(groupColorAssigned).length % GROUP_PALETTE.length]
			}
			return flatMaterial(groupColorAssigned[groupId], opacity)
		}

		// Cells >= MATERIAL_ID_OFFSET (see BuildingTools.js) are the 2-color slime/honey view:
		// real slime/honey textures, material 0 = slime, material 1 = honey.
		function materialForMaterial(matId, opacity) {
			return matId === 1
				? topBottomSideMaterial('honey_block_top', 'honey_block_bottom', 'honey_block_side', opacity)
				: uniformMaterial('slime_block', opacity)
		}

		// Create a new Three.js voxel mesh array
		let voxelMeshes = [];

		// Loop through the matrix and create a voxel mesh for each cell
		vein.loop((i)=> {
			if (layerY !== null && layerY !== undefined && i.y > layerY) return
			let opacity = (layerY !== null && layerY !== undefined && i.y < layerY) ? GHOST_OPACITY : undefined
			let cell = vein.GET()
			let material
			if (typeof cell === 'number' && cell >= MATERIAL_ID_OFFSET) material = materialForMaterial(cell - MATERIAL_ID_OFFSET, opacity)
			else if (typeof cell === 'number' && cell >= GROUP_ID_OFFSET) material = materialForGroup(cell, opacity)
			else material = materialForVoxel(cell, opacity)
			if (material !== undefined) {
				let voxelMesh = new THREE.Mesh(voxelGeometry, material);
				voxelMesh.position.set(
				(i.x - center.x) * voxelSize,
				(i.y - center.y) * voxelSize,
				(i.z - center.z) * voxelSize
				);
				voxelMeshes.push(voxelMesh);
				ST.scene.add(voxelMesh);
			}
		})
	}

	/**
	 * Layer view helper: a faint square grid lying on the bottom face of layer `layerY`, one
	 * square per block, covering cell indices x in [ext.minX, ext.maxX] and z in [ext.minZ,
	 * ext.maxZ]. Uses the same `center` as addMeshToScene() (cell i is centered at i - center),
	 * so the lines fall exactly on the block edges and make it easy to count blocks in the layer.
	 */
	addLayerGrid(layerY, center, ext) {
		// a hair above the ghosted layer's top faces, so the lines don't z-fight with them
		let y = layerY - center.y - 0.5 + 0.01
		let x0 = ext.minX - center.x - 0.5, x1 = ext.maxX - center.x + 0.5
		let z0 = ext.minZ - center.z - 0.5, z1 = ext.maxZ - center.z + 0.5
		let pts = []
		for (let x = x0; x <= x1 + 1e-6; x++) pts.push(x, y, z0, x, y, z1)
		for (let z = z0; z <= z1 + 1e-6; z++) pts.push(x0, y, z, x1, y, z)
		let geometry = new THREE.BufferGeometry()
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
		let material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false })
		ST.scene.add(new THREE.LineSegments(geometry, material))
	}

	/**
	 * Scans a Matrix3D for the range of world-Y indices that contain at least one cell
	 * addMeshToScene() would actually draw (see isRenderableCell above). Used to bound the layer
	 * view (main.js's layerView) to the part of the display that has something in it, instead of
	 * its whole (mostly empty) bounding box. Returns null if nothing in it is renderable.
	 */
	occupiedYRange(matrix) {
		let min = null, max = null
		matrix.loop((i) => {
			if (!isRenderableCell(matrix.GET())) return
			if (min === null || i.y < min) min = i.y
			if (max === null || i.y > max) max = i.y
		})
		return min === null ? null : { min, max }
	}

	/**
	 * Renders a list of MachineTools.computeMachineBlocks() blocks with real textures, oriented
	 * correctly for pistons/observers, using the same `center` as addMeshToScene()
	 * so they line up with it. layerY: when set (see main.js's layerView), draws only the blocks
	 * at that world Y instead of the whole machine.
	 */
	addMachinesToScene(machineBlocks, center, layerY) {
		const voxelSize = 1;
		let voxelGeometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
		// same cutoff/ghost rule as addMeshToScene(): keep y <= layerY, fade y < layerY
		if (layerY !== null && layerY !== undefined) machineBlocks = machineBlocks.filter((b) => b.y <= layerY);

		// converts a template-local facing ('along'/'-along'/'up'/'-up') into a world [dx,dy,dz]
		function facingToWorldDir(b) {
			if (!b.facing) return null;
			let dir = {x:0, y:0, z:0};
			if (b.facing === 'along') dir[b.axis] = b.worldDir;
			else if (b.facing === '-along') dir[b.axis] = -b.worldDir;
			else dir[perpendicular(b.axis)[0]] = (b.facing === 'up') ? 1 : -1;
			return [dir.x, dir.y, dir.z];
		}

		machineBlocks.forEach((b) => {
			let opacity = (layerY !== null && layerY !== undefined && b.y < layerY) ? GHOST_OPACITY : undefined
			let material;
			if (b.type === 'obsidian') material = uniformMaterial('obsidian', opacity);
			else if (b.type === 'lamp') material = uniformMaterial('redstone_lamp', opacity);
			else if (b.type === 'note') material = uniformMaterial('note_block', opacity);
			else if (b.type === 'piston') material = directionalMaterial('piston_top_sticky', 'piston_side', 'piston_bottom', facingToWorldDir(b), opacity);
			else if (b.type === 'observer') material = directionalMaterial('observer_front', 'observer_side', 'observer_back', facingToWorldDir(b), opacity);
			else material = b.materialIndex === 1 // 'opposite' or 'slime' cell -> the resolved slime/honey material
				? topBottomSideMaterial('honey_block_top', 'honey_block_bottom', 'honey_block_side', opacity)
				: uniformMaterial('slime_block', opacity);

			let mesh = new THREE.Mesh(voxelGeometry, material);
			mesh.position.set(
				(b.x - center.x) * voxelSize,
				(b.y - center.y) * voxelSize,
				(b.z - center.z) * voxelSize
			);
			ST.scene.add(mesh);
		});
	}

	clearScene() {
		let toRemove = ST.scene.children.filter((child) => child !== ST.axesLines);
		ST.scene.remove.apply(ST.scene, toRemove);
	}

	clearGroupLabels() {
		if (ST.groupLabelEls) ST.groupLabelEls.forEach((el) => el.remove());
		ST.groupLabelEls = [];
	}

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



function addDebugInfo() {
	let totalFaces = d.oresCount*6
	d.adjacentFaces = d.adjacentFaces/3	// value is divided because the same check is made 3 times for each face, optimizable
	debug_info.innerHTML ='Debug info<br>'
	debug_info.innerHTML +='Total ores: '+ d.oresCount+'<br>'
	debug_info.innerHTML +='Adjacent ore faces: '+ d.adjacentFaces +' ('+ parseInt(100-(d.adjacentFaces/totalFaces*100)) +'% of theoretical maximum)<br>'
	debug_info.innerHTML +='plains blocks:  x:'+ (d.plainAdjacents.x + d.plainSupports.x) +',  y:'+ (d.plainAdjacents.y + d.plainSupports.y) +',  z:'+ (d.plainAdjacents.z + d.plainSupports.z) +'<br>'
	let avgGroup = d.groupCount > 0 ? d.groupBlocks / d.groupCount : 0
	debug_info.innerHTML +='Groups (x+y+z): '+ d.groupBlocks +' blocks, '+ d.groupCount +' groups, avg '+ avgGroup.toFixed(2) +' blocks/group<br>'
}