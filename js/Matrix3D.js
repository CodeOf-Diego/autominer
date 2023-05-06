class Matrix3D {
    #hiddenI={}

    constructor(matrix=[]) {
        this.matrix = matrix
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

    /** returns the size of a dimension of the matrix */
    maxX() { return this.matrix.length }
    maxY() { return this.matrix[0].length }
    maxZ() { return this.matrix[0][0].length }
    
    /** returns the value of a neighboor cell, or out of bounds */
    xp(x,y,z) { return x > 0 ? this.get(x-1,y,z) : Voxels.OOB}
    yp(x,y,z) { return y > 0 ? this.get(x,y-1,z) : Voxels.OOB}
    zp(x,y,z) { return z > 0 ? this.get(x,y,z-1) : Voxels.OOB}
    xn(x,y,z) { return x < this.maxX()-1 ? this.get(x+1,y,z) : Voxels.OOB}
    yn(x,y,z) { return y < this.maxY()-1 ? this.get(x,y+1,z) : Voxels.OOB}
    zn(x,y,z) { return z < this.maxZ()-1 ? this.get(x,y,z+1) : Voxels.OOB}

    // Loops the matrix
    loop(func, max={}, initial={}) {
        for (let x=initial['x']??0 ; x < (max['x']??this.maxX()) ; x++) {
            for (let y=initial['y']??0 ; y < (max['y']??this.maxY()) ; y++) {
                for (let z=initial['z']??0 ; z < (max['z']??this.maxZ()) ; z++) {
                    this.#hiddenI ={x:x,y:y,z:z}
                    func(this.#hiddenI)
                }
            }
        }
    }

    /** When inside a loop, the coordinates for the specific point are kept in the class to avoid the need to pass them every time */
    GET() { return this.get(this.#hiddenI.x,this.#hiddenI.y,this.#hiddenI.z) }
    SET(value) { this.set(this.#hiddenI.x,this.#hiddenI.y,this.#hiddenI.z, value) }

    XP() { return this.xp(this.#hiddenI.x,this.#hiddenI.y,this.#hiddenI.z)} 
    YP() { return this.yp(this.#hiddenI.x,this.#hiddenI.y,this.#hiddenI.z)} 
    ZP() { return this.zp(this.#hiddenI.x,this.#hiddenI.y,this.#hiddenI.z)} 
    XN() { return this.xn(this.#hiddenI.x,this.#hiddenI.y,this.#hiddenI.z)} 
    YN() { return this.yn(this.#hiddenI.x,this.#hiddenI.y,this.#hiddenI.z)} 
    ZN() { return this.zn(this.#hiddenI.x,this.#hiddenI.y,this.#hiddenI.z)} 

  
}