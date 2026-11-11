/** A sticky piston can only push this many blocks in a row in Minecraft */
const MAX_PISTON_PUSH = 12

/**
 * Splits every sub-area bigger than MAX_PISTON_PUSH into connected pieces <= the cap, so the
 * grouping step (which can only cut BETWEEN areas, never inside one) gets pieces it can use.
 *
 * Cut in "bands": BFS distance layers from one end of the area (the cell farthest from an
 * arbitrary one), consecutive layers are joined while every connected piece of the band stays
 * <= cap. Grid neighbours are at most one BFS layer apart, so a band only touches the band
 * before and after it, and pieces of the same band never touch each other - alternating
 * slime/honey by band parity always works inside the area. Not always the minimum number of
 * pieces; the small leftovers touch their neighbours at distance 0, so the MST/partition step
 * can still merge them into other groups.
 * Updates data_layers.support.areas/counter/areaPlains in place: the first piece keeps the old
 * id, the others get new ids. Deterministic (no rng).
 */
function splitOversizedAreas(data_layers, cap = MAX_PISTON_PUSH) {
    let support = data_layers.support
    let key = (i,j) => i+','+j
    let dirs = [[1,0],[-1,0],[0,1],[0,-1]]

    // BFS distances from start, moving only through the cells in `cells` (a Set of keys)
    function bfs(cells, start) {
        let dist = new Map([[start, 0]]), queue = [start], qi = 0
        while (qi < queue.length) {
            let cur = queue[qi++]
            let [i,j] = cur.split(',').map(Number)
            for (let [di,dj] of dirs) {
                let n = key(i+di, j+dj)
                if (cells.has(n) && !dist.has(n)) { dist.set(n, dist.get(cur)+1); queue.push(n) }
            }
        }
        return dist
    }
    // connected components of a Set of cell keys
    function components(cells) {
        let seen = new Set(), out = []
        for (let c of cells) {
            if (seen.has(c)) continue
            let comp = [], stack = [c]
            seen.add(c)
            while (stack.length) {
                let cur = stack.pop()
                comp.push(cur)
                let [i,j] = cur.split(',').map(Number)
                for (let [di,dj] of dirs) {
                    let n = key(i+di, j+dj)
                    if (cells.has(n) && !seen.has(n)) { seen.add(n); stack.push(n) }
                }
            }
            out.push(comp)
        }
        return out
    }

    let nextId = Math.max(0, ...Object.keys(support.counter).map(Number)) + 1
    support.splitAreas = {}
    for (let area of Object.keys(support.counter)) {
        if (support.counter[area] <= cap) continue
        let cells = new Set(support.areaPlains[area].map(([i,j]) => key(i,j)))

        // one end of the area: the farthest cell from an arbitrary one (double sweep)
        let fromAny = bfs(cells, cells.values().next().value)
        let end = [...fromAny.entries()].reduce((a,b) => b[1] > a[1] ? b : a)[0]
        let dist = bfs(cells, end)
        let layers = []
        for (let [c, d] of dist) (layers[d] = layers[d] || []).push(c)

        let bands = [], current = []
        for (let layer of layers) {
            let grown = current.concat(layer)
            if (current.length > 0 && components(new Set(grown)).some(p => p.length > cap)) {
                bands.push(current)
                current = layer.slice()
            } else {
                current = grown
            }
        }
        bands.push(current)

        let pieces = []
        bands.forEach((band, bandIndex) => components(new Set(band)).forEach(p => pieces.push({bandIndex, cells: p})))
        // a single BFS layer wider than the cap can't be cut this way - left oversized (reported later)
        let ids = []
        pieces.forEach((piece, n) => {
            let id = n === 0 ? Number(area) : nextId++
            ids.push(id)
            support.counter[id] = piece.cells.length
            support.areaPlains[id] = piece.cells.map(c => c.split(',').map(Number))
            for (let [i,j] of support.areaPlains[id]) support.areas.set(i,j,id)
        })
        support.splitAreas[area] = ids
    }
}
