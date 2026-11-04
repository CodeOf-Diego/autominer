  
/**
 * Receives the 3D structure of the amethist vein and compresses the given axis,
 *  returning a plain consisting of the other 2
 * @param array vein
 * @param string axis  to compress 
 */
function generatePlain(vein, axis) {
    let ppd = perpendicular(axis)
   
    let plain = new Matrix2D()
    plain.axis = axis
    vein.loop((i)=>{
        if (plain.get(i[ppd[0]],i[ppd[1]]) != Plains.AMETHIST) {
            plain.set(i[ppd[0]],i[ppd[1]], vein.GET()==Voxels.AMETHIST?Plains.AMETHIST:Plains.AIR)
        }
        
        if (vein.GET() == Voxels.AMETHIST && d!==false) {
            if (vein.XP() == Voxels.AMETHIST || vein.YP() == Voxels.AMETHIST || vein.ZP() == Voxels.AMETHIST) {
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
        if ([plain.IP(),plain.IN(),plain.JP(),plain.JN()].includes(Plains.AMETHIST) && plain.GET()==Plains.AIR) {
            plain.SET(Plains.ADJACENT)
            d.plainAdjacents[plain.axis]++
        }
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
          
        if (r+d1[0] >= 0 && r+d1[0] < matrix.maxI() &&
            r+d2[0] >= 0 && r+d2[0] < matrix.maxI() &&
            r+d3[0] >= 0 && r+d3[0] < matrix.maxI() &&
            c+d1[1] >= 0 && c+d1[1] < matrix.maxJ() &&
            c+d2[1] >= 0 && c+d2[1] < matrix.maxJ() &&
            c+d3[1] >= 0 && c+d3[1] < matrix.maxJ() &&
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

/** A sticky piston can only push this many blocks in a row in Minecraft */
const MAX_PISTON_PUSH = 12
/** How many randomized attempts to try before keeping the best one found */
const GROUPING_TRIALS = 40

/**
 * Multi-source BFS from every cell of area A, through AIR cells only (cost 1 each), to find
 * the shortest bridge distance (and the actual chain of air cells) from A to every other area
 * reachable without crossing amethyst/blocked cells. Reaching another area's own cell costs
 * nothing extra - only the air cells in between need to become slime/honey.
 * Returns { distances: {A: {B: dist}}, paths: {A: {B: [[i,j],...]}} } for every area A.
 */
function computeAreaDistances(data_layers) {
    let plain = data_layers.plain
    let areas = data_layers.support.areas
    let areaIds = Object.keys(data_layers.support.counter)

    let distances = {}, paths = {}
    for (let A of areaIds) {
        distances[A] = {}
        paths[A] = {}
        let dist = {}, prev = {}
        let queue = []
        plain.loop((p) => {
            if (areas.get(p.i,p.j) == A) {
                let key = p.i+','+p.j
                dist[key] = 0
                queue.push([p.i,p.j])
            }
        })
        let seen = new Set(queue.map(([i,j]) => i+','+j))
        let qi = 0
        while (qi < queue.length) {
            let [ci,cj] = queue[qi++]
            let d = dist[ci+','+cj]
            for (let [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                let ni = ci+di, nj = cj+dj
                if (ni < 0 || ni >= plain.maxI() || nj < 0 || nj >= plain.maxJ()) continue
                let nkey = ni+','+nj
                if (seen.has(nkey)) continue
                let cell = plain.get(ni,nj)
                if (cell == Plains.AIR) {
                    seen.add(nkey)
                    dist[nkey] = d+1
                    prev[nkey] = ci+','+cj
                    queue.push([ni,nj])
                } else if (cell == Plains.ADJACENT) {
                    let B = areas.get(ni,nj)
                    if (B != A && distances[A][B] === undefined) {
                        distances[A][B] = d
                        let path = [], curKey = ci+','+cj
                        while (dist[curKey] > 0) {
                            let [pi,pj] = curKey.split(',').map(Number)
                            path.unshift([pi,pj])
                            curKey = prev[curKey]
                        }
                        paths[A][B] = path
                    }
                    seen.add(nkey)
                }
                // AMETHIST/BLOCKED: impassable, left unvisited
            }
        }
    }
    return {distances, paths}
}

/**
 * Builds a minimum spanning forest over the areas, using computeAreaDistances()'s shortest
 * bridge distances as edge weights (the standard "metric closure MST" 2-approximation for
 * Steiner trees). Areas that can't reach each other at all (cut off by amethyst/blocked cells)
 * end up in separate trees. Ties are broken randomly so repeated calls can explore different
 * (equally cheap) spanning structures.
 */
function buildMSTForest(areaIds, distances, rng) {
    let remaining = new Set(areaIds)
    let edges = []
    while (remaining.size > 0) {
        let start = remaining.values().next().value
        let inTree = new Set([start])
        remaining.delete(start)
        let grew = true
        while (grew) {
            grew = false
            let best = null
            for (let A of inTree) {
                for (let B in distances[A]) {
                    if (inTree.has(B)) continue
                    let dist = distances[A][B]
                    if (best === null || dist < best.dist || (dist === best.dist && rng() < 0.5)) best = {A, B, dist}
                }
            }
            if (best !== null) {
                inTree.add(best.B)
                remaining.delete(best.B)
                edges.push(best)
                grew = true
            }
        }
    }
    return edges
}

/**
 * Turns the area MST into an explicit tree graph: one node per area (weight = its size) plus
 * one node per air cell used as a bridge along an MST edge (weight 1 each), chained together in
 * the order the shortest path crosses them. Node ids: 'area:<id>' / 'cell:<i>,<j>'.
 */
function buildTreeAdjacency(areaIds, counter, mstEdges, paths) {
    let nodeWeight = {}, adj = {}
    function addNode(id, w) { if (nodeWeight[id] === undefined) { nodeWeight[id] = w; adj[id] = [] } }
    function addEdge(a, b) { adj[a].push(b); adj[b].push(a) }

    for (let A of areaIds) addNode('area:'+A, counter[A])
    for (let {A, B} of mstEdges) {
        let prevNode = 'area:'+A
        for (let [i,j] of paths[A][B]) {
            let cellId = 'cell:'+i+','+j
            addNode(cellId, 1)
            addEdge(prevNode, cellId)
            prevNode = cellId
        }
        addEdge(prevNode, 'area:'+B)
    }
    return {nodeWeight, adj}
}

/**
 * Partitions every tree in the forest into the minimum number of connected pieces with total
 * weight <= cap. Classic greedy post-order DFS: a node accumulates its own weight, then tries
 * to merge each child's already-resolved subtree (processed smallest-first, which is optimal
 * for maximizing how many fit) - whatever doesn't fit is finalized as its own piece. This is
 * the exact/optimal solution for this specific problem on a tree (not just a heuristic).
 */
function partitionForest(nodeWeight, adj, cap) {
    let visited = new Set()
    let pieces = []

    function dfs(node, parent) {
        visited.add(node)
        let nodes = [node]
        let rolled = nodeWeight[node]
        let childResults = []
        for (let neighbor of adj[node]) {
            if (neighbor === parent || visited.has(neighbor)) continue
            childResults.push(dfs(neighbor, node))
        }
        childResults.sort((a,b) => a.size - b.size)
        for (let child of childResults) {
            if (rolled + child.size <= cap) {
                rolled += child.size
                nodes = nodes.concat(child.nodes)
            } else {
                pieces.push(child)
            }
        }
        return {nodes, size: rolled}
    }

    for (let id in nodeWeight) {
        if (visited.has(id)) continue
        pieces.push(dfs(id, null))
    }
    return pieces
}

/**
 * Builds a Steiner-tree-approximated connection structure over the raw confini sub-areas (BFS
 * shortest bridge paths + MST, see computeAreaDistances/buildMSTForest), then optimally
 * partitions it into the fewest groups <= MAX_PISTON_PUSH each (partitionForest). This replaces
 * a single-bridge-only greedy: a chain of several air cells can now connect two areas that
 * aren't directly touching, as long as paying for that chain is still worth it.
 */
function simulateGrouping(data_layers, rng, areaDistances) {
    let areaIds = Object.keys(data_layers.support.counter)
    let mstEdges = buildMSTForest(areaIds, areaDistances.distances, rng)
    let {nodeWeight, adj} = buildTreeAdjacency(areaIds, data_layers.support.counter, mstEdges, areaDistances.paths)
    let pieces = partitionForest(nodeWeight, adj, MAX_PISTON_PUSH)

    let sizes = {}, finalGroup = {}, supportGroup = {}
    for (let piece of pieces) {
        // the first area node encountered names the group, matching the old "areaLead" convention
        let leadArea = null
        for (let id of piece.nodes) if (id.startsWith('area:')) { leadArea = id.slice(5); break }
        sizes[leadArea] = piece.size
        for (let id of piece.nodes) {
            if (id.startsWith('area:')) {
                finalGroup[id.slice(5)] = leadArea
            } else {
                let coords = id.slice(5).replace(',', ' ')
                supportGroup[coords] = leadArea
            }
        }
    }
    return {sizes, finalGroup, supportGroup}
}

/**
 * Scores one simulateGrouping() result: counts the final groups, and checks whether the
 * groups that end up physically touching (which can only happen through a placed support
 * block, since two different raw sub-areas are never touching before merging) can be
 * 2-colored slime/honey. In Minecraft, slime sticks to slime and honey sticks to honey, but
 * slime and honey don't stick to each other - so two touching groups MUST use different
 * materials, or they'd get dragged together as one oversized group when a piston fires.
 * If 3+ groups end up mutually touching (an odd cycle), no 2-coloring exists.
 */
function evaluateGrouping(data_layers, result) {
    let plain = data_layers.plain
    let areas = data_layers.support.areas
    let cellToGroup = {}
    plain.loop((p) => {
        if (plain.get(p.i,p.j) == Plains.ADJACENT)
            cellToGroup[p.i+' '+p.j] = result.finalGroup[areas.get(p.i,p.j)]
    })
    for (let coords in result.supportGroup) {
        cellToGroup[coords] = result.finalGroup[result.supportGroup[coords]]
    }

    let adjList = {}
    for (let key in cellToGroup) {
        let [i,j] = key.split(' ').map(Number)
        let g = cellToGroup[key]
        if (adjList[g] === undefined) adjList[g] = new Set()
        for (let [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            let otherG = cellToGroup[(i+di)+' '+(j+dj)]
            if (otherG !== undefined && otherG !== g) adjList[g].add(otherG)
        }
    }

    let color = {}, bipartite = true, conflictPairs = []
    for (let g in adjList) {
        if (color[g] !== undefined) continue
        color[g] = 0
        let queue = [g]
        while (queue.length) {
            let cur = queue.shift()
            for (let n of adjList[cur]) {
                if (color[n] === undefined) { color[n] = 1 - color[cur]; queue.push(n) }
                else if (color[n] === color[cur]) { bipartite = false; conflictPairs.push([cur, n]) }
            }
        }
    }

    return {bipartite, color, conflictPairs, groupCount: Object.keys(result.sizes).length}
}

/**
 * Tries GROUPING_TRIALS randomized merge attempts and keeps the best: a slime/honey
 * colorable (bipartite) result with the fewest final groups wins, since each group needs
 * its own piston machine. If no attempt comes out colorable, the least-bad one is kept and
 * the conflicting groups are reported - that geometry genuinely can't be built with just
 * two sticky materials and needs a different solution (a physical gap, or separate timing).
 *
 * Note: a single raw sub-area that is already bigger than MAX_PISTON_PUSH on its own
 * (before any merging) is NOT split here - it's left oversized and reported in
 * data_layers.support.oversizedAreas. Splitting an oversized contiguous area into
 * multiple <=12 chunks is a separate problem, not yet implemented.
 */
function addSupportBlocksFromList(data_layers, rng) {
    // distances don't depend on rng - computed once and reused across all trials
    let areaDistances = computeAreaDistances(data_layers)

    let best = null
    for (let trial = 0; trial < GROUPING_TRIALS; trial++) {
        let result = simulateGrouping(data_layers, rng, areaDistances)
        let evaluation = evaluateGrouping(data_layers, result)
        if (best === null ||
            (evaluation.bipartite && !best.evaluation.bipartite) ||
            (evaluation.bipartite === best.evaluation.bipartite && evaluation.groupCount < best.evaluation.groupCount)) {
            best = {result, evaluation}
        }
    }

    for (let coords in best.result.supportGroup) {
        let [i,j] = coords.split(' ').map(Number)
        data_layers.plain.set(i,j,Plains.SUPPORT)
        if (d !== false)
            d.plainSupports[data_layers.plain.axis]++
    }

    data_layers.support.groupSizes = best.result.sizes
    data_layers.support.finalGroup = best.result.finalGroup
    data_layers.support.supportGroup = best.result.supportGroup
    data_layers.support.groupMaterial = best.evaluation.color // {groupId: 0|1} -> slime/honey
    data_layers.support.bipartite = best.evaluation.bipartite
    data_layers.support.touchingConflicts = best.evaluation.conflictPairs
    data_layers.support.oversizedAreas = Object.keys(best.result.sizes).filter(area => best.result.sizes[area] > MAX_PISTON_PUSH)

    if (data_layers.support.oversizedAreas.length > 0) {
        console.warn('axis ' + data_layers.plain.axis + ': area(s) over the ' + MAX_PISTON_PUSH + '-block piston limit were not split:', data_layers.support.oversizedAreas)
    }
    if (!best.evaluation.bipartite) {
        console.warn('axis ' + data_layers.plain.axis + ': no slime/honey-colorable grouping found in ' + GROUPING_TRIALS + ' attempts - 3+ groups mutually touch. Conflicting pairs:', best.evaluation.conflictPairs)
    }
}

/**
 * Computes the centroid (average i,j) of every final group's cells in the plain, and assigns
 * each group a clean 0-based index in ascending area-id order - so a group can be referred to
 * as "group 0" / "group 5" and consistently mean the same one across renders of this result.
 * Returns [{index, i, j}, ...], one entry per final group.
 */
function computeGroupLabels(data_layers) {
    let plain = data_layers.plain
    let areas = data_layers.support.areas
    let finalGroup = data_layers.support.finalGroup
    let supportGroup = data_layers.support.supportGroup
    let sums = {} // {finalGroupId: {i, j, n}}
    plain.loop((p) => {
        let cell = plain.get(p.i,p.j)
        let group = null
        if (cell == Plains.ADJACENT) group = finalGroup[areas.get(p.i,p.j)]
        else if (cell == Plains.SUPPORT) group = finalGroup[supportGroup[p.i+' '+p.j]]
        if (group !== null) {
            if (sums[group] === undefined) sums[group] = {i:0, j:0, n:0}
            sums[group].i += p.i
            sums[group].j += p.j
            sums[group].n++
        }
    })
    return Object.keys(sums).sort((a,b) => Number(a)-Number(b)).map((groupId, index) => ({
        index,
        i: sums[groupId].i / sums[groupId].n,
        j: sums[groupId].j / sums[groupId].n,
    }))
}

/**
 * Builds a plain where every ADJACENT/SUPPORT cell holds its final group id (offset by
 * GROUP_ID_OFFSET so it never collides with a Voxels/Plains value), for per-group coloring.
 */
const GROUP_ID_OFFSET = 1000
function buildGroupPlain(data_layers) {
    let plain = data_layers.plain
    let areas = data_layers.support.areas
    let finalGroup = data_layers.support.finalGroup
    let supportGroup = data_layers.support.supportGroup
    let groupPlain = new Matrix2D()
    plain.loop((i) => {
        let cell = plain.get(i.i,i.j)
        let value = undefined
        if (cell == Plains.ADJACENT) {
            value = GROUP_ID_OFFSET + parseInt(finalGroup[areas.get(i.i,i.j)])
        }
        else if (cell == Plains.SUPPORT) {
            value = GROUP_ID_OFFSET + parseInt(finalGroup[supportGroup[i.i+' '+i.j]])
        }
        // always .set(), even to undefined, so groupPlain keeps the same dimensions as plain
        groupPlain.set(i.i,i.j, value)
    })
    return groupPlain
}

/**
 * Builds a plain where every ADJACENT/SUPPORT cell holds its material (slime/honey, offset by
 * MATERIAL_ID_OFFSET) instead of its individual group id - the 2-color view of the same final
 * grouping, showing which cells can physically touch each other without sticking together.
 */
const MATERIAL_ID_OFFSET = 2000
function buildMaterialPlain(data_layers) {
    let plain = data_layers.plain
    let areas = data_layers.support.areas
    let finalGroup = data_layers.support.finalGroup
    let supportGroup = data_layers.support.supportGroup
    let groupMaterial = data_layers.support.groupMaterial
    let materialPlain = new Matrix2D()
    plain.loop((i) => {
        let cell = plain.get(i.i,i.j)
        let value = undefined
        if (cell == Plains.ADJACENT) {
            value = MATERIAL_ID_OFFSET + groupMaterial[finalGroup[areas.get(i.i,i.j)]]
        }
        else if (cell == Plains.SUPPORT) {
            value = MATERIAL_ID_OFFSET + groupMaterial[finalGroup[supportGroup[i.i+' '+i.j]]]
        }
        materialPlain.set(i.i,i.j, value)
    })
    return materialPlain
}

/**
 * Tries to find the optimal solution of support blocks to add to the blueprint so that all sticky blocks are connected
 */
function addSupportBlocks(data_layers, rng) {
    data_layers.support = {}
    // find all subareas given the actual plain configuration
    findSubAreas(data_layers)
    // builds a Steiner-tree-approximated connection and partitions it into capacity-bound groups
    addSupportBlocksFromList(data_layers, rng)
}
