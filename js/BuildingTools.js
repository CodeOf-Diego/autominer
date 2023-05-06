  
/**
 * Receives the 3D structure of the amethist vein and compresses the given axis,
 *  returning a plain consisting of the other 2
 * @param array vein
 * @param string axis  to compress 
 */
function generatePlain(vein, axis) {
    let i={x:0,y:0,z:0}
    let ppd = perpendicular(axis)
   
    let plain = new Matrix2D()
    for (i.x=0;i.x<vein.length;i.x++) {
        for (i.y=0;i.y<vein[i.x].length;i.y++) {
            for (i.z=0;i.z<vein[i.x][i.y].length;i.z++) {
                if (plain.get(i[ppd[0]],i[ppd[1]]) != Plains.AMETHIST) {
                    plain.set(i[ppd[0]],i[ppd[1]], vein[i.x][i.y][i.z]==Voxels.AMETHIST?Plains.AMETHIST:Plains.AIR)
                }
                
                if (vein[i.x][i.y][i.z] == Voxels.AMETHIST && d!==false) {
                    d.plainAdjacents[axis]++
                
                    if ((i.x > 0 && vein[i.x-1][i.y][i.z] == Voxels.AMETHIST) ||
                    (i.y > 0 && vein[i.x][i.y-1][i.z] == Voxels.AMETHIST) ||
                    (i.z > 0 && vein[i.x][i.y][i.z-1] == Voxels.AMETHIST)) {
                        d.adjacentFaces+=2
                    }
                }
            }
        }    
    }
    return plain
}

/**
 * Looks for amethist in the 2D plain passed and extracts the neighbouring cells
 * chatGPT + me
 * @param {Matrix2D} plain 
 * @returns 
 */
function findAdjacents(plain) {
    for (let i = 0; i < plain.maxI()+1; i++) {
      for (let j = 0; j < plain.maxJ()+1; j++) {      
        if ([plain.L(i,j),plain.R(i,j),plain.U(i,j),plain.D(i,j)].includes(Plains.AMETHIST) && plain.get(i,j)==Plains.AIR)
            plain.set(i,j, Plains.ADJACENT)
      }
    }
}


function findDistinctAreas(plain) {
    let i,j,area = 0
    let check, toCheck = []
    let checked = new Matrix2D(), areas=new Matrix2D(),counter={},areaPlains={}
 
    // loops until the whole plain has been mapped
    for (let ii=0; ii<plain.maxI();ii++) {
        for (let jj=0; jj<plain.maxJ();jj++) {
            if (checked.get(ii,jj) === undefined && toCheck.indexOf(ii+' '+jj) === -1) {
                
                if (plain.get(ii,jj) == Plains.AMETHIST) {
                    checked.set(ii,jj, Plains.area_AMETHIST)
                    areas.set(ii,jj, 0)
                }
                else {
                    area++
                    if (area==5){
                        dd=1
                    }
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
                                if(area>1)
                                dd=1
                                checked.set(i,j, Plains.area_AMETHIST)
                                areas.set(i,j, 0)                
                            }
                        }
                        
                    } while (toCheck.length > 0)
                }
            }
        }
    }
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
    let invalids=[],cell_l_found
    
    for (area in counter) {
        if(counter[area] < 4) {
            invalids.push(parseInt(area))
        }
    }

    // Removes the small areas
    for (let i=0;i<plain.maxI();i++) {
        for (let j=0;j<plain.maxJ();j++) {
            if (invalids.includes(areas.get(i,j))){
                plain.set(i,j, Plains.BLOCKED)
            }
        }
    }

    // Removes the area that do not contain an l shape

    // for (area in areaPlains){
    //     for (i in areaPlains[area]) {
    //         for (j in areaPlains[area][i]) {
    //             if (!invalids.includes(area)){
    //                 console.log('sss'+findLShapes(plain,i,j,cell_l_found))
    //             }
    //         }
    //     }
    // }
}





/* Temporary prints of the steps in building the sides */
function placeholderSide(vein, adjacentPlain, axis) {
let matrix = new Matrix3D(),id={},offset=2
let offsets ={
    x: axis=='x'?offset:0,
        y: axis=='y'?offset:0,
        z: axis=='z'?offset:0
}
let ppd = perpendicular(axis)


let maxL = {
    x: vein.length,
    y: vein[0].length,
    z: vein[0][0].length}

let initial = {
    x: axis=='x'?maxL.x:0,
    y: axis=='y'?maxL.y:0,
    z: axis=='z'?maxL.z:0,
}

for (id.x=initial.x;id.x<maxL.x+offsets.x;id.x++) {
    for (id.y=initial.y;id.y<maxL.y+offsets.y;id.y++) {
        for (id.z=initial.z;id.z<maxL.z+offsets.z;id.z++) {
            

            if (id[axis]==maxL[axis]+offset-1 && adjacentPlain.get(id[ppd[0]],id[ppd[1]]) == Plains.ADJACENT) {
                matrix.set(id.x,id.y,id.z, Voxels.HONEY_BLOCK)
            }
            else {
                matrix.set(id.x,id.y,id.z, Voxels.AIR)
            }
        }
    }
}

return matrix
}

