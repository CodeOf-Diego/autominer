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
		// what plane each orthogonal camera looks at, since it's not obvious from the viewport alone
		let planeNames = { x: 'XY', y: 'XZ', z: 'YZ' }
			ST.axes.forEach((axis,pos)=> {
			ST.Ocamera[axis] = new THREE.OrthographicCamera(
				ST.Worth / zoom, ST.Worth / -zoom,
				ST.Horth / -zoom, ST.Horth / zoom,
				1, 1000
			);
			ST.Ocamera[axis].position.set(axis=='z'?500:0, axis=='y'?500:0, axis=='x'?500:0);
			ST.Ocamera[axis].lookAt(ST.scene.position);

			let label = document.createElement('span')
			label.textContent = planeNames[axis]
			label.style.position = 'absolute'
			label.style.zIndex = 10
			label.style.color = 'white'
			label.style.fontSize = '16px'
			// left-aligned horizontally, centered vertically on the viewport's row
			label.style.left = (ST.Wmain + 6) + 'px'
			// viewports are stacked bottom-up in WebGL coordinates, so row `pos` sits (pos+1) rows up from the bottom
			label.style.top = (ST.H - ST.Horth*(pos+1) + ST.Horth/2) + 'px'
			label.style.transform = 'translateY(-50%)'
			label.style.pointerEvents = 'none'
			document.body.appendChild(label)
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

		// Cells >= GROUP_ID_OFFSET (see BuildingTools.js) are a final group id rather than a
		// voxel/plain type. Fixed palette instead of a computed hue: a formula can place two
		// groups' colors close enough to look like one big group, especially with few groups in
		// a reduced hue range. Colors are assigned in first-encounter order so neighboring group
		// ids don't land next to each other in the cycle, and stay well clear of the fixed red
		// debug marker and the magenta/purple amethyst color.
		const GROUP_PALETTE = [0x2563eb, 0x16a34a, 0xf59e0b, 0x7c3aed, 0x06b6d4, 0xca8a04, 0x0d9488, 0x6366f1]
		let groupColorCache = {}
		function materialForGroup(groupId) {
			if (groupColorCache[groupId] === undefined) {
				let color = GROUP_PALETTE[Object.keys(groupColorCache).length % GROUP_PALETTE.length]
				groupColorCache[groupId] = new THREE.MeshBasicMaterial({ color })
			}
			return groupColorCache[groupId]
		}

		// Cells >= MATERIAL_ID_OFFSET (see BuildingTools.js) are the 2-color slime/honey view:
		// green for material 0, yellow for material 1.
		let materialColorCache = {}
		const MATERIAL_COLORS = { 0: 0x16a34a, 1: 0xeab308 }
		function materialForMaterial(matId) {
			if (materialColorCache[matId] === undefined) {
				materialColorCache[matId] = new THREE.MeshBasicMaterial({ color: MATERIAL_COLORS[matId] })
			}
			return materialColorCache[matId]
		}

		// Create a new Three.js voxel mesh array
		let voxelMeshes = [];

		// Loop through the matrix and create a voxel mesh for each cell
		vein.loop((i)=> {
			let cell = vein.GET()
			let material
			if (typeof cell === 'number' && cell >= MATERIAL_ID_OFFSET) material = materialForMaterial(cell - MATERIAL_ID_OFFSET)
			else if (typeof cell === 'number' && cell >= GROUP_ID_OFFSET) material = materialForGroup(cell)
			else material = voxelMaterial[cell]
			if (material !== undefined) {
				let voxelMesh = new THREE.Mesh(voxelGeometry, material);
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
	 * displaySize is the combined display matrix's {x,y,z} dimensions (same as addMeshToScene's
	 * matrixSize), originalSize is the vein's own {x,y,z} before any blueprint was combined in.
	 */
	updateGroupLabels(data_layers, displaySize, originalSize) {
		ST.clearGroupLabels();
		const voxelSize = 1;
		const pos = { x: 0, y: 1, z: 2 }; // row index of each axis's viewport, matches ST.axes order

		// An axis's blueprint slab is flat on that axis (fixed coordinate) and spread on the
		// other two - so it only renders as a readable 2D shape through the camera whose own
		// *depth* direction is that same axis (depth hides the fixed coordinate, letting the two
		// varying ones map to screen X/Y). Camera 'x' sits on Z (depth=Z), 'y' sits on Y
		// (depth=Y), 'z' sits on X (depth=X) - see setUpCameras(). So axis x's blueprint reads
		// correctly through camera 'z', axis z's through camera 'x', and axis y through itself.
		const cameraForAxis = { x: 'z', y: 'y', z: 'x' }

		ST.axes.forEach((axis) => {
			let ppd = perpendicular(axis);
			let cameraAxis = cameraForAxis[axis];
			let camera = ST.Ocamera[cameraAxis];
			camera.updateMatrixWorld();

			for (let label of data_layers[axis].groupLabels) {
				let world = { x: 0, y: 0, z: 0 };
				world[axis] = originalSize[axis] + BLUEPRINT_GAP;
				world[ppd[0]] = label.i;
				world[ppd[1]] = label.j;

				let point = new THREE.Vector3(
					(world.x - displaySize.x / 2) * voxelSize,
					(world.y - displaySize.y / 2) * voxelSize,
					(world.z - displaySize.z / 2) * voxelSize
				);
				point.project(camera);
				if (point.z < -1 || point.z > 1) continue; // behind/outside this camera

				let screenX = ST.Wmain + (point.x + 1) / 2 * ST.Worth;
				let screenY = (ST.H - ST.Horth * (pos[cameraAxis] + 1)) + (1 - point.y) / 2 * ST.Horth;

				let el = document.createElement('span');
				el.textContent = label.index;
				el.style.position = 'absolute';
				el.style.zIndex = 11;
				el.style.color = 'white';
				el.style.fontSize = '13px';
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
	let avgGroup = d.groupCount > 0 ? d.groupBlocks / d.groupCount : 0
	debug_info.innerHTML +='Groups (x+y+z): '+ d.groupBlocks +' blocks, '+ d.groupCount +' groups, avg '+ avgGroup.toFixed(2) +' blocks/group<br>'
}