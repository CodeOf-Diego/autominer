/**
 * Builds a Steiner-tree-approximated connection structure over the raw border sub-areas (BFS
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
 * groups that end up physically touching (through a placed support block, or directly when
 * they hold pieces of the same area cut by splitOversizedAreas) can be
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
