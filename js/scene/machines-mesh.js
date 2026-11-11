/** More SceneTools methods (the class is in js/scene/scene-tools.js; ST is its single instance) */
Object.assign(SceneTools.prototype, {
	/**
	 * Renders a list of MachineTools.computeMachineBlocks() blocks with real textures, oriented
	 * correctly for pistons/observers, using the same `center` as addMeshToScene()
	 * so they line up with it. layerY: when set (see layerView), draws only the blocks
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
	},

	clearScene() {
		let toRemove = ST.scene.children.filter((child) => child !== ST.axesLines);
		ST.scene.remove.apply(ST.scene, toRemove);
	}
})
