/**
 * Tries GROUPING_TRIALS randomized merge attempts and keeps the best: a slime/honey
 * colorable (bipartite) result with the fewest final groups wins, since each group needs
 * its own piston machine. If no attempt comes out colorable, the least-bad one is kept and
 * the conflicting groups are reported - that geometry genuinely can't be built with just
 * two sticky materials and needs a different solution (a physical gap, or separate timing).
 *
 * Note: sub-areas bigger than MAX_PISTON_PUSH were already cut by splitOversizedAreas(); the
 * pieces of one area touch each other (distance 0 here). Anything still over the cap (a single
 * BFS layer wider than it) is reported in data_layers.support.oversizedAreas.
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
 * Tries to find the optimal solution of support blocks to add to the blueprint so that all sticky blocks are connected
 */
function addSupportBlocks(data_layers, rng) {
    data_layers.support = {}
    // find all subareas given the actual plain configuration
    findSubAreas(data_layers)
    // cuts sub-areas bigger than the piston limit into pieces the grouping can work with
    splitOversizedAreas(data_layers)
    // builds a Steiner-tree-approximated connection and partitions it into capacity-bound groups
    addSupportBlocksFromList(data_layers, rng)
}
