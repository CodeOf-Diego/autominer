  
/**
 * Receives the 3D structure of the amethist vein and compresses the given axis,
 *  returning a plain consisting of the other 2
 * @param array vein
 * @param string axis  to compress 
 */
function generatePlain(vein, axis) {
    let ppd = perpendicular(axis)
   
    let plain = new Matrix2D()
    vein.loop((i)=>{
        if (plain.get(i[ppd[0]],i[ppd[1]]) != Plains.AMETHIST) {
            plain.set(i[ppd[0]],i[ppd[1]], vein.GET()==Voxels.AMETHIST?Plains.AMETHIST:Plains.AIR)
        }
        
        if (vein.GET() == Voxels.AMETHIST && d!==false) {
            d.plainAdjacents[axis]++
            if (vein.XP() == Voxels.AMETHIST || vein.YP() == Voxels.AMETHIST || vein.YP() == Voxels.AMETHIST) {
                d.adjacentFaces+=2
            }
        }
    })
    return plain
}

/**
 * Looks for amethist in the 2D plain passed and extracts the neighbouring cells
 * chatGPT + me
 * @param {Matrix2D} plain 
 * @returns 
 */
function findAdjacents(plain) {
    plain.loop((i)=>{
        if ([plain.IP(),plain.IN(),plain.JP(),plain.JN()].includes(Plains.AMETHIST) && plain.GET()==Plains.AIR)
            plain.SET(Plains.ADJACENT)
    })
}

/**
 * 
 * @param {Matrix2D} plain 
 * @returns 
 */
function findDistinctAreas(data_layers) {
    let plain = data_layers.plain
    let i,j,area = 0
    let check, toCheck = []
    let checked = new Matrix2D(), areas=new Matrix2D(),counter={},areaPlains={}
 
    // loops until the whole plain has been mapped
    plain.loop((ii)=>{
        if (checked.get(ii.i,ii.j) === undefined && toCheck.indexOf(ii.i+' '+ii.j) === -1) {
            
            if (plain.get(ii.i,ii.j) == Plains.AMETHIST) {
                checked.set(ii.i,ii.j, Plains.area_AMETHIST)
                areas.set(ii.i,ii.j, 0)
            }
            else {
                area++
                toCheck.push(ii.i+' '+ii.j)
                // loops until the whole area has been mapped
                do {
                    // i for horizontal movement
                    // J for vertical movement
                    check = toCheck.shift()
                    check = check.split(' ')
                    i = parseInt(check[0])
                    j = parseInt(check[1])
                    
                    // skip if already checked
                    if (checked.get(i,j) === undefined) {
                        //checks if the cell can belong to the area
                        if ([Plains.AIR,Plains.ADJACENT].includes(plain.get(i,j))) {
                            checked.set(i,j, Plains.area_AREA)
                            areas.set(i,j, area)
                            
                            if (counter[area]===undefined) counter[area]=0
                            counter[area]++
                            
                            if (areaPlains[area] === undefined)areaPlains[area]=[]
                            areaPlains[area].push([i,j])
                            // puts the neighbouring cells in the list to check
                            if (i<plain.maxI() && checked.get(i+1,j) === undefined && toCheck.indexOf((i+1)+' '+j) === -1)
                                toCheck.push((i+1)+' '+j)
                            if (j<plain.maxJ() && checked.get(i,j+1) === undefined && toCheck.indexOf(i+' '+(j+1)) === -1)
                                toCheck.push(i+' '+(j+1))
                            if (i>0 && checked.get(i-1,j) === undefined && toCheck.indexOf((i-1)+' '+j) === -1)
                                toCheck.push((i-1)+' '+j)
                            if (j>0 && checked.get(i,j-1) === undefined && toCheck.indexOf(i+' '+(j-1)) === -1)
                                toCheck.push(i+' '+(j-1))
                        }
                        else {
                            checked.set(i,j, Plains.area_AMETHIST)
                            areas.set(i,j, 0)                
                        }
                    }
                } while (toCheck.length > 0)
            }
        }
    })
    data_layers.checked = checked
    data_layers.areas = areas
    data_layers.counter = counter
    data_layers.areaPlains = areaPlains
}

/**
 * Looks for all available L shapes surrounding this area
 * @param {*} matrix 
 */
function findLShapes(matrix, r, c, cell_l_found) {
    let LShapes = [];
    let directions = [
        [[1,0],[2,0],[ 0, 1]],
        [[1,0],[2,0],[ 0,-1]],
        [[1,0],[2,0],[ 2, 1]],
        [[1,0],[2,0],[ 2,-1]],
        [[0,1],[0,2],[ 1, 0]],
        [[0,1],[0,2],[-1, 0]],
        [[0,1],[0,2],[ 1, 2]],
        [[0,1],[0,2],[-1, 2]],
        [[-1,0],[-2,0],[ 0, 1]],
        [[-1,0],[-2,0],[ 0,-1]],
        [[-1,0],[-2,0],[-2, 1]],
        [[-1,0],[-2,0],[-2,-1]],
        [[0,-1],[0,-2],[ 1, 0]],
        [[0,-1],[0,-2],[-1, 0]],
        [[0,-1],[0,-2],[ 1,-2]],
        [[0,-1],[0,-2],[-1,-2]],
    ]
    let valids = [Plains.AIR,Plains.ADJACENT]
  
    if (valids.includes(matrix.get(r,c))) {
      for (let dir of directions) {
          let d1 = dir[0];
          let d2 = dir[1];
          let d3 = dir[2];
          
        if (d1[0] >= 0 && d1[0] < matrix.maxI() &&
            d2[0] >= 0 && d2[0] < matrix.maxI() &&
            d3[0] >= 0 && d3[0] < matrix.maxI() &&
            d1[1] >= 0 && d1[1] < matrix.maxJ() &&
            d2[1] >= 0 && d2[1] < matrix.maxJ() &&
            d3[1] >= 0 && d3[1] < matrix.maxJ() &&
            valids.includes(matrix.get(r,c)) &&
            valids.includes(matrix.get(r+d1[0],c+d1[1])) &&
            valids.includes(matrix.get(r+d2[0],c+d2[1])) &&
            valids.includes(matrix.get(r+d3[0],c+d3[1]))
        ) { 
          LShapes.push([d1,d2,d3]);

            cell_l_found.set(r,c,1)
            cell_l_found.set(r+d1[0],c+d1[1],1)
            cell_l_found.set(r+d2[0],c+d2[1],1)
            cell_l_found.set(r+d3[0],c+d3[1],1)
        }
      }
    }

  //segnare i trovati nella matrice
    for(dir in LShapes){}
    
    // cell_l_found[r]

    return LShapes;
  }

/** scrapes a first set of blocks is the areas is too small to be used */ 
function disableInvalidAreas(data_layers) {
    let plain=data_layers.plain, areaPlains=data_layers.areaPlains
    let invalids=[],cell_l_found = new Matrix2D
    
    for (area in data_layers.counter) {
        if(data_layers.counter[area] < 4) {
            invalids.push(parseInt(area))
        }
    }

    // Removes the small areas
    plain.loop((i)=>{
        if (invalids.includes(data_layers.areas.get(i.i,i.j))) {
            plain.SET(Plains.BLOCKED)
        }
    })
    
    // Removes the area that do not contain an l shape
    let Lshapes, valid
    for (area in areaPlains){
        if (!(invalids.includes(parseInt(area)))){
            valid = false
            for (i in areaPlains[area]) {
                let ii = parseInt(areaPlains[area][i][0])
                let jj = parseInt(areaPlains[area][i][1])
                // looks for l shapes in each area
                if (cell_l_found.get(ii,jj) === undefined) {
                    Lshapes = findLShapes(plain,ii,jj,cell_l_found)
                    if (Lshapes.length > 0)
                        valid = true
                }
            }
            if (!valid) {
                for (i in areaPlains[area]) {
                    let ii = parseInt(areaPlains[area][i][0])
                    let jj = parseInt(areaPlains[area][i][1])
                    plain.set(ii,jj, Plains.BLOCKED)
                }
            }
        }
    }
}

/**
 * finds all the areas made of adjacent blocks that are adjacents to eachother
 */
function findSubAreas(data_layers) {
    let plain = data_layers.plain
    let i,j,area = 0
    let check, toCheck = []
    let areas=new Matrix2D(),counter={},areaPlains={}
 
    // loops until the whole plain has been mapped
    plain.loop((ii)=>{
        if (areas.get(ii.i,ii.j) === undefined && toCheck.indexOf(ii.i+' '+ii.j) === -1) {
            
            if (plain.GET() != Plains.ADJACENT) {
                areas.set(ii.i,ii.j, 0)
            }
            else {
                area++
                toCheck.push(ii.i+' '+ii.j)
                // loops until the whole area has been mapped
                do {
                    // i for horizontal movement
                    // J for vertical movement
                    check = toCheck.shift()
                    check = check.split(' ')
                    i = parseInt(check[0])
                    j = parseInt(check[1])
                    
                    // skip if already checked
                    if (areas.get(i,j) === undefined) {
                        //checks if the cell can belong to the area
                        if ([Plains.ADJACENT].includes(plain.get(i,j))) {
                            areas.set(i,j, area)
                            
                            if (counter[area]===undefined) counter[area]=0
                            counter[area]++
                            
                            if (areaPlains[area] === undefined)areaPlains[area]=[]
                            areaPlains[area].push([i,j])
                            // puts the neighbouring cells in the list to check
                            if (i<plain.maxI() && areas.get(i+1,j) === undefined && toCheck.indexOf((i+1)+' '+j) === -1)
                                toCheck.push((i+1)+' '+j)
                            if (j<plain.maxJ() && areas.get(i,j+1) === undefined && toCheck.indexOf(i+' '+(j+1)) === -1)
                                toCheck.push(i+' '+(j+1))
                            if (i>0 && areas.get(i-1,j) === undefined && toCheck.indexOf((i-1)+' '+j) === -1)
                                toCheck.push((i-1)+' '+j)
                            if (j>0 && areas.get(i,j-1) === undefined && toCheck.indexOf(i+' '+(j-1)) === -1)
                                toCheck.push(i+' '+(j-1))
                        }
                        else {
                            areas.set(i,j, 0)                
                        }
                    }
                } while (toCheck.length > 0)
            }
        }
    })
    data_layers.support.areas = areas
    data_layers.support.counter = counter
    data_layers.support.areaPlains = areaPlains
}

function findSupportBlockLocations(data_layers) {
    let p = data_layers.plain
    let a = data_layers.support.areas
    
    
    // list of blocks that connect to adjacents[area of the adjacent that connects][coordinates of the area]
    let supports = {}
    p.loop((i)=>{

        if (p.GET() == Plains.AIR) {
            p.checkAdjacents((value, iAjd)=>{
                if (value == Plains.ADJACENT) {
                    if (supports[i.i+' '+i.j] === undefined)            
                        supports[i.i+' '+i.j]={}
                    if (supports[i.i+' '+i.j][a.get(iAjd.i,iAjd.j)] == undefined)    
                        supports[i.i+' '+i.j][a.get(iAjd.i,iAjd.j)] = []
                    supports[i.i+' '+i.j][a.get(iAjd.i,iAjd.j)].push(iAjd)
                }
            })
        }
    })
    data_layers.support.available = supports
}

function addSupportBlocksFromList(data_layers) {
    let availables = data_layers.support.available
    let sets,setsCoords, areasToBind, areaLead, areasToMerge,coordsMain,i,j
    do {
        // finds the sets of support with the most neighborhood
        sets={}
        setsCoords={}
        for (coords in availables) {
            if (sets[Object.keys(availables[coords]).length] === undefined) sets[Object.keys(availables[coords]).length]=[]
            if (setsCoords[Object.keys(availables[coords]).length] === undefined) setsCoords[Object.keys(availables[coords]).length]=[]
            sets[Object.keys(availables[coords]).length].push(availables[coords])
            setsCoords[Object.keys(availables[coords]).length].push(coords)
        }

        // takes the first one
        areasToBind = sets[4]?.length > 0 ? sets[4].shift() : (sets[3]?.length > 0 ? sets[3].shift() : sets[2].shift())
        coordsMain = setsCoords[4]?.length > 0 ? setsCoords[4].shift() : (setsCoords[3]?.length > 0 ? setsCoords[3].shift() : setsCoords[2].shift())

        // adds the support block and merge the neighboors
        coordsMain = coordsMain.split(' ')
        i = parseInt(coordsMain[0])
        j = parseInt(coordsMain[1])
        data_layers.plain.set(i,j,Plains.SUPPORT)
        
        areaLead = Object.keys(areasToBind)[0]
        areasToMerge = Object.keys(areasToBind).filter(x => ![areaLead].includes(x))
        for (coords in availables) {
            for (let i in areasToMerge) {
                if (availables[coords][areasToMerge[i]] !== undefined) {
                    if (availables[coords][areaLead] === undefined) availables[coords][areaLead]=[] 
                    availables[coords][areaLead] = availables[coords][areaLead].concat(availables[coords][areasToMerge[i]])
                    delete availables[coords][areasToMerge[i]]
                }
            }
        }

        // removes all groups that have 1 neighboor
        for (coords in availables) { 
            if (Object.keys(availables[coords]).length === 1)
                delete availables[coords]
        }


    } while(Object.keys(availables).length > 0)
    a=1
}

/**
 * Tries to find the optimal solution of support blocks to add to the blueprint so that all sticky blocks are connected
 */
function addSupportBlocks(data_layers) {
    data_layers.support = {}
    // find all subareas given the actual plain configuration
    findSubAreas(data_layers)
    // find the blocks neighboors to multiple areas
    findSupportBlockLocations(data_layers)
    // checks all the proposed support blocks, starting from the ones with the highest amount of different neighboors
    addSupportBlocksFromList(data_layers)
}
