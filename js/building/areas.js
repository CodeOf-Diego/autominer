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
                            if (i<plain.maxI()-1 && checked.get(i+1,j) === undefined && toCheck.indexOf((i+1)+' '+j) === -1)
                                toCheck.push((i+1)+' '+j)
                            if (j<plain.maxJ()-1 && checked.get(i,j+1) === undefined && toCheck.indexOf(i+' '+(j+1)) === -1)
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
                            if (i<plain.maxI()-1 && areas.get(i+1,j) === undefined && toCheck.indexOf((i+1)+' '+j) === -1)
                                toCheck.push((i+1)+' '+j)
                            if (j<plain.maxJ()-1 && areas.get(i,j+1) === undefined && toCheck.indexOf(i+' '+(j+1)) === -1)
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
