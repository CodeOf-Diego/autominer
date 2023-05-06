  
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
        if ([plain.L(),plain.R(),plain.U(),plain.D()].includes(Plains.AMETHIST) && plain.GET()==Plains.AIR)
            plain.SET(Plains.ADJACENT)
    })
}

/**
 * 
 * @param {Matrix2D} plain 
 * @returns 
 */
function findDistinctAreas(plain) {
    let i,j,area = 0
    let check, toCheck = []
    let checked = new Matrix2D(), areas=new Matrix2D(),counter={},areaPlains={}
 
    // loops until the whole plain has been mapped
    plain.loop((ii,jj)=>{
        if (checked.get(ii,jj) === undefined && toCheck.indexOf(ii+' '+jj) === -1) {
            
            if (plain.get(ii,jj) == Plains.AMETHIST) {
                checked.set(ii,jj, Plains.area_AMETHIST)
                areas.set(ii,jj, 0)
            }
            else {
                area++
                toCheck.push(ii+' '+jj)
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
    return [plain, checked, areas, counter, areaPlains]
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
    let plain=data_layers[0],checked=data_layers[1], areas=data_layers[2],counter=data_layers[3],areaPlains=data_layers[4]
    let invalids=[],cell_l_found = new Matrix2D
    
    for (area in counter) {
        if(counter[area] < 4) {
            invalids.push(parseInt(area))
        }
    }

    // Removes the small areas
    plain.loop((i,j)=>{
        if (invalids.includes(areas.get(i,j))) {
            plain.set(i,j, Plains.BLOCKED)
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
                    console.log('area '+area+' '+Lshapes)
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
    aaa=1
}

