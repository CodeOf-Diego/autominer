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
