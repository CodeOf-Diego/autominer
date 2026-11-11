/** More SceneTools methods (the class is in js/scene/scene-tools.js; ST is its single instance) */
Object.assign(SceneTools.prototype, {
	/**
	 * layerY: when set (see layerView), draws only cells at or below that world Y
	 * instead of the whole vein/blueprint - the current layer (i.y === layerY) at full opacity,
	 * everything below it (already "built") faded with GHOST_OPACITY as a visual reference,
	 * anything above it left out entirely since it hasn't been reached yet.
	 * center: the matrix index {x,y,z} drawn at the world origin (cell i sits at i - center).
	 * the caller passes the geode's own center, so the geode stays put whatever the display around
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

		// Cells >= GROUP_ID_OFFSET (see js/building/group-plains.js) are a final group id rather than a
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

		// Cells >= MATERIAL_ID_OFFSET (see js/building/group-plains.js) are the 2-color slime/honey view:
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
	},

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
	},

	/**
	 * Scans a Matrix3D for the range of world-Y indices that contain at least one cell
	 * addMeshToScene() would actually draw (see isRenderableCell above). Used to bound the layer
	 * view (layerView) to the part of the display that has something in it, instead of
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
})
