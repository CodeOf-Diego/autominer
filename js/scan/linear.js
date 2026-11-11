/**
 * The lattice is solved, not searched. With the camera known, a measured line with coefficients (a, b, c) in centred pixels is a plane through the
 * camera with normal n = (a f, b f, c), and the cube edge X it shows lies in that plane: n . X = 0. X is the cube position P plus a known offset
 * (half a side along two axes), so every line is ONE LINEAR EQUATION IN P. Three lines give P; more lines over-determine it and the residual says
 * whether the hypothesis "this is one cube" holds. FOV and distance are not independent trials either: both enter the same equations.
 */

/** Solves A x = b for a 3x3 system (Gaussian elimination, partial pivoting); null when singular */
function solve3x3(A, b) {
    let M = A.map((r, i) => r.concat([b[i]]))
    for (let i = 0; i < 3; i++) {
        let p = i
        for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k
        if (Math.abs(M[p][i]) < 1e-9) return null
        ;[M[i], M[p]] = [M[p], M[i]]
        for (let k = i + 1; k < 3; k++) { let c = M[k][i] / M[i][i]; for (let j = i; j < 4; j++) M[k][j] -= c * M[i][j] }
    }
    let x = [0, 0, 0]
    for (let i = 2; i >= 0; i--) { let s = M[i][3]; for (let j = i + 1; j < 3; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i] }
    return x
}

/** Gaussian elimination with partial pivoting for any size; null when singular */
function solveLinear(A, b) {
    let n = b.length, M = A.map((r, i) => r.concat([b[i]]))
    for (let i = 0; i < n; i++) {
        let p = i
        for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k
        if (Math.abs(M[p][i]) < 1e-12) return null
        ;[M[i], M[p]] = [M[p], M[i]]
        for (let k = i + 1; k < n; k++) { let c = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= c * M[i][j] }
    }
    let x = new Array(n)
    for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i] }
    return x
}
