

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
  

/**
 * Compact form of a vein, for sharing/pasting: instead of the full x*y*z matrix (almost all
 * air) only the grid size and the coordinates of the amethyst cells are written, 0-based
 * [x,y,z] like the matrix indices - e.g. {size:[15,15,15], ores:[[3,10,6],[3,11,7],...]}.
 * Anything that isn't amethyst (air, and the red debug marker processVein() puts at 2,2,2) is
 * not part of the vein data and is not exported. The size is kept because air outside the
 * ores is part of the result (the perimeter search looks at the cells around the vein, and
 * where the grid ends changes what exists around it).
 */
function veinToSparse(matrix) {
    let ores = []
    for (let x=0; x<matrix.length; x++)
        for (let y=0; y<matrix[x].length; y++)
            for (let z=0; z<matrix[x][y].length; z++)
                if (matrix[x][y][z] === Voxels.AMETHIST) ores.push([x,y,z])
    return { size: [matrix.length, matrix[0].length, matrix[0][0].length], ores }
}

/** Inverse of veinToSparse(): rebuilds the full matrix (air everywhere, amethyst at `ores`) */
function veinFromSparse(sparse) {
    let [sx,sy,sz] = sparse.size
    let matrix = []
    for (let x=0; x<sx; x++) {
        matrix[x] = []
        for (let y=0; y<sy; y++) matrix[x][y] = new Array(sz).fill(Voxels.AIR)
    }
    for (let [x,y,z] of sparse.ores) matrix[x][y][z] = Voxels.AMETHIST
    return matrix
}

/**
 * Reads a pasted export ({seed, size, ores}) and returns {seed, vein} ready for
 * processVein(vein, seed). The old dense format ({seed, vein:[[[...]]]}) still loads too, so
 * exports copied before the compact format existed keep working.
 */
function veinFromExport(data) {
    let vein = data.ores !== undefined ? veinFromSparse(data) : data.vein
    if (d !== false) {
        let ores = 0
        for (let plane of vein) for (let row of plane) for (let cell of row) if (cell === Voxels.AMETHIST) ores++
        d.oresCount = ores
    }
    return { seed: data.seed, vein }
}
