
function combineVoxels(vein,placeholderSides) {
    for (side in placeholderSides) {
        let temp = placeholderSides[side].matrix

			
	// for (let x=0;x<maxL.x+offsets.x;id.x++) {
		// for (let y=0;y<maxL.y+offsets.y;id.y++) {
			// for (let z=0;z<maxL.z+offsets.z;id.z++) {



        for (x in temp) {
            x = parseInt(x)
            for (y in temp[x]) {
                y = parseInt(y)
                for (z in temp[x][y]) {
                    z = parseInt(z)

                    if (vein[x] === undefined)
                        vein[x] = [] 
                    if (vein[x][y] === undefined)
                        vein[x][y] = [] 


                    vein[x][y][z] = temp[x][y][z]
                }
            }
        }
    }
  }

function addDebugInfo(scene,camera) {
	let totalFaces = d.oresCount*6
	d.adjacentFaces = d.adjacentFaces/3	// value is divided because the same check is made 3 times for each face, optimizable
	debug_info.innerHTML +='Debug info<br>'
	debug_info.innerHTML +='Total ores: '+ d.oresCount+'<br>'
	debug_info.innerHTML +='Adjacent ore faces: '+ d.adjacentFaces +' ('+ parseInt(100-(d.adjacentFaces/totalFaces*100)) +'% of theoretical maximum)<br>'
	// debug_info.innerHTML +='plains blocks:  x:'+ d.plainAdjacents.x +',  y:'+ d.plainAdjacents.y +',  z:'+ d.plainAdjacents.z +'<br>'
}

function addMeshToScene(vein, scene) {
	const matrixSize = { x: vein.length, y: vein[0].length, z: vein[0][0].length };

	// Define the size of each voxel
	let voxelSize = 1;
  
	// Create a new Three.js voxel geometry
	let  voxelGeometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
  
	// Create a new Three.js voxel material
	let voxelMaterial = []
	voxelMaterial[Voxels.AMETHIST] = new THREE.MeshBasicMaterial({ color: 0xff00dd });
	voxelMaterial[Voxels.SLIME_BLOCK] = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
	voxelMaterial[Voxels.HONEY_BLOCK] = new THREE.MeshBasicMaterial({ color: 0xffff00 });
	voxelMaterial[Voxels.BLU] = new THREE.MeshBasicMaterial({ color: 0x0000ff });
	voxelMaterial[Voxels.RED] = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  
	// Create a new Three.js voxel mesh array
	let voxelMeshes = [];
  
	// Loop through the matrix and create a voxel mesh for each cell
	for (let x = 0; x < matrixSize.x; x++) {
	  for (let y = 0; y < matrixSize.y; y++) {
		for (let z = 0; z < matrixSize.z; z++) {
			if (vein[x] === undefined)
				vein[x] = [] 
			if (vein[x][y] === undefined)
				vein[x][y] = [] 
			if (vein[x][y][z] === undefined)
				vein[x][y][z] = Voxels.AIR


		  	if (vein[x][y][z] !== Voxels.AIR) {
				let voxelMesh = new THREE.Mesh(voxelGeometry, voxelMaterial[vein[x][y][z]]);
				voxelMesh.position.set(
				(x - matrixSize.x / 2) * voxelSize,
				(y - matrixSize.y / 2) * voxelSize,
				(z - matrixSize.z / 2) * voxelSize
				);
				voxelMeshes.push(voxelMesh);
				scene.add(voxelMesh);
			}
		}
	  }
	}
}