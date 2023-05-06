

function addDebugInfo(scene,camera) {
	let totalFaces = d.oresCount*6
	d.adjacentFaces = d.adjacentFaces/3	// value is divided because the same check is made 3 times for each face, optimizable
	debug_info.innerHTML +='Debug info<br>'
	debug_info.innerHTML +='Total ores: '+ d.oresCount+'<br>'
	debug_info.innerHTML +='Adjacent ore faces: '+ d.adjacentFaces +' ('+ parseInt(100-(d.adjacentFaces/totalFaces*100)) +'% of theoretical maximum)<br>'
	// debug_info.innerHTML +='plains blocks:  x:'+ d.plainAdjacents.x +',  y:'+ d.plainAdjacents.y +',  z:'+ d.plainAdjacents.z +'<br>'
}

function addMeshToScene(vein, scene) {
	const matrixSize = { x: vein.maxX(), y: vein.maxY(), z: vein.maxZ() };

	// Define the size of each voxel
	let voxelSize = 1;
  
	// Create a new Three.js voxel geometry
	let  voxelGeometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
  
	// Create a new Three.js voxel material
	let voxelMaterial = []
	voxelMaterial[Voxels.AMETHIST] = new THREE.MeshBasicMaterial({ color: 0xff00dd });
	voxelMaterial[Voxels.SLIME_BLOCK] = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
	voxelMaterial[Voxels.HONEY_BLOCK] = new THREE.MeshBasicMaterial({ color: 0xffff00 });
	voxelMaterial[Plains.ADJACENT] = new THREE.MeshBasicMaterial({ color: 0xffff00 });
	voxelMaterial[Voxels.BLU] = new THREE.MeshBasicMaterial({ color: 0x0000ff });
	voxelMaterial[Voxels.RED] = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  
	// Create a new Three.js voxel mesh array
	let voxelMeshes = [];
  
	// Loop through the matrix and create a voxel mesh for each cell
	vein.loop((i)=> {
		cell = vein.GET()
		// if ( === undefined)
		// 	vein.SET(Voxels.AIR)

		// if (vein.GET() !== Voxels.AIR) {
		if (voxelMaterial[cell]!== undefined) {
			let voxelMesh = new THREE.Mesh(voxelGeometry, voxelMaterial[vein.GET()]);
			voxelMesh.position.set(
			(i.x - matrixSize.x / 2) * voxelSize,
			(i.y - matrixSize.y / 2) * voxelSize,
			(i.z - matrixSize.z / 2) * voxelSize
			);
			voxelMeshes.push(voxelMesh);
			scene.add(voxelMesh);
		}
	})
}