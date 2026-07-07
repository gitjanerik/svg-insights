// Sjø-deteksjon fra Kartverket DTM (NHM_DTM_25832).
//
// DTM-en gir bakken-overflate i meter over havet. Kartverket-konvensjonen er
// at havflaten ligger på 0 m og at sjø-piksler returneres med høyde nær null
// (eller nodata utenfor land-dekning). Vi utnytter dette til å avlede en
// pålitelig sjø-maske direkte fra DEM-rasteret som allerede er hentet —
// uten å være avhengig av N50 WFS (CORS-fragilt klient-side) eller
// OSM Oslofjord-relations (kan timeout for store relations).
//
// Strategi:
//   1. Inverter DEM-verdiene så sjø (≈ 0) blir høy og land blir negativ.
//   2. Marching squares (d3-contour) ved threshold = −thresholdM gir ringer
//      som omslutter områder under havnivå-toleransen.
//   3. NoData-piksler maskes som dypt-negativ → ute av sjø-polygonet.
//
// Returnerer polygoner i DEM-relative meters (samme koordinatrom som
// `buildContours`-output), klare til å rendres direkte i SVG.

import { contours as d3Contours } from 'd3-contour'
import { simplifyDP, chaikin } from './pathUtils.js'

// Glatt en (lukket) ring så sjø-/dybde-grenser bukter seg som høydekurver
// istedenfor å stå med harde, rette marching-squares-streker. Samme oppskrift
// som buildContours: DP-forenkling → Chaikin corner-cutting → lett final-DP.
// Vannflaten er en kunstig snitt-flate gjennom geologien — den skal følge
// terrenget mykt, ikke vises som et polygon-raster.
function smoothRing(ring, simplifyM) {
  let r = ring
  if (simplifyM > 0 && r.length > 4) r = simplifyDP(r, simplifyM)
  // Chaikin(closed) forventer ingen duplisert slutt-node; d3-contour lukker
  // ringene (siste == første), så vi dropper duplikatet først.
  if (r.length > 1) {
    const f = r[0], l = r[r.length - 1]
    if (f[0] === l[0] && f[1] === l[1]) r = r.slice(0, -1)
  }
  if (r.length >= 3) r = chaikin(r, 2, true)
  if (r.length > 4) r = simplifyDP(r, Math.max(0.5, simplifyM * 0.5))
  return r
}

// Void-celler (noData i Kartverket-WCS) er tvetydige: over vann mangler
// LiDAR-retur (→ sjø), på grensekart mangler norsk dekning (→ utenlandsk
// land). Terrarium-fyllet (terrariumDem.js) kan dessuten ha overskrevet
// void-celler med grov global LANDhøyde — i smale sund (Grønnsund, Nesøya)
// klemmer det sjø-masken igjen selv om cellene aldri var målt land.
//
// Diskriminator: en void-celle som er grid-forbundet (4-naboskap) med ekte
// havflate-celler (≤ thresholdM) er vann. Flood-fill fra havflaten vokser
// gjennom void-celler; nådde voids behandles som 0 m (sjø-kandidat), unådde
// forblir land. Gjennom Terrarium-FYLTE voids vokser flommen bare når den
// fylte verdien er ≤ voidSeaMaxM — Terrarium interpolerer bankhøyde (noen få
// til ~20 m) over et sund, mens ekte utenlandsk terreng stiger raskt forbi
// grensen. Det hindrer at lavlandet på svensk side av Iddefjorden flommes.
//
// Returnerer Uint8Array (1 = void nådd fra havflaten), eller null når
// gridet ikke har void-celler (vanlige innlandskart → null, null overhead).
function findSeaConnectedVoids(data, cols, rows, noData, thresholdM, voidMask, voidSeaMaxM) {
  const n = data.length
  const rawVoid = (i) => {
    const v = data[i]
    return v === noData || !Number.isFinite(v) || v < -1000
  }
  // Passerbar = void-celle flommen kan vokse gjennom. Celler som allerede
  // leser ≤ thresholdM er sjø-frø uansett maske (Terrarium fylte med 0 m).
  const passable = new Uint8Array(n)
  let hasPassable = false
  for (let i = 0; i < n; i++) {
    const raw = rawVoid(i)
    if (!raw && !(voidMask && voidMask[i] === 1)) continue
    if (!raw && data[i] <= thresholdM) continue
    if (!raw && data[i] > voidSeaMaxM) continue
    passable[i] = 1
    hasPassable = true
  }
  if (!hasPassable) return null

  const reached = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0, tail = 0
  for (let i = 0; i < n; i++) {
    if (passable[i] || rawVoid(i)) continue
    if (data[i] <= thresholdM) queue[tail++] = i
  }
  while (head < tail) {
    const i = queue[head++]
    const x = i % cols
    if (x > 0 && passable[i - 1] && !reached[i - 1]) { reached[i - 1] = 1; queue[tail++] = i - 1 }
    if (x < cols - 1 && passable[i + 1] && !reached[i + 1]) { reached[i + 1] = 1; queue[tail++] = i + 1 }
    if (i >= cols && passable[i - cols] && !reached[i - cols]) { reached[i - cols] = 1; queue[tail++] = i - cols }
    if (i < n - cols && passable[i + cols] && !reached[i + cols]) { reached[i + cols] = 1; queue[tail++] = i + cols }
  }
  return reached
}

/**
 * @param {{ data: Float32Array|Array<number>, cols: number, rows: number,
 *           transform: { pixelWidth: number, pixelHeight: number,
 *                       originX: number, originY: number },
 *           noData: number }} dem
 * @param {object} [opts]
 * @param {number} [opts.thresholdM=0.5]  Høyde-toleranse for sjø-deteksjon
 * @param {number} [opts.minAreaM2=2000]  Minimum sjø-polygon areal
 * @param {number} [opts.simplifyM=2]     DP-forenkling toleranse
 * @param {boolean} [opts.requireBoundaryTouch=true]
 *   Hvis true: bare polygoner som berører bbox-kanten beholdes. Sjø er per
 *   definisjon åpent vann og rører alltid bbox-kanten i en kyst-bbox.
 *   Innsjøer/tjern som ligger lavt over havet (slik at DTM-verdien er nær
 *   0) ville ellers feilaktig bli klassifisert som sjø.
 * @param {Uint8Array|null} [opts.voidMask]
 *   1 = cellen var noData FØR Terrarium-fyll (se fillDemCells). Faller
 *   tilbake til dem.voidMask. Void-celler forbundet med havflaten regnes
 *   som sjø — se findSeaConnectedVoids.
 * @param {number} [opts.voidSeaMaxM=30]
 *   Maks fylt høyde flood-fillen vokser gjennom i Terrarium-fylte voids.
 * @returns {{ polygons: Array<Array<Array<[number, number]>>> }}
 *          Hver polygon = array av ringer i DEM-relative meters.
 *          Første ring = outer, øvrige = øy-hull.
 */
export function buildSeaFromDem(dem, opts = {}) {
  const {
    thresholdM = 0.5,
    minAreaM2 = 2000,
    simplifyM = 2,
    requireBoundaryTouch = true,
    voidMask = dem.voidMask ?? null,
    voidSeaMaxM = 30,
  } = opts
  const { data, cols, rows, transform, noData } = dem

  const seaVoids = findSeaConnectedVoids(data, cols, rows, noData, thresholdM, voidMask, voidSeaMaxM)

  // v12.1.53: kontur-feltet KLIPPES ved 2×terskel. Uklippet la marching
  // squares sjø/land-krysningen nesten inntil sjø-cella: lineær interpolasjon
  // mellom sjø (0 m) og en landcelle på f.eks. 5 m krysser terskelen (0.5 m)
  // bare 10 % ut i celle-gapet — nesten hele gapet ble land. Det ga en
  // systematisk land-dilasjon på ~0.4 celle (8 m ved 20 m-DEM) langs HELE
  // kysten, synlig som «forskyvning» mot OSM-baserte lag som naturreservat-
  // grenser (rapportert Kirkenes/Prestøya). Med land klippet til 2×terskel
  // (1 m) ligger krysningen midt mellom celle-sentrene — beste estimat uten
  // finere data. Celler med ekte verdi mellom terskel og 2×terskel beholder
  // proporsjonal plassering (klippen endrer bare verdier OVER 2×terskel, som
  // uansett er utenfor sjøen). Topologien er uendret — kun kant-plassering.
  const landClampM = thresholdM * 2
  let hasSea = false
  const inverted = new Array(data.length)
  for (let i = 0; i < data.length; i++) {
    if (seaVoids && seaVoids[i]) {
      inverted[i] = 0 // void nådd fra havflaten → sjø-kandidat (0 m)
      continue
    }
    const v = data[i]
    if (v === noData || !Number.isFinite(v)) {
      inverted[i] = -landClampM // unådd void = land; midtpunkt-kant som ellers
      continue
    }
    inverted[i] = -Math.min(v, landClampM)
    if (v <= thresholdM) hasSea = true
  }

  if (!hasSea) return { polygons: [] }

  const levels = d3Contours()
    .size([cols, rows])
    .thresholds([-thresholdM])(inverted)

  if (!levels.length) return { polygons: [] }

  const px = transform.pixelWidth
  const py = transform.pixelHeight
  const maxX = cols * px
  const maxY = rows * py
  // Toleranse: 1 piksel pluss litt slack siden d3-contour kan returnere
  // koord på 0.5-piksel-grid.
  const edgeTol = Math.max(px, py) * 1.5
  const touchesEdge = (ring) => {
    for (const [x, y] of ring) {
      if (x <= edgeTol || y <= edgeTol || x >= maxX - edgeTol || y >= maxY - edgeTol) {
        return true
      }
    }
    return false
  }

  const polygons = []

  for (const poly of levels[0].coordinates) {
    const rawRings = poly.map(ring =>
      ring.map(([col, row]) => [col * px, row * py])
    )
    // Outer ring = first; må berøre bbox-kanten for å være ekte sjø
    if (requireBoundaryTouch && rawRings.length > 0 && !touchesEdge(rawRings[0])) {
      continue
    }
    const rings = []
    for (let r = 0; r < rawRings.length; r++) {
      const ring = smoothRing(rawRings[r], simplifyM)
      if (ring.length < 3) continue
      if (Math.abs(signedArea(ring)) < minAreaM2) continue
      rings.push(ring)
    }
    if (rings.length > 0) polygons.push(rings)
  }

  return { polygons }
}

function signedArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  }
  return a / 2
}
/**
 * Generer grunne-sjø-bånd basert på avstand fra kystlinjen. Bruker en
 * chamfer 3-4 distance-transform på DEM-griden: hver sjø-piksel får
 * tildelt sin avstand til nærmeste land-piksel. Marching squares ved
 * spesifikke avstand-thresholds gir polygoner per dybde-bånd.
 *
 * Returnerer band-objekter sortert fra GRUNNEST (nærmest land) til
 * DYPEST (lengst fra land). Bånd rendret i denne rekkefølgen lag-på-lag
 * gir gradient-effekten (grunnest overstyrer ved kysten).
 *
 * @param {object} dem
 * @param {object} [opts]
 * @param {number} [opts.thresholdM=0.5]  Samme som buildSeaFromDem
 * @param {number[]} [opts.bandDistancesM=[50, 200]]
 *   Avstand-thresholds i meter. Default gir 3 bånd: 0-50, 50-200, 200+.
 *   Lengde N gir N+1 bånd inkludert basis-sjø.
 * @param {number} [opts.simplifyM=2]
 * @returns {{ bands: Array<{ maxDistanceM: number|null,
 *                            polygons: Array<Array<Array<[number, number]>>> }>
 *          }}
 *   `maxDistanceM === null` markerer det dypeste båndet (alle sjø-piksler).
 */
export function buildSeaShallowBands(dem, opts = {}) {
  const {
    thresholdM = 0.5,
    bandDistancesM = [50, 200],
    simplifyM = 2,
    voidMask = dem.voidMask ?? null,
    voidSeaMaxM = 30,
  } = opts
  const { data, cols, rows, transform, noData } = dem
  const px = transform.pixelWidth
  const py = transform.pixelHeight

  const seaVoids = findSeaConnectedVoids(data, cols, rows, noData, thresholdM, voidMask, voidSeaMaxM)

  // 1. Bygg sjø-mask: 1 = sjø, 0 = land/nodata. Voids forbundet med
  // havflaten regnes som sjø (samme regel som buildSeaFromDem, så grunn-
  // båndene følger den samme kystlinjen).
  const sea = new Uint8Array(data.length)
  let hasSea = false
  for (let i = 0; i < data.length; i++) {
    if (seaVoids && seaVoids[i]) {
      sea[i] = 1
      hasSea = true
      continue
    }
    const v = data[i]
    if (v === noData || !Number.isFinite(v) || v > thresholdM) continue
    sea[i] = 1
    hasSea = true
  }
  if (!hasSea) return { bands: [] }

  // 2. Chamfer 3-4 distance transform.
  // dist[i] = chamfer-units til nærmeste land-piksel. Tre chamfer-units per
  // ortho-piksel; del med 3 og gang med pixel-meter for ekte distanse.
  const INF = 1e9
  const dist = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) dist[i] = sea[i] ? INF : 0

  // Forward pass
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      if (dist[i] === 0) continue
      let m = dist[i]
      if (x > 0)              m = Math.min(m, dist[i - 1] + 3)
      if (y > 0)              m = Math.min(m, dist[i - cols] + 3)
      if (x > 0 && y > 0)     m = Math.min(m, dist[i - cols - 1] + 4)
      if (x < cols - 1 && y > 0) m = Math.min(m, dist[i - cols + 1] + 4)
      dist[i] = m
    }
  }
  // Backward pass
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x
      if (dist[i] === 0) continue
      let m = dist[i]
      if (x < cols - 1) m = Math.min(m, dist[i + 1] + 3)
      if (y < rows - 1) m = Math.min(m, dist[i + cols] + 3)
      if (x < cols - 1 && y < rows - 1) m = Math.min(m, dist[i + cols + 1] + 4)
      if (x > 0 && y < rows - 1)        m = Math.min(m, dist[i + cols - 1] + 4)
      dist[i] = m
    }
  }

  // 3. Konverter chamfer-units → meter (gjennomsnitt av pixel-bredde og høyde)
  const pixSize = (Math.abs(px) + Math.abs(py)) / 2
  const distM = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) {
    // Land = 0, sjø = chamfer/3 * pixSize. For land setter vi en stor verdi
    // så d3-contour ikke ser det som "inni" sjø-omslutningen — vi ønsker
    // grunn-bånd som ringer rundt land, ikke at land selv er inkludert.
    distM[i] = sea[i] ? (dist[i] / 3) * pixSize : -1e6
  }

  // 4. For hvert bånd-threshold: generer ringer for området med distM <= T.
  // d3-contour returnerer polygoner med value ≥ threshold, så vi inverterer:
  // negVal = -distM, threshold = -bandThreshold → polygoner der distM ≤ bandThreshold.
  const negDist = Array.from(distM, v => v <= -1e5 ? -1e9 : -v)

  const bands = []
  for (const bandT of bandDistancesM) {
    const levels = d3Contours()
      .size([cols, rows])
      .thresholds([-bandT])(negDist)
    const polygons = []
    if (levels.length) {
      for (const poly of levels[0].coordinates) {
        const rings = []
        for (const ring of poly) {
          const projected = smoothRing(ring.map(([col, row]) => [col * px, row * py]), simplifyM)
          if (projected.length < 3) continue
          rings.push(projected)
        }
        if (rings.length) polygons.push(rings)
      }
    }
    bands.push({ maxDistanceM: bandT, polygons })
  }

  return { bands }
}
