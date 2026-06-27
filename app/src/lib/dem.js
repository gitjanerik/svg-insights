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
 * Fyll noData-celler før marching squares.
 *
 * Kartverket-DTM-en markerer dekningsfri/utenfor-modell (og sjø-fyll) som
 * noData (-9999, se demFetcher). Når DEM-et har slike celler i periferien —
 * typisk auto-kart som er scrollet inn i et hjørne med delvis WCS-dekning, der
 * flis-cachen attpåtil kan ha lagret noData-fliser — gir buildContours en
 * konsentrisk «blink» av høydekurver rundt hver noData-klynge: -9999 ligger
 * langt under terrenget, så HVER terskel (40, 60, … 200 m) krysser
 * -9999↔terreng-spranget og legger en ring. Det er de røde sirklene i
 * kartutsnittets periferi.
 *
 * Fiks: dilatér gyldige verdier inn i noData-cellene (snitt av 4-naboer,
 * vekslende scan-retning så fyllet propagerer jevnt fra alle kanter). Resultatet
 * er en glatt flate uten -9999-klippe → ingen blink. Store void faller mot et
 * konstant snitt (flatt → ingen kurver). Ingen noData = uendret data-referanse,
 * så innlands-kart med full dekning er byte-identiske.
 *
 * @param {DEM} dem
 * @returns {{ data: Float32Array, hadNoData: boolean }}
 */
export function fillNoData(dem) {
  const { data, cols, rows, noData } = dem
  const out = Float32Array.from(data, v =>
    (v === noData || !Number.isFinite(v)) ? NaN : v)
  let remaining = 0
  for (let i = 0; i < out.length; i++) if (Number.isNaN(out[i])) remaining++
  if (remaining === 0) return { data, hadNoData: false }

  const total = out.length
  for (let iter = 0; remaining > 0 && iter < 80; iter++) {
    let filled = 0
    const fwd = (iter % 2) === 0   // alternér retning → jevn propagering
    for (let s = 0; s < total; s++) {
      const i = fwd ? s : total - 1 - s
      if (!Number.isNaN(out[i])) continue
      const x = i % cols, y = (i / cols) | 0
      let sum = 0, n = 0
      if (x > 0 && !Number.isNaN(out[i - 1])) { sum += out[i - 1]; n++ }
      if (x < cols - 1 && !Number.isNaN(out[i + 1])) { sum += out[i + 1]; n++ }
      if (y > 0 && !Number.isNaN(out[i - cols])) { sum += out[i - cols]; n++ }
      if (y < rows - 1 && !Number.isNaN(out[i + cols])) { sum += out[i + cols]; n++ }
      if (n > 0) { out[i] = sum / n; filled++ }
    }
    if (filled === 0) break   // isolert region uten gyldige naboer
    remaining -= filled
  }
  // Rest (stort indre void uten kant-kontakt innen iter-taket): globalt snitt.
  if (remaining > 0) {
    let sum = 0, n = 0
    for (let i = 0; i < total; i++) if (!Number.isNaN(out[i])) { sum += out[i]; n++ }
    const mean = n ? sum / n : 0
    for (let i = 0; i < total; i++) if (Number.isNaN(out[i])) out[i] = mean
  }
  return { data: out, hadNoData: true }
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
  const { cols, rows, transform, noData } = dem
  // Glatt ut noData FØR marching squares så periferien ikke får konsentriske
  // høydekurve-blink rundt -9999-klyngene (se fillNoData). Ingen noData → samme
  // array, og resten av funksjonen er uendret.
  const { data } = fillNoData(dem)

  // Periferi-maske (v9.3.37): fillNoData dilaterer gyldige verdier inn i
  // noData-voids ved snitt av naboer. Det fjerner blink-ringene, men når et
  // void ligger MELLOM to ulike-høye gyldige kanter (typisk delvis WCS-dekning
  // i kart-periferien) blir fyllet en kunstig RAMPE — og rampens konturer er
  // lange, nær-rette linjer som vifter ut mot hjørnene («periferifeilen»). Vi
  // bygger derfor en maske av ORIGINALE noData-celler og klipper bort
  // kontur-punkter som faller på dem: ringer splittes i åpne løp av ekte
  // punkter, så ekte konturer ved datagrensen beholdes mens void-rampens
  // spøkelseslinjer droppes. (v10.1.x: grid-ytterkanten klippes på samme måte —
  // se onEdge under — så også full-dekning-kart slipper kant-spaghettien fra
  // d3-contours kant-lukking.)
  const orig = dem.data
  const isVoid = new Uint8Array(orig.length)
  let voidCount = 0
  for (let i = 0; i < orig.length; i++) {
    if (orig[i] === noData || !Number.isFinite(orig[i])) { isVoid[i] = 1; voidCount++ }
  }
  const hasVoid = voidCount > 0
  // Et kontur-punkt ligger i grid-rom (col,row) mellom celler; regn det som
  // void hvis NOEN av de 4 omkransende originale cellene er void (1-celles
  // dilatasjon → ren klipping langs void-kanten, dropper også grense-blink).
  const pointInVoid = (col, row) => {
    const c0 = Math.max(0, Math.min(cols - 1, Math.floor(col)))
    const c1 = Math.max(0, Math.min(cols - 1, Math.ceil(col)))
    const r0 = Math.max(0, Math.min(rows - 1, Math.floor(row)))
    const r1 = Math.max(0, Math.min(rows - 1, Math.ceil(row)))
    return isVoid[r0 * cols + c0] || isVoid[r0 * cols + c1] ||
           isVoid[r1 * cols + c0] || isVoid[r1 * cols + c1]
  }
  // Grid-YTTERKANT (v10.1.x): d3-contour lukker konturer som forlater kartet
  // LANGS rute-kanten (col/row = 0 eller cols/rows). Disse kant-følgende
  // segmentene males ellers som falske, rette konturlinjer som bunter seg langs
  // kantene og spesielt i hjørnene — «kontur-spaghetti i periferien». De er en
  // ren artefakt (ikke ekte iso-linjer), så vi behandler ytterkant-punkter som
  // klippe-punkter på linje med void: ringen splittes, og det ekte indre løpet
  // beholdes som en åpen linje som ender ved kanten. Toleranse 1e-6 treffer KUN
  // den faktiske ytterkanten — indre celle-kryssinger ligger på heltalls col/row
  // > 0 og berøres ikke.
  const EDGE = 1e-6
  const onEdge = (col, row) =>
    col <= EDGE || col >= cols - EDGE || row <= EDGE || row >= rows - EDGE
  const pointClipped = (col, row) => onEdge(col, row) || (hasVoid && pointInVoid(col, row))
  // Splitt en (lukket) d3-ring i segmenter av sammenhengende ekte punkter.
  // Helt-ekte ring → ett lukket segment (uendret). Ellers åpne løp; ringen er
  // syklisk, så vi starter ved en void-celle og samler ikke-void-løp.
  const splitRingByClip = (ring) => {
    const n = ring.length
    if (n < 2) return []
    const flags = new Array(n)
    let anyClipped = false
    for (let i = 0; i < n; i++) { flags[i] = pointClipped(ring[i][0], ring[i][1]); if (flags[i]) anyClipped = true }
    if (!anyClipped) return [{ pts: ring, closed: true }]
    // Syklisk: dropp duplikat siste punkt (d3-ringer er lukket, first==last).
    const last = ring[n - 1], first = ring[0]
    const uniqN = (last[0] === first[0] && last[1] === first[1]) ? n - 1 : n
    let start = 0
    while (start < uniqN && !flags[start]) start++
    if (start === uniqN) return [{ pts: ring, closed: true }]  // ingen void blant unike
    const runs = []
    let cur = []
    for (let k = 1; k <= uniqN; k++) {
      const i = (start + k) % uniqN
      if (flags[i]) { if (cur.length >= 2) runs.push({ pts: cur, closed: false }); cur = [] }
      else cur.push(ring[i])
    }
    if (cur.length >= 2) runs.push({ pts: cur, closed: false })
    return runs
  }

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
        // Klipp ringen mot void-masken (v9.3.37) OG grid-ytterkanten (v10.1.x).
        // Helt indre ring (ingen void/kant) → ett lukket segment, uendret.
        const segments = splitRingByClip(ring)
        for (const seg of segments) {
          const worldRing = seg.pts.map(p => gridToWorld(p, transform))
          // Min-lengde 4× ekvidistanse for å beholde lokale konturer i bratte
          // områder (stupkant-soner) og rundt små topper, men fortsatt fjerne
          // ren støy.
          if (polylineLength(worldRing) < intervalM * 4) continue
          // Mildere simplification (2.5m → 1.0m) bevarer nyanser i tette
          // kontur-regioner (bratte sider) uten å overdrive antall punkter.
          const simplified = simplifyDP(worldRing, 2.5)
          const smoothed = chaikin(simplified, 2, seg.closed)
          // v9.1.7: final DP 1.0 → 1.5 m. Chaikin 4-dobler punkttallet; en
          // strammere etter-DP kuttet for lite. 1.5 m = 0.15 mm @ 1:10 000 —
          // usynlig på en allerede glattet kurve, men færre path-punkter ⇒
          // lavere per-frame rasteriseringskost på de kontur-tunge S22-kartene.
          const final = simplifyDP(smoothed, 1.5)
          // Lukket ring trenger ≥4 punkter (areal); åpent løp ≥2 (linje).
          if (final.length < (seg.closed ? 4 : 2)) continue
          features.push({
            type: 'contour',
            isomCode: isIndex ? '102' : '101',
            elevation,
            isIndex,
            closed: seg.closed,
            coordinates: final,
          })
        }
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
          // gx/gy beholdes så et raster-lag kan plassere prikken som
          // DEM-grid-fraksjon (flukter med hillshade-bildet) uten å gå
          // veien om verdens-/viewBox-koordinater.
          features.push({ type: 'point', isomCode: '213', x: wx, y: wy, gx: x, gy: y, tpi: v })
        }
      }
    }
  }
  return features
}

/**
 * Detekter EKTE topper (lokale høyde-maksima) direkte fra DEM-en. I motsetning
 * til kontur-etiketter — som bare er ekvidistanse-tall langs en kurve og like
 * gjerne ligger midt i en li «på vei opp» mot noe høyere — er disse faktiske
 * topp-punkter: ingen celle innen `windowM` er høyere.
 *
 * Brukes som kilde for «topp»-søket på kart UTEN OSM-toppmarkører (typisk
 * høyfjell der få topper er navngitt i OSM). Returnerer punkter sortert på
 * høyde desc, maks `maxCount`.
 *
 *   - windowM:        radius (meter) en celle må være maks innenfor for å regnes
 *                     som topp. Styrer også min-avstand mellom to topper.
 *   - minProminenceM: toppen må stige minst så mye over det laveste i vinduet —
 *                     luker bort platå-/rygg-støy (der «ingen nabo er høyere»
 *                     ellers gjør hver flate-celle til en falsk topp).
 */
export function detectSummits(dem, { windowM = 250, minProminenceM = 15, maxCount = 60 } = {}) {
  const { data, cols, rows, transform, noData } = dem
  const cellSize = Math.abs(transform.pixelWidth) || 10
  const win = Math.max(2, Math.round(windowM / cellSize))
  const cand = []
  // Hopp over en `win`-bred kant-margin: en celle der vinduet stikker utenfor
  // griddet kan ikke bekreftes som maks (terrenget kan stige videre forbi
  // kartkanten — nettopp «på vei opp»-feilen). Krev fullt vindu i bounds.
  for (let y = win; y < rows - win; y++) {
    for (let x = win; x < cols - win; x++) {
      const c = data[y * cols + x]
      if (c === noData || !Number.isFinite(c)) continue
      let isMax = true
      let minNb = Infinity
      for (let dy = -win; dy <= win && isMax; dy++) {
        const yy = y + dy
        for (let dx = -win; dx <= win; dx++) {
          const xx = x + dx
          if (dx === 0 && dy === 0) continue
          const v = data[yy * cols + xx]
          if (v === noData || !Number.isFinite(v)) continue
          if (v > c) { isMax = false; break }
          if (v < minNb) minNb = v
        }
      }
      if (!isMax) continue
      // Platå/rygg-vakt: en ekte topp faller merkbart av mot vindus-kanten.
      if (!Number.isFinite(minNb) || (c - minNb) < minProminenceM) continue
      const [wx, wy] = gridToWorld([x, y], transform)
      cand.push({ x: wx, y: wy, gx: x, gy: y, ele: c })
    }
  }
  // Høyeste først, så grådig romlig dedup: like-høye nabo-maksima (platå-topp,
  // eller to celler i samme topp) kollapses til én innen `windowM`.
  cand.sort((a, b) => b.ele - a.ele)
  const minSep2 = (windowM * windowM)
  const kept = []
  for (const s of cand) {
    if (kept.every(k => (k.x - s.x) ** 2 + (k.y - s.y) ** 2 >= minSep2)) {
      kept.push(s)
      if (kept.length >= maxCount) break
    }
  }
  return kept
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
