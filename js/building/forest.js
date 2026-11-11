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
