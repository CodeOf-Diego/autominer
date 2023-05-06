

function perpendicular(axis) {
    return {
        x:['y','z'],
        y:['x','z'],
        z:['x','y']
    }[axis]
}

/** Generates a matrix representing a random vein with default attributes */
function generateRandomVein() {
    let ores = 0

    let rad = 5.5
    let max = (rad*2)+4
    let mid = max/2
    let range = 2.3
    let density = 0.4

    let x,y,z
    let vein = []
    for (x=0;x<max;x++) {
        vein[x]=[]
        for (y=0;y<max;y++) {
            vein[x][y]=[]
            for (z=0;z<max;z++) {
                if (Math.abs(((x-mid)*(x-mid)+(y-mid)*(y-mid)+(z-mid)*(z-mid)) - rad*rad) <= range*range) {
                    if (Math.random() <= density) {
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
  