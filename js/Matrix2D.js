class Matrix2D {
    constructor() {
        this.plain = []
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

    L(i,j) { return i > 0 ? this.get(i-1,j) : Plains.OOB }
    U(i,j) { return j > 0 ? this.get(i,j-1) : Plains.OOB }
    R(i,j) { return i < this.maxI() ? this.get(i+1,j) : Plains.OOB }
    D(i,j) { return j < this.maxJ() ? this.get(i,j+1) : Plains.OOB }
}