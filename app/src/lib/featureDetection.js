// Harris-corner-deteksjon for "features to track". Tar inn et luma-bilde
// (Float32Array, 0..1) og returnerer de N sterkeste hjørnene. Alt ren JS over
// typed arrays; designet for mobile pixel-budsjett.

// Sentral-differanser er raskere enn Sobel og fungerer godt på 320x240.
export function computeGradients(luma, w, h) {
  const Ix = new Float32Array(w * h)
  const Iy = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      Ix[i] = (luma[i + 1] - luma[i - 1]) * 0.5
      Iy[i] = (luma[i + w] - luma[i - w]) * 0.5
    }
  }
  return { Ix, Iy }
}

// Harris-response over et boxfilter-vindu. R = det(M) - k·trace(M)².
// k = 0.04 er klassisk valg.
export function harrisResponse(Ix, Iy, w, h, { windowRadius = 1, k = 0.04 } = {}) {
  const N = w * h
  const Ixx = new Float32Array(N)
  const Iyy = new Float32Array(N)
  const Ixy = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    Ixx[i] = Ix[i] * Ix[i]
    Iyy[i] = Iy[i] * Iy[i]
    Ixy[i] = Ix[i] * Iy[i]
  }

  const r = windowRadius
  const response = new Float32Array(N)
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      let sxx = 0, syy = 0, sxy = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const i = (y + dy) * w + (x + dx)
          sxx += Ixx[i]
          syy += Iyy[i]
          sxy += Ixy[i]
        }
      }
      const det = sxx * syy - sxy * sxy
      const trace = sxx + syy
      response[y * w + x] = det - k * trace * trace
    }
  }
  return response
}

// Non-max suppression: behold lokale maks i (2·radius+1)² nabolag.
export function nonMaxSuppression(response, w, h, { radius = 5, threshold = 0 } = {}) {
  const peaks = []
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      const v = response[y * w + x]
      if (v <= threshold) continue
      let isMax = true
      checkLoop: for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue
          if (response[(y + dy) * w + (x + dx)] > v) {
            isMax = false
            break checkLoop
          }
        }
      }
      if (isMax) peaks.push({ x, y, response: v })
    }
  }
  return peaks
}

// Hovedinngangen: gir top-N hjørner fra et luma-bilde.
export function detectFeatures(luma, w, h, opts = {}) {
  const {
    maxFeatures = 200,
    nmsRadius = 6,
    qualityLevel = 0.01, // andel av maks-response som blir terskel
    margin = 8,          // hold borte fra ramma
  } = opts

  const { Ix, Iy } = computeGradients(luma, w, h)
  const response = harrisResponse(Ix, Iy, w, h)

  // Finn maks-response for å sette adaptiv terskel
  let maxR = 0
  for (let i = 0; i < response.length; i++) {
    if (response[i] > maxR) maxR = response[i]
  }
  const threshold = maxR * qualityLevel

  const peaks = nonMaxSuppression(response, w, h, { radius: nmsRadius, threshold })

  // Filtrer bort kandidater for nær ramma (LK-patch trenger plass)
  const filtered = peaks.filter(p =>
    p.x >= margin && p.x < w - margin && p.y >= margin && p.y < h - margin
  )

  filtered.sort((a, b) => b.response - a.response)
  return filtered.slice(0, maxFeatures)
}
