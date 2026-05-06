// DLT (Direct Linear Transform) triangulering for å gjenopprette 3D-punkter
// fra N kameraposer + N 2D-projeksjoner per punkt.
//
// Projeksjons-modell: x ∝ K · [R | t] · X, der K er 3x3 intrinsics,
// [R | t] er 3x4 ekstrinsics, X = (X, Y, Z, 1).
//
// For hver observasjon gir vi 2 lineære likninger:
//   u · (P_3 · X) - (P_1 · X) = 0
//   v · (P_3 · X) - (P_2 · X) = 0
// Stables for alle observasjoner → A · X = 0, løs via SVD.

// Kamera-intrinsics fra typisk smartphone-FOV
export function defaultIntrinsics(width, height, horizontalFovDeg = 65) {
  const fx = (width / 2) / Math.tan((horizontalFovDeg * Math.PI / 180) / 2)
  const fy = fx
  const cx = width / 2
  const cy = height / 2
  return { fx, fy, cx, cy }
}

// Bygg projeksjonsmatrise P (3x4) fra K, R (3x3) og t (3-vektor)
export function projectionMatrix(K, R, t) {
  const { fx, fy, cx, cy } = K
  // KR: 3x3
  const KR = [
    [fx * R[0][0] + cx * R[2][0], fx * R[0][1] + cx * R[2][1], fx * R[0][2] + cx * R[2][2]],
    [fy * R[1][0] + cy * R[2][0], fy * R[1][1] + cy * R[2][1], fy * R[1][2] + cy * R[2][2]],
    [R[2][0], R[2][1], R[2][2]],
  ]
  // Kt: 3-vektor
  const Kt = [
    fx * t[0] + cx * t[2],
    fy * t[1] + cy * t[2],
    t[2],
  ]
  return [
    [KR[0][0], KR[0][1], KR[0][2], Kt[0]],
    [KR[1][0], KR[1][1], KR[1][2], Kt[1]],
    [KR[2][0], KR[2][1], KR[2][2], Kt[2]],
  ]
}

// Triangulering av ett punkt fra N observasjoner.
// observations: [{ P, u, v }] der P er 3x4 projeksjonsmatrise.
// Returnerer (X, Y, Z) eller null hvis dårlig konditionert.
export function triangulatePoint(observations) {
  if (observations.length < 2) return null

  // Bygg A som er (2N x 4)
  const N = observations.length
  const A = []
  for (const { P, u, v } of observations) {
    A.push([
      u * P[2][0] - P[0][0],
      u * P[2][1] - P[0][1],
      u * P[2][2] - P[0][2],
      u * P[2][3] - P[0][3],
    ])
    A.push([
      v * P[2][0] - P[1][0],
      v * P[2][1] - P[1][1],
      v * P[2][2] - P[1][2],
      v * P[2][3] - P[1][3],
    ])
  }

  // Løs A·X = 0 ved minste egenvektor til A^T A
  const X = solveHomogeneous4(A)
  if (!X) return null

  // Normaliser homogen koordinat
  if (Math.abs(X[3]) < 1e-9) return null
  return {
    X: X[0] / X[3],
    Y: X[1] / X[3],
    Z: X[2] / X[3],
  }
}

// Bygg A^T A (4x4) og finn egenvektoren med minste egenverdi via potens-iterasjon
// på (A^T A)^(-1) er for ustabilt — vi bruker Jacobi i stedet.
function solveHomogeneous4(A) {
  // Bygg M = A^T A (4x4 symmetrisk)
  const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) {
        M[j][k] += A[i][j] * A[i][k]
      }
    }
  }

  // Jacobi-eigenvalue-dekomposisjon for 4x4 symmetrisk matrise
  const { eigenvalues, eigenvectors } = jacobiEigen4(M)

  // Finn minste egenverdi
  let minIdx = 0
  for (let i = 1; i < 4; i++) {
    if (eigenvalues[i] < eigenvalues[minIdx]) minIdx = i
  }
  return [
    eigenvectors[0][minIdx],
    eigenvectors[1][minIdx],
    eigenvectors[2][minIdx],
    eigenvectors[3][minIdx],
  ]
}

// Jacobi-rotasjon for symmetrisk 4x4 matrise.
// Returnerer { eigenvalues: [4], eigenvectors: [4][4] (kolonner) }
export function jacobiEigen4(input, maxIter = 50, tol = 1e-10) {
  // Kopier input
  const M = input.map(row => [...row])
  // Eigenvektor-matrise starter som identitet
  const V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]

  for (let iter = 0; iter < maxIter; iter++) {
    // Finn største off-diagonal
    let p = 0, q = 1, maxOff = Math.abs(M[0][1])
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        if (Math.abs(M[i][j]) > maxOff) {
          maxOff = Math.abs(M[i][j])
          p = i
          q = j
        }
      }
    }
    if (maxOff < tol) break

    // Beregn rotasjonsvinkel
    const app = M[p][p]
    const aqq = M[q][q]
    const apq = M[p][q]
    const theta = (aqq - app) / (2 * apq)
    const t = (theta >= 0)
      ? 1 / (theta + Math.sqrt(1 + theta * theta))
      : 1 / (theta - Math.sqrt(1 + theta * theta))
    const c = 1 / Math.sqrt(1 + t * t)
    const s = t * c

    // Roter M
    M[p][p] = app - t * apq
    M[q][q] = aqq + t * apq
    M[p][q] = 0
    M[q][p] = 0
    for (let i = 0; i < 4; i++) {
      if (i !== p && i !== q) {
        const aip = M[i][p]
        const aiq = M[i][q]
        M[i][p] = c * aip - s * aiq
        M[p][i] = M[i][p]
        M[i][q] = s * aip + c * aiq
        M[q][i] = M[i][q]
      }
    }

    // Roter V (akkumulér eigenvektor)
    for (let i = 0; i < 4; i++) {
      const vip = V[i][p]
      const viq = V[i][q]
      V[i][p] = c * vip - s * viq
      V[i][q] = s * vip + c * viq
    }
  }

  const eigenvalues = [M[0][0], M[1][1], M[2][2], M[3][3]]
  return { eigenvalues, eigenvectors: V }
}

// Kjør triangulering for alle tracks. Returnerer [{ trackId, point: {X,Y,Z}, depth }].
// poses: per-frame { R, t } i kamerakoordinater.
// Krever at trackene har minst minObservations punkter.
export function triangulateTracks(tracks, poses, K, opts = {}) {
  const { minObservations = 4 } = opts
  const out = []

  // Pre-compute projeksjonsmatriser
  const projMatrices = poses.map(p => projectionMatrix(K, p.R, p.t))

  for (const track of tracks) {
    if (track.points.length < minObservations) continue
    const obs = track.points.map(p => ({
      P: projMatrices[p.frame],
      u: p.x,
      v: p.y,
    }))
    const X = triangulatePoint(obs)
    if (!X) continue
    if (!isFinite(X.X) || !isFinite(X.Y) || !isFinite(X.Z)) continue
    out.push({
      trackId: track.id,
      point: X,
      depth: X.Z,
    })
  }

  return out
}
