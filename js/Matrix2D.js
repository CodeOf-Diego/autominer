class Matrix2D {
    #hiddenI={}
    
    constructor(plain=[]) {
        this.plain = plain
    }

    #addRowIfMissing(i) { if (this.plain[i] === undefined) this.plain[i] = [] }

    get(i,j) {
        this.#addRowIfMissing(i)
        return this.plain[i][j]
    }
    
    set(i,j, value) {
        this.#addRowIfMissing(i)
        this.plain[i][j] = value
    }

    maxI() { return this.plain.length - 1 }
    maxJ() { return this.plain[0].length -1 }

    l(i,j) { return i > 0 ? this.get(i-1,j) : Plains.OOB }
    u(i,j) { return j > 0 ? this.get(i,j-1) : Plains.OOB }
    r(i,j) { return i < this.maxI() ? this.get(i+1,j) : Plains.OOB }
    d(i,j) { return j < this.maxJ() ? this.get(i,j+1) : Plains.OOB }

    loop(func, maxI, maxJ) {
        for (let i=0 ; i < maxI??this.maxI() ; i++) {
            for (let j=0 ; j < maxJ??this.maxJ() ; j++) {
                this.#hiddenI ={i:i,j:j}
                func(i,j)
            }
        }
    }

    /** When inside a loop, the coordinates for the specific point are kept in the class to avoid the need to pass them every time */
    GET() { return this.get(this.#hiddenI.i,this.#hiddenI.j) }
    SET(value) { this.set(this.#hiddenI.i,this.#hiddenI.j, value) }
    
    L() { return this.l(this.#hiddenI.i,this.#hiddenI.j)}
    U() { return this.u(this.#hiddenI.i,this.#hiddenI.j)}
    R() { return this.r(this.#hiddenI.i,this.#hiddenI.j)}
    D() { return this.d(this.#hiddenI.i,this.#hiddenI.j)}
}