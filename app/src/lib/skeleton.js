// Skeletonization og vectorisering av binær raster.
// Brukes til å trekke stupkant-linjer fra slope-terskel-områder.
//
// Implementerer Zhang-Suen thinning (1984) — klassisk to-pass algoritme
// som tynner et binært bilde til 1-pixel-bred skelet. Output er deretter
// vectorisert til polylines ved å traverser fra endepunkter og krysninger.

/**
 * Zhang-Suen skeletonization av et binært raster.
 * Input: Uint8Array hvor 1 = forgrunnspiksel, 0 = bakgrunn.
 * Returnerer ny Uint8Array av samme størrelse med tynnet skelett.
 *
 * @param {Uint8Array} src
 * @param {number} cols
 * @param {number} rows
 * @returns {Uint8Array}
 */
export function zhangSuenSkeletonize(src, cols, rows) {
  const out = new Uint8Array(src)
  const toRemove = []
  let changed = true

  while (changed) {
    changed = false

    // ── Sub-iterasjon 1 ──
    toRemove.length = 0
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x
        if (out[i] === 0) continue
        if (passOne(out, x, y, cols)) toRemove.push(i)
      }
    }
    if (toRemove.length > 0) changed = true
    for (const i of toRemove) out[i] = 0

    // ── Sub-iterasjon 2 ──
    toRemove.length = 0
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x
        if (out[i] === 0) continue
        if (passTwo(out, x, y, cols)) toRemove.push(i)
      }
    }
    if (toRemove.length > 0) changed = true
    for (const i of toRemove) out[i] = 0
  }

  return out
}

// 8-naboers indekser: P2..P9 (med klokken fra øverst-nord)
function neighbors(arr, x, y, cols) {
  return [
    arr[(y - 1) * cols + x],         // P2 (N)
    arr[(y - 1) * cols + (x + 1)],   // P3 (NE)
    arr[y * cols + (x + 1)],         // P4 (E)
    arr[(y + 1) * cols + (x + 1)],   // P5 (SE)
    arr[(y + 1) * cols + x],         // P6 (S)
    arr[(y + 1) * cols + (x - 1)],   // P7 (SW)
    arr[y * cols + (x - 1)],         // P8 (W)
    arr[(y - 1) * cols + (x - 1)],   // P9 (NW)
  ]
}

function countTransitions01(p) {
  // Antall 0→1-transisjoner i sekvensen P2,P3,...,P9,P2
  let count = 0
  for (let i = 0; i < 8; i++) {
    if (p[i] === 0 && p[(i + 1) % 8] === 1) count++
  }
  return count
}

function countNonzero(p) {
  let n = 0
  for (let i = 0; i < 8; i++) if (p[i]) n++
  return n
}

function passOne(arr, x, y, cols) {
  const p = neighbors(arr, x, y, cols)
  const B = countNonzero(p)
  if (B < 2 || B > 6) return false
  if (countTransitions01(p) !== 1) return false
  // P2 * P4 * P6 = 0
  if (p[0] * p[2] * p[4] !== 0) return false
  // P4 * P6 * P8 = 0
  if (p[2] * p[4] * p[6] !== 0) return false
  return true
}

function passTwo(arr, x, y, cols) {
  const p = neighbors(arr, x, y, cols)
  const B = countNonzero(p)
  if (B < 2 || B > 6) return false
  if (countTransitions01(p) !== 1) return false
  // P2 * P4 * P8 = 0
  if (p[0] * p[2] * p[6] !== 0) return false
  // P2 * P6 * P8 = 0
  if (p[0] * p[4] * p[6] !== 0) return false
  return true
}

/**
 * Traverser et skelett-raster og produser polylines i grid-koordinater.
 * Følger linjer fra endepunkter (1-grads pixler) til endepunkter eller
 * forgreninger (3+ grads). Polyliner med færre enn `minPx` pixler droppes.
 *
 * @param {Uint8Array} skeleton  binær (0/1)
 * @param {number} cols
 * @param {number} rows
 * @param {object} [opts]
 * @param {number} [opts.minPx=4]    minimum antall pixler i en polyline
 * @returns {Array<Array<[number, number]>>}  liste av polylines (grid-koord)
 */
export function vectorizeSkeleton(skeleton, cols, rows, opts = {}) {
  const minPx = opts.minPx ?? 4
  const visited = new Uint8Array(skeleton.length)
  const result = []

  // Hjelpere
  const at = (x, y) => skeleton[y * cols + x]
  const degree = (x, y) => {
    let d = 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx, ny = y + dy
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue
        if (skeleton[ny * cols + nx]) d++
      }
    }
    return d
  }

  // 1) Trace fra alle endepunkter (deg === 1)
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (!at(x, y) || visited[y * cols + x]) continue
      if (degree(x, y) !== 1) continue
      const line = traceLine(x, y, skeleton, visited, cols, rows, degree)
      if (line.length >= minPx) result.push(line)
    }
  }

  // 2) Plukk opp ringer (lukket loop, ingen endepunkt)
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (!at(x, y) || visited[y * cols + x]) continue
      const line = traceLine(x, y, skeleton, visited, cols, rows, degree)
      if (line.length >= minPx) result.push(line)
    }
  }

  return result
}

function traceLine(startX, startY, skeleton, visited, cols, rows, degree) {
  const line = []
  let x = startX, y = startY
  let prevX = -1, prevY = -1
  while (true) {
    line.push([x, y])
    visited[y * cols + x] = 1
    let nextX = -1, nextY = -1
    // Foretrekker rett framover (samme retning som forrige steg)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx, ny = y + dy
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue
        if (!skeleton[ny * cols + nx]) continue
        if (visited[ny * cols + nx]) continue
        nextX = nx; nextY = ny
        // Hvis dette er en forgrening, stopp her — ikke fortsett i flere retninger
        if (degree(nx, ny) >= 3) {
          line.push([nx, ny])
          visited[ny * cols + nx] = 1
          return line
        }
        break
      }
      if (nextX !== -1) break
    }
    if (nextX === -1) break
    prevX = x; prevY = y
    x = nextX; y = nextY
  }
  return line
}
