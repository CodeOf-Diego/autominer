

function perpendicular(axis) {
    return {
        x:['y','z'],
        y:['x','z'],
        z:['x','y']
    }[axis]
}

/**
 * Deterministic PRNG (mulberry32): same seed always produces the same sequence of calls.
 * Used instead of Math.random() wherever a run needs to be reproducible from a single seed.
 */
function makePRNG(seed) {
    seed = seed >>> 0
    return function() {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** Generates a matrix representing a random vein with default attributes */
function generateRandomVein(seed) {
    let rng = makePRNG(seed)
    let ores = 0

    let rad = 5.5
    let max = (rad*2)+4
    let mid = max/2
    let range = 2.3
    let density = 0.05

    let x,y,z
    let vein = []
    for (x=0;x<max;x++) {
        vein[x]=[]
        for (y=0;y<max;y++) {
            vein[x][y]=[]
            for (z=0;z<max;z++) {
                if (Math.abs(((x-mid)*(x-mid)+(y-mid)*(y-mid)+(z-mid)*(z-mid)) - rad*rad) <= range*range) {
                    if (rng() <= density) {
                        vein[x][y][z]=Voxels.AMETHIST
                        ores++
                    }
                    else {
                        vein[x][y][z]=Voxels.AIR
                    }
                }
                else{
                    vein[x][y][z]=Voxels.AIR
                }
            }
        }
    }
    if (d!==false)
        d.oresCount = ores
    return vein
}
  