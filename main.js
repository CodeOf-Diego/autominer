


var d={}

/**
 * Starting from a passed vein adds a 3D mesh of it in the scene
 */
function processVein(vein) {
	if (d!==false) {
		d.oresCount
		d.adjacentFaces = 0
		d.plainAdjacents = {x:0,y:0,z:0}
		d.plainSupports = {x:0,y:0,z:0}
	}

	vein = new Matrix3D(vein)
    console.log('vein',  vein)

	let data_layers={x:{},y:{},z:{}},obj_layers={x:{},y:{},z:{}}
	data_layers.x.plain = generatePlain(vein,'x')
	data_layers.y.plain = generatePlain(vein,'y')
	data_layers.z.plain = generatePlain(vein,'z')

	findAdjacents(data_layers.x.plain)
	findAdjacents(data_layers.y.plain)
	findAdjacents(data_layers.z.plain)

	findDistinctAreas(data_layers.x)
	findDistinctAreas(data_layers.y)
	findDistinctAreas(data_layers.z)
	disableInvalidAreas(data_layers.x)
	disableInvalidAreas(data_layers.y)
	disableInvalidAreas(data_layers.z)
	addSupportBlocks(data_layers.x)
	addSupportBlocks(data_layers.y)
	addSupportBlocks(data_layers.z)


	

	
	vein.set(2,2,2,Voxels.RED)
	// vein.set(12,12,12,Voxels.BLU)

	obj_layers.x.blueprint = Tools3D.plainToVolume(data_layers.x.plain,'x')
	obj_layers.y.blueprint = Tools3D.plainToVolume(data_layers.y.plain,'y')
	obj_layers.z.blueprint = Tools3D.plainToVolume(data_layers.z.plain,'z')
	Tools3D.combineVolumes(vein, obj_layers.x.blueprint,'x')
	Tools3D.combineVolumes(vein, obj_layers.y.blueprint,'y')
	Tools3D.combineVolumes(vein, obj_layers.z.blueprint,'z')

	// Adds mesh to scene
	ST.addMeshToScene(vein)
}


window.addEventListener(`DOMContentLoaded`, () => {
	ST.new()

	let vein = generateRandomVein()
	// vein = veinXX
	processVein(vein)



	addDebugInfo()

	ST.setUpCameras()
	ST.animate()
});

document.addEventListener('keydown', (event) => {
	if (event.key === 'r') {
		ST.clearScene()
		let vein = generateRandomVein()
		processVein(vein)
		addDebugInfo()
	}
	if (event.key === 'i') {
		debug_info.style.display = (debug_info.style.display == 'none') ? 'block' : 'none';
	}
});