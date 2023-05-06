class Matrix3D {
    constructor() {
        this.matrix = []
    }

    #addDimensionX(x) { if (this.matrix[x] === undefined) this.matrix[x] = []}
    #addDimensionXY(x,y) { this.#addDimensionX(x); if (this.matrix[x][y] === undefined) this.matrix[x][y] = []}

    get(x,y,z) {
        this.#addDimensionXY(x,y)
        return this.matrix[x][y][z]
    }
    
    set(x,y,z, value) {
        this.#addDimensionXY(x,y)
        this.matrix[x][y][z] = value
    }

    maxX() { return this.matrix.length - 1 }
    maxY() { return this.matrix[0].length -1 }
    maxZ() { return this.matrix[0][0].length -1 }

    XP(x,y,z) { return x > 0 ? this.get(x-1,y,z) : Voxels.OOB}
    YP(x,y,z) { return y > 0 ? this.get(x,y-1,z) : Voxels.OOB}
    ZP(x,y,z) { return z > 0 ? this.get(x,y,z-1) : Voxels.OOB}
    XN(x,y,z) { return x < this.maxX() ? this.get(x+1,y,z) : Voxels.OOB}
    YN(x,y,z) { return y < this.maxY() ? this.get(x,y+1,z) : Voxels.OOB}
    YN(x,y,z) { return z < this.maxZ() ? this.get(x,y,z+1) : Voxels.OOB}
}