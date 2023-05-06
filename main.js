
var d={}

if (d!==false) {
	d.oresCount
	d.adjacentFaces = 0
	d.plainAdjacents = {x:0,y:0,z:0}
}

window.addEventListener(`DOMContentLoaded`, () => {

	
	let vein = generateRandomVein()

	let plain={},adjacent={},placeholder={},data_layers={}
	plain['x'] = generatePlain(vein,'x')
	// plain['y'] = generatePlain(vein,'y')
	// plain['z'] = generatePlain(vein,'z')
	
	
	findAdjacents(plain['x'])
	// findAdjacents(plain['y'])
	// findAdjacents(plain['z'])
	data_layers['x'] = findDistinctAreas(plain['x'])
	disableInvalidAreas(data_layers['x'])



	
    
    // console.log('plain',    data_layers['x'][0])
    // console.log('areas',    data_layers['x'][2])
    // console.log('counter',  data_layers['x'][3])
    // console.log('vein',  vein)
	


	placeholder['x'] = placeholderSide(vein, plain['x'], 'x')
	// placeholder['y'] = placeholderSide(vein, plain['y'], 'y')
	// placeholder['z'] = placeholderSide(vein, plain['z'], 'z')
	
	vein[2][2][2]= Voxels.RED
	// vein[13][13][13]= Voxels.BLU
	
	combineVoxels(vein,placeholder)


	// Create a new Three.js scene
	const scene = new THREE.Scene();


	const axesLines = new THREE.AxesHelper();
	scene.add(axesLines);

	// Adds mesh to scene
	addMeshToScene(vein, scene)


	let H = window.innerHeight-10, W = window.innerWidth-10
	let Wmain = W*2/3
	let Horth = H/3
	let Worth = W - Wmain

	// Create a new Three.js renderer
	const renderer = new THREE.WebGLRenderer();
	renderer.setSize(W, H);
	document.body.appendChild(renderer.domElement);

	// Create a new Three.js camera
	const camera = new THREE.PerspectiveCamera(
		75,
		Wmain / H,
		0.1,
		1000
	);
  
	camera.position.x = -12;
	camera.position.y = 10;
	camera.position.z = 12;

	const controls = new THREE.OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.05;

	var Ocamera = {}
	var axes = ['x','y','z']
	let zoom = H/30
		axes.forEach((axis)=> {
		Ocamera[axis] = new THREE.OrthographicCamera(
			Worth / zoom, Worth / -zoom,
			Horth / -zoom, Horth / zoom,
			1, 1000
		);
		Ocamera[axis].position.set(axis=='z'?500:0, axis=='y'?500:0, axis=='x'?500:0);
		Ocamera[axis].lookAt(scene.position);
	})


	addDebugInfo(scene,camera,d)


	// Render the scene with each camera
	function animate() {
		requestAnimationFrame(animate);

		// Render main camera
		renderer.setScissorTest(true);
		renderer.setScissor(0, 0, Wmain, H);
		renderer.setViewport(0, 0, Wmain, H);
		renderer.render(scene, camera);

		// Render othogonal cameras
		axes.forEach((axis,pos)=> {
			renderer.setScissor(Wmain, Horth*pos, Worth, Horth);
			renderer.setViewport(Wmain, Horth*pos, Worth, Horth);
			renderer.render(scene, Ocamera[axis]);
		})

		controls.update();
	}
  	animate();
});