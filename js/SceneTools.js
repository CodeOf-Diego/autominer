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
	
	setUpCameras() {
		ST.axesLines  = new THREE.AxesHelper();
		ST.scene.add(ST.axesLines);
		
		ST.H = window.innerHeight-10, ST.W = window.innerWidth-10
		ST.Wmain = ST.W*2/3
		ST.Horth = ST.H/3
		ST.Worth = ST.W - ST.Wmain

		// Create a new Three.js renderer
		ST.renderer = new THREE.WebGLRenderer();
		ST.renderer.setSize(ST.W, ST.H);
		document.body.appendChild(ST.renderer.domElement);

		// Create a new Three.js camera
		ST.camera = new THREE.PerspectiveCamera(
			75,
			ST.Wmain / ST.H,
			0.1,
			1000
		);
	
		ST.camera.position.x = -12;
		ST.camera.position.y = 10;
		ST.camera.position.z = 12;

		ST.controls = new THREE.OrbitControls(ST.camera, ST.renderer.domElement);
		ST.controls.enableDamping = true;
		ST.controls.dampingFactor = 0.05;

		let zoom = ST.H/30
			ST.axes.forEach((axis)=> {
			ST.Ocamera[axis] = new THREE.OrthographicCamera(
				ST.Worth / zoom, ST.Worth / -zoom,
				ST.Horth / -zoom, ST.Horth / zoom,
				1, 1000
			);
			ST.Ocamera[axis].position.set(axis=='z'?500:0, axis=='y'?500:0, axis=='x'?500:0);
			ST.Ocamera[axis].lookAt(ST.scene.position);
		})
	}



	
	addMeshToScene(vein) {
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
		voxelMaterial[Plains.SUPPORT] = new THREE.MeshBasicMaterial({ color: 0xffbb00 });
		voxelMaterial[Voxels.BLU] = new THREE.MeshBasicMaterial({ color: 0x0000ff });
		voxelMaterial[Voxels.RED] = new THREE.MeshBasicMaterial({ color: 0xff0000 });
	  
		// Create a new Three.js voxel mesh array
		let voxelMeshes = [];
	  
		// Loop through the matrix and create a voxel mesh for each cell
		vein.loop((i)=> {
			let cell = vein.GET()
			if (voxelMaterial[cell]!== undefined) {
				let voxelMesh = new THREE.Mesh(voxelGeometry, voxelMaterial[vein.GET()]);
				voxelMesh.position.set(
				(i.x - matrixSize.x / 2) * voxelSize,
				(i.y - matrixSize.y / 2) * voxelSize,
				(i.z - matrixSize.z / 2) * voxelSize
				);
				voxelMeshes.push(voxelMesh);
				ST.scene.add(voxelMesh);
			}
		})
	}

	clearScene() {
		ST.scene.remove.apply(ST.scene, ST.scene.children);
	}

	// Render the scene with each camera
	animate() {
		requestAnimationFrame(ST.animate);

		// Render main camera
		ST.renderer.setScissorTest(true);
		ST.renderer.setScissor(0, 0, ST.Wmain, ST.H);
		ST.renderer.setViewport(0, 0, ST.Wmain, ST.H);
		ST.renderer.render(ST.scene, ST.camera);

		// Render othogonal cameras
		ST.axes.forEach((axis,pos)=> {
			ST.renderer.setScissor(ST.Wmain, ST.Horth*pos, ST.Worth, ST.Horth);
			ST.renderer.setViewport(ST.Wmain, ST.Horth*pos, ST.Worth, ST.Horth);
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
}