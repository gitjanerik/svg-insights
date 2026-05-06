// Lucas-Kanade optical flow: estimerer per-feature 2D-bevegelse mellom to
// luma-bilder. Iterativ med bilinær sampling for sub-pixel-presisjon.
//
// Standard formulering: vi vil finne (u, v) sånn at prev(x) ≈ curr(x + (u, v)).
// Linariser: I_t + I_x·u + I_y·v ≈ 0 over en patch. Løs 2×2 normalligning.

function bilinear(img, w, h, x, y) {
  if (x < 0 || x >= w - 1 || y < 0 || y >= h - 1) return 0
  const x0 = x | 0
  const y0 = y | 0
  const fx = x - x0
  const fy = y - y0
  const i = y0 * w + x0
  return (1 - fx) * (1 - fy) * img[i]
       + fx * (1 - fy) * img[i + 1]
       + (1 - fx) * fy * img[i + w]
       + fx * fy * img[i + w + 1]
}

// Sporer ett feature fra (x, y) i prev til en oppdatert posisjon i curr.
// Returnerer { x, y, ok, residual } — ok=false betyr at sporet skal droppes.
export function trackFeature(prev, curr, w, h, x, y, opts = {}) {
  const {
    patchRadius = 5,
    maxIter = 4,
    convergenceEps = 0.05,
    minDet = 1e-6,
    maxResidual = 0.3, // gjennomsnittlig pikseldifferanse (luma 0..1)
  } = opts

  let cx = x
  let cy = y

  for (let iter = 0; iter < maxIter; iter++) {
    let A11 = 0, A12 = 0, A22 = 0, b1 = 0, b2 = 0
    let count = 0

    for (let dy = -patchRadius; dy <= patchRadius; dy++) {
      for (let dx = -patchRadius; dx <= patchRadius; dx++) {
        const px = x + dx
        const py = y + dy
        if (px < 1 || px >= w - 1 || py < 1 || py >= h - 1) continue
        const i = py * w + px
        const ix = (prev[i + 1] - prev[i - 1]) * 0.5
        const iy = (prev[i + w] - prev[i - w]) * 0.5
        const it = bilinear(curr, w, h, cx + dx, cy + dy) - prev[i]
        A11 += ix * ix
        A12 += ix * iy
        A22 += iy * iy
        b1 += ix * it
        b2 += iy * it
        count++
      }
    }

    if (count < 8) return { x: cx, y: cy, ok: false, residual: Infinity }

    const det = A11 * A22 - A12 * A12
    if (Math.abs(det) < minDet) return { x: cx, y: cy, ok: false, residual: Infinity }

    const u = (A12 * b2 - A22 * b1) / det
    const v = (A12 * b1 - A11 * b2) / det
    cx += u
    cy += v

    if (Math.hypot(u, v) < convergenceEps) break
  }

  // Sluttsjekk: gjennomsnittlig residual etter konvergens
  let sum = 0, n = 0
  for (let dy = -patchRadius; dy <= patchRadius; dy++) {
    for (let dx = -patchRadius; dx <= patchRadius; dx++) {
      const px = x + dx
      const py = y + dy
      if (px < 1 || px >= w - 1 || py < 1 || py >= h - 1) continue
      const diff = bilinear(curr, w, h, cx + dx, cy + dy) - prev[py * w + px]
      sum += Math.abs(diff)
      n++
    }
  }
  const residual = n ? sum / n : Infinity

  return { x: cx, y: cy, ok: residual < maxResidual, residual }
}

// Sporer en hel feature-liste fra prev-frame til curr-frame.
// Frame = { width, height, luma } (fra videoFrameCapture).
export function trackFeatures(prevFrame, currFrame, features, opts = {}) {
  const { width: w, height: h, luma: prev } = prevFrame
  const curr = currFrame.luma
  const margin = (opts.patchRadius ?? 5) + 1
  const out = []
  for (const f of features) {
    const r = trackFeature(prev, curr, w, h, f.x, f.y, opts)
    if (r.ok && r.x >= margin && r.x < w - margin && r.y >= margin && r.y < h - margin) {
      out.push({ ...f, x: r.x, y: r.y, residual: r.residual })
    }
  }
  return out
}

// Bygg "tracks" gjennom alle frames: hver track er en liste av (frame, x, y).
// Returnerer kun tracks som overlevde til siste frame med minLength sample.
export function buildTracks(frames, initialFeatures, opts = {}) {
  const { minLength = 0 } = opts
  const tracks = initialFeatures.map((f, id) => ({
    id,
    points: [{ frame: 0, x: f.x, y: f.y }],
    alive: true,
  }))

  for (let i = 1; i < frames.length; i++) {
    const aliveFeatures = []
    for (const t of tracks) {
      if (!t.alive) continue
      const last = t.points[t.points.length - 1]
      aliveFeatures.push({ x: last.x, y: last.y, trackId: t.id })
    }
    const tracked = trackFeatures(frames[i - 1], frames[i], aliveFeatures, opts)
    const byId = new Map(tracked.map(t => [t.trackId, t]))
    for (const t of tracks) {
      if (!t.alive) continue
      const r = byId.get(t.id)
      if (r) t.points.push({ frame: i, x: r.x, y: r.y })
      else t.alive = false
    }
  }

  return tracks.filter(t => t.points.length > minLength)
}
