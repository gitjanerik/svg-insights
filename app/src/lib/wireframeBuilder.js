// Bygger en 3D-trådramme fra en punktsky ved k-nærmeste-nabo.
// Filtrerer outlier-kanter (lange ift. median) for å unngå "edderkopp-nett"
// effekten der støy-punkter trekker linjer på tvers av scenen.

export function buildWireframe(points, opts = {}) {
  const {
    k = 5,
    maxEdgeFactor = 1.8,  // dropp kanter > maxEdgeFactor · median
  } = opts

  const N = points.length
  if (N < 2) return []

  // Samle alle k-NN-kandidater i et sett (dedup som "min-max"-nøkkel)
  const edgeMap = new Map()
  for (let i = 0; i < N; i++) {
    const dists = []
    const pi = points[i]
    for (let j = 0; j < N; j++) {
      if (i === j) continue
      const pj = points[j]
      const dx = pi.X - pj.X
      const dy = pi.Y - pj.Y
      const dz = pi.Z - pj.Z
      dists.push({ j, d: Math.hypot(dx, dy, dz) })
    }
    dists.sort((a, b) => a.d - b.d)
    const limit = Math.min(k, dists.length)
    for (let n = 0; n < limit; n++) {
      const j = dists[n].j
      const a = i < j ? i : j
      const b = i < j ? j : i
      const key = a * N + b
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { a, b, length: dists[n].d })
      }
    }
  }

  // Median-filtrering
  const lengths = Array.from(edgeMap.values()).map(e => e.length).sort((a, b) => a - b)
  const median = lengths[Math.floor(lengths.length / 2)] || 0
  const maxLen = median * maxEdgeFactor

  return Array.from(edgeMap.values()).filter(e => e.length <= maxLen)
}

// Beregn euklidsk avstand mellom to 3D-punkter
export function distance3D(a, b) {
  return Math.hypot(a.X - b.X, a.Y - b.Y, a.Z - b.Z)
}
