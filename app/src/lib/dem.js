// DEM (Digital Elevation Model) håndtering — konturer, hillshade,
// helling, og deriverte features for ISOM-symbolisering.
//
// Inn: RasterGrid med Float32Array av høydeverdier i meter, sammen
// med en AffineTransform som plasserer grid-en i UTM-rommet.
//
// API:
//   buildContours(dem, intervalM, indexEvery)
//   buildHillshade(dem, options)
//   computeSlope(dem)
//   computeTPI(dem, radiusPx)
//   detectCliffs(dem, slopeDegThreshold, minLengthM)
//   syntheticDEM(bbox, options)            for testing uten ekte data
//
// For ekte DTM 1m fra Kartverket: bruk demFetcher.js (krever serverside)

import { contours as d3Contours } from 'd3-contour'
import { simplifyDP, chaikin, polylineToPath, polylineLength } from './pathUtils.js'
import { zhangSuenSkeletonize, vectorizeSkeleton } from './skeleton.js'

/**
 * @typedef {Object} AffineTransform
 * @property {number} originX
 * @property {number} originY
 * @property {number} pixelWidth   meter pr piksel (positiv)
 * @property {number} pixelHeight  meter pr piksel (typisk negativ)
 */

/**
 * @typedef {Object} DEM
 * @property {Float32Array} data
 * @property {number} cols
 * @property {number} rows
 * @property {AffineTransform} transform
 * @property {number} noData
 * @property {number} resolution
 */

/** Grid-koord → UTM via AffineTransform */
function gridToWorld([col, row], t) {
  return [
    t.originX + col * t.pixelWidth,
    t.originY + row * t.pixelHeight,
  ]
}

/**
 * Generer konturer fra et DEM. Bruker marching squares (d3-contour).
 * Returnerer features med polylines i UTM-koordinater.
 *
 * @param {DEM} dem
 * @param {number} intervalM        Ekvidistanse, typisk 5 m for ISOM
 * @param {number} indexEvery       Hver N-te kontur er indekskontur (5 → hver 25 m)
 * @returns {{
 *   features: Array,
 *   intervalM: number,
 *   indexEvery: number,
 *   minElevM: number,
 *   maxElevM: number
 * }}
 */
export function buildContours(dem, intervalM = 20, indexEvery = 5) {
  const { data, cols, rows, transform, noData } = dem

  // Finn min/max
  let minE = Infinity, maxE = -Infinity
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (v === noData || !Number.isFinite(v)) continue
    if (v < minE) minE = v
    if (v > maxE) maxE = v
  }
  const floorTo = (v, m) => Math.floor(v / m) * m
  const ceilTo = (v, m) => Math.ceil(v / m) * m

  const thresholds = []
  for (let e = floorTo(minE, intervalM); e <= ceilTo(maxE, intervalM); e += intervalM) {
    thresholds.push(e)
  }

  // d3-contour krever Array, ikke typed
  const arr = Array.from(data, v => v === noData ? -9999 : v)
  const polys = d3Contours()
    .size([cols, rows])
    .thresholds(thresholds)(arr)

  // Konverter MultiPolygon → polylines (kun ytre konturlinjer)
  const features = []
  for (const level of polys) {
    const elevation = level.value
    const isIndex = Math.round(elevation / intervalM) % indexEvery === 0
    for (const poly of level.coordinates) {
      // poly er Array<Ring> der ring[0] = ytre, øvrige = hull
      // Vi vil ha alle ringer som linjer (kontur er jo linje uansett)
      for (const ring of poly) {
        const worldRing = ring.map(p => gridToWorld(p, transform))
        // Min-lengde 4× ekvidistanse for å beholde lokale konturer i bratte
        // områder (stupkant-soner) og rundt små topper, men fortsatt fjerne
        // ren støy.
        if (polylineLength(worldRing) < intervalM * 4) continue
        // Mildere simplification (2.5m → 1.0m) bevarer nyanser i tette
        // kontur-regioner (bratte sider) uten å overdrive antall punkter.
        const simplified = simplifyDP(worldRing, 2.5)
        const smoothed = chaikin(simplified, 2, true)
        const final = simplifyDP(smoothed, 1.0)
        if (final.length < 4) continue
        features.push({
          type: 'contour',
          isomCode: isIndex ? '102' : '101',
          elevation,
          isIndex,
          coordinates: final,
        })
      }
    }
  }

  return { features, intervalM, indexEvery, minElevM: minE, maxElevM: maxE }
}

/**
 * Hillshade etter Horn 1981 + multi-direksjonell sum (Mark 1992).
 * Returnerer en Uint8Array med 0..255 lyshet per piksel.
 *
 * @param {DEM} dem
 * @param {object} [opts]
 * @param {number} [opts.altitudeDeg=45]
 * @param {number[]} [opts.azimuthsDeg]    Sol-azimuts å gjennomsnittliggjøre
 * @param {number} [opts.zFactor=1]        Vertikal forsterkning
 */
export function buildHillshade(dem, opts = {}) {
  const { altitudeDeg = 45, azimuthsDeg = [225, 270, 315, 360], zFactor = 1 } = opts
  const { data, cols, rows, transform, noData } = dem
  const cellSize = Math.abs(transform.pixelWidth)
  const out = new Uint8Array(data.length)
  const altRad = altitudeDeg * Math.PI / 180

  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x
      const a = data[i - cols - 1], b = data[i - cols], c = data[i - cols + 1]
      const d = data[i - 1],         e = data[i],        f = data[i + 1]
      const g = data[i + cols - 1], h = data[i + cols], k = data[i + cols + 1]
      if ([a, b, c, d, e, f, g, h, k].some(v => v === noData)) {
        out[i] = 200
        continue
      }
      const dzDx = ((c + 2 * f + k) - (a + 2 * d + g)) / (8 * cellSize) * zFactor
      const dzDy = ((g + 2 * h + k) - (a + 2 * b + c)) / (8 * cellSize) * zFactor
      const slope = Math.atan(Math.hypot(dzDx, dzDy))
      const aspect = Math.atan2(dzDy, -dzDx)
      let sum = 0
      for (const az of azimuthsDeg) {
        const azRad = (az - 90) * Math.PI / 180
        sum += Math.max(0,
          Math.cos(altRad) * Math.cos(slope)
          + Math.sin(altRad) * Math.sin(slope) * Math.cos(azRad - aspect))
      }
      out[i] = Math.round(255 * sum / azimuthsDeg.length)
    }
  }
  return { ...dem, data: out }
}

export function computeSlope(dem) {
  const { data, cols, rows, transform, noData } = dem
  const cellSize = Math.abs(transform.pixelWidth)
  const out = new Float32Array(data.length)
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x
      if (data[i] === noData) { out[i] = 0; continue }
      const dzDx = (data[i + 1] - data[i - 1]) / (2 * cellSize)
      const dzDy = (data[i + cols] - data[i - cols]) / (2 * cellSize)
      out[i] = Math.atan(Math.hypot(dzDx, dzDy)) * 180 / Math.PI
    }
  }
  return { ...dem, data: out }
}

/**
 * Topographic Position Index — pixel minus mean av nabo-pikslen.
 * Brukes til å finne knauser (TPI > 0) og groper (TPI < 0).
 */
export function computeTPI(dem, radiusPx = 5) {
  const { data, cols, rows, noData } = dem
  const out = new Float32Array(data.length)
  for (let y = radiusPx; y < rows - radiusPx; y++) {
    for (let x = radiusPx; x < cols - radiusPx; x++) {
      let sum = 0, n = 0
      for (let dy = -radiusPx; dy <= radiusPx; dy++) {
        for (let dx = -radiusPx; dx <= radiusPx; dx++) {
          const v = data[(y + dy) * cols + (x + dx)]
          if (v !== noData) { sum += v; n++ }
        }
      }
      const center = data[y * cols + x]
      out[y * cols + x] = n > 0 ? center - sum / n : 0
    }
  }
  return { ...dem, data: out }
}

/**
 * Detekter knauser (TPI > terskel) og groper (TPI < -terskel) som
 * point-features i UTM. ISOM-kode 213 (knaus).
 */
export function detectKnauser(dem, tpiRadius = 5, tpiThresholdM = 1.5) {
  const tpi = computeTPI(dem, tpiRadius)
  const features = []
  const { cols, rows, transform } = dem
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = tpi.data[y * cols + x]
      if (v >= tpiThresholdM) {
        // Bare beholde lokale maksima for å unngå duster av punkter
        let isPeak = true
        for (let dy = -1; dy <= 1 && isPeak; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const yy = y + dy, xx = x + dx
            if (yy < 0 || yy >= rows || xx < 0 || xx >= cols) continue
            if (tpi.data[yy * cols + xx] > v) { isPeak = false; break }
          }
        }
        if (isPeak) {
          const [wx, wy] = gridToWorld([x, y], transform)
          features.push({ type: 'point', isomCode: '213', x: wx, y: wy, tpi: v })
        }
      }
    }
  }
  return features
}

/**
 * Detekter stupkanter via slope-terskel + skeletonization + vectorisering.
 *
 * Algoritme:
 *   1. Beregn slope per pixel (Horn 1981 sentrale differanser)
 *   2. Threshold → binær mask (1 hvor helling > terskel)
 *   3. Morphological close (én iter) for å bro små gap
 *   4. Zhang-Suen skeletonization → 1-pixel-bred centerline
 *   5. Vectorize skeleton fra endepunkter → polylines i grid-koord
 *   6. Reproject til UTM, simplifiser med DP, filtrer på lengde
 *
 * @param {DEM} dem
 * @param {number} slopeDegThreshold  ISOM 203 (upassérbar): typisk 55-65°
 * @param {number} minLengthM         minimum stupkant-lengde for å beholde
 * @returns {Array}
 */
export function detectCliffs(dem, slopeDegThreshold = 45, minLengthM = 10) {
  const slope = computeSlope(dem)
  const { cols, rows, transform } = dem

  // Threshold til binær
  let mask = new Uint8Array(slope.data.length)
  for (let i = 0; i < slope.data.length; i++) {
    mask[i] = slope.data[i] >= slopeDegThreshold ? 1 : 0
  }

  // Morphological close (dilate → erode) for å bro små diskontinuiteter
  mask = morphClose(mask, cols, rows)

  // Skeletonize
  const skeleton = zhangSuenSkeletonize(mask, cols, rows)

  // Vectorize til polylines i grid-koord
  const minPx = Math.max(3, Math.round(minLengthM / Math.abs(transform.pixelWidth)))
  const lines = vectorizeSkeleton(skeleton, cols, rows, { minPx })

  // Reproject + forenkle + filtrer
  const features = []
  for (const line of lines) {
    const worldLine = line.map(([x, y]) => gridToWorld([x, y], transform))
    if (polylineLength(worldLine) < minLengthM) continue
    const simplified = simplifyDP(worldLine, Math.max(1, Math.abs(transform.pixelWidth) * 0.6))
    if (simplified.length < 2) continue
    features.push({
      type: 'cliff',
      isomCode: '203',
      coordinates: simplified,
    })
  }
  return features
}

/** Morphological close (dilate + erode) på binær mask, 3x3-kjerne. */
function morphClose(mask, cols, rows) {
  const dilated = new Uint8Array(mask.length)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      if (mask[i]) { dilated[i] = 1; continue }
      let any = 0
      for (let dy = -1; dy <= 1 && !any; dy++) {
        for (let dx = -1; dx <= 1 && !any; dx++) {
          const ny = y + dy, nx = x + dx
          if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) continue
          if (mask[ny * cols + nx]) any = 1
        }
      }
      dilated[i] = any
    }
  }
  const closed = new Uint8Array(mask.length)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      if (!dilated[i]) { closed[i] = 0; continue }
      let all = 1
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1 && all; dx++) {
          const ny = y + dy, nx = x + dx
          if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) { all = 0; break }
          if (!dilated[ny * cols + nx]) all = 0
        }
      }
      closed[i] = all
    }
  }
  return closed
}

/**
 * Generer en plausible synthetic DEM for testing. Lager en bbox-fyllende
 * grid med en eller flere "topper" som ligner Vardåsen-topografi.
 *
 * @param {number} widthM
 * @param {number} heightM
 * @param {AffineTransform} transform
 * @param {Array<{x:number,y:number,h:number,sigma:number}>} peaks
 * @returns {DEM}
 */
export function syntheticDEM(widthM, heightM, transform, peaks = [], baseElevM = 50) {
  const cols = Math.round(widthM / Math.abs(transform.pixelWidth))
  const rows = Math.round(heightM / Math.abs(transform.pixelHeight))
  const data = new Float32Array(cols * rows)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let v = baseElevM
      const wx = col * Math.abs(transform.pixelWidth)
      const wy = row * Math.abs(transform.pixelHeight)
      for (const p of peaks) {
        // Gaussian peak
        const dx = wx - p.x
        const dy = wy - p.y
        v += p.h * Math.exp(-(dx * dx + dy * dy) / (2 * p.sigma * p.sigma))
      }
      // Litt støy for å unngå perfekt sirkulære konturer
      v += (Math.sin(wx * 0.05) * Math.cos(wy * 0.05)) * 1.5
      data[row * cols + col] = v
    }
  }
  return {
    data, cols, rows, transform, noData: -9999, resolution: Math.abs(transform.pixelWidth),
  }
}

/**
 * Konverter konturer fra `buildContours` til SVG-paths som kan settes
 * inn i en feature-graf eller direkte i et lag.
 *
 * @param {Array} contourFeatures
 * @param {(coords: Array<[number,number]>) => Array<[number,number]>} projectFn
 *        UTM → SVG-koord (y-flip + offset)
 */
export function contoursToSvgPaths(contourFeatures, projectFn) {
  const index = []   // hjelpekonturer
  const minor = []
  for (const f of contourFeatures) {
    const projected = f.coordinates.map(projectFn)
    const d = polylineToPath(projected, true)
    if (f.isIndex) index.push({ d, elevation: f.elevation })
    else           minor.push({ d, elevation: f.elevation })
  }
  return { index, minor }
}
