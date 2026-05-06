// Weighted Voronoi Stippling — Adrian Secord, 2002.
//
// Tar et RGBA-bilde og produserer en distribusjon av punkter der tettheten
// reflekterer bildets mørke områder. Algoritmen:
//
//   1. Konverter bildet til en density map (mørke piksler = høy tetthet)
//   2. Initial sampling: rejection sampling vektet av tetthet
//   3. Lloyd's relaxation: iterativt beveg punkter mot vektede Voronoi-centroider
//   4. Output: punkter med per-punkt vekt (fra lokal tetthet)
//
// Resultatet er et stipple-portrett der hver prikk faktisk reflekterer
// pixelinformasjon fra bildet — "deg" oppstår av seg selv.

// Konverter RGBA → density (Float32, 0..1, mørk = høy tetthet)
export function rgbaToDensity(rgba, width, height) {
  const out = new Float32Array(width * height)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const luma = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255
    // Inverter (mørk = høy tetthet) med liten floor for at lyse områder
    // også får noen prikker (gir mer naturlig portrett-look)
    out[j] = Math.max(0.04, 1 - luma)
  }
  return out
}

// Deterministisk PRNG (xorshift32) — gir stabil output ved samme seed
function makeRandom(seed) {
  let state = (seed >>> 0) || 0xDEADBEEF
  return function next() {
    state ^= state << 13; state >>>= 0
    state ^= state >>> 17
    state ^= state << 5; state >>>= 0
    return state / 0xFFFFFFFF
  }
}

// Initial sampling via rejection — vekt sannsynligheten med density
function initialSample(density, width, height, numPoints, rng) {
  let maxDensity = 0
  for (let i = 0; i < density.length; i++) {
    if (density[i] > maxDensity) maxDensity = density[i]
  }
  if (maxDensity < 1e-6) maxDensity = 1

  const points = []
  let attempts = 0
  const maxAttempts = numPoints * 200
  while (points.length < numPoints && attempts < maxAttempts) {
    const x = Math.floor(rng() * width)
    const y = Math.floor(rng() * height)
    const d = density[y * width + x]
    if (rng() < d / maxDensity) {
      points.push({ x: x + 0.5, y: y + 0.5 })
    }
    attempts++
  }
  return points
}

// En iterasjon av Lloyd's relaxation:
//   For hver pixel — finn nærmeste punkt, akkumuler density-vektet posisjon.
//   Etterpå — flytt hvert punkt til sin vektede centroid.
function lloydIteration(points, density, width, height) {
  const N = points.length
  const sumX = new Float64Array(N)
  const sumY = new Float64Array(N)
  const sumW = new Float64Array(N)

  // Pre-load punkter til typed arrays for raskere distance-beregninger
  const px = new Float32Array(N)
  const py = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    px[i] = points[i].x
    py[i] = points[i].y
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = density[y * width + x]
      if (d < 0.05) continue
      // Finn nærmeste punkt (brute force)
      let bestIdx = 0
      let bestDist = Infinity
      for (let i = 0; i < N; i++) {
        const dx = px[i] - x
        const dy = py[i] - y
        const dd = dx * dx + dy * dy
        if (dd < bestDist) {
          bestDist = dd
          bestIdx = i
        }
      }
      sumX[bestIdx] += x * d
      sumY[bestIdx] += y * d
      sumW[bestIdx] += d
    }
  }

  for (let i = 0; i < N; i++) {
    if (sumW[i] > 0) {
      points[i].x = sumX[i] / sumW[i]
      points[i].y = sumY[i] / sumW[i]
    }
  }
}

// Hovedinngang. Tar et RGBA-bilde og returnerer N punkter med per-punkt
// vekt for senere størrelses-mapping.
export function generateStipplePoints(rgba, width, height, opts = {}) {
  const {
    numPoints = 1200,
    iterations = 6,
    seed = 1337,
    onProgress = null,
  } = opts

  const density = rgbaToDensity(rgba, width, height)
  const rng = makeRandom(seed)

  const points = initialSample(density, width, height, numPoints, rng)
  if (onProgress) onProgress(0.1)

  for (let iter = 0; iter < iterations; iter++) {
    lloydIteration(points, density, width, height)
    if (onProgress) onProgress(0.1 + 0.9 * ((iter + 1) / iterations))
  }

  // Per-punkt vekt fra lokal density (brukes til halftone-størrelser)
  for (let i = 0; i < points.length; i++) {
    const x = Math.max(0, Math.min(width - 1, Math.floor(points[i].x)))
    const y = Math.max(0, Math.min(height - 1, Math.floor(points[i].y)))
    points[i].weight = density[y * width + x]
  }

  return points
}
