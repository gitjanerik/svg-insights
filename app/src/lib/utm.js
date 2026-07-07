// WGS84 ↔ UTM 32N (EPSG:25832-kompatibel ved disse breddegradene).
// Avviket WGS84 vs ETRS89 er <1 m for Norge — godt nok for visning.

const A = 6378137
const F = 1 / 298.257223563
const K0 = 0.9996
const E2 = F * (2 - F)
const EP2 = E2 / (1 - E2)
const FALSE_EASTING = 500000
const ZONE = 32
const LON0 = ((ZONE * 6) - 183) * Math.PI / 180  // 9° for sone 32

export function wgs84ToUtm32(lat, lon) {
  return wgs84ToUtmZone(lat, lon, LON0)
}

// UTM 33N (EPSG:25833-kompatibel) — Vegvesenets Vegkart bruker sone 33 i
// kart-hashen sin (@easting,northing,zoom). Samme serie-formler, annen
// sentralmeridian (15°).
export function wgs84ToUtm33(lat, lon) {
  return wgs84ToUtmZone(lat, lon, ((33 * 6) - 183) * Math.PI / 180)
}

function wgs84ToUtmZone(lat, lon, lon0) {
  const phi = lat * Math.PI / 180
  const lam = lon * Math.PI / 180
  const N = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2)
  const T = Math.tan(phi) ** 2
  const C = EP2 * Math.cos(phi) ** 2
  const Aa = (lam - lon0) * Math.cos(phi)

  const M = A * (
    (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * phi
    - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * phi)
  )

  const easting = K0 * N * (
    Aa + (1 - T + C) * Aa ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120
  ) + FALSE_EASTING

  const northing = K0 * (M + N * Math.tan(phi) * (
    Aa ** 2 / 2
    + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720
  ))

  return { e: easting, n: northing }
}

// Akse-justert UTM 32N-bboks som omslutter HELE WGS84-bboksens lat/lon-rektangel.
// Bruker alle FIRE hjørner — ikke bare SW+NE-diagonalen — fordi UTM-rutenettet
// roterer ift. lat/lon (meridiankonvergens). Med bare to diagonale hjørner under-
// estimeres øst-vest-utstrekningen, så et kart som er kvadratisk i bakke-avstand
// (det velgeren viser) ble rendret PORTRETT (smalere enn høyt), økende vekk fra
// sentralmeridianen og mot polene (Oslo ~5 %, Tromsø ~28 %). Fire hjørner gir et
// tilnærmet kvadratisk meter-rom for en kvadratisk bbox. (v10.1.x)
export function utm32BboxFromWgs84(bbox) {
  const corners = [
    wgs84ToUtm32(bbox.south, bbox.west),
    wgs84ToUtm32(bbox.south, bbox.east),
    wgs84ToUtm32(bbox.north, bbox.west),
    wgs84ToUtm32(bbox.north, bbox.east),
  ]
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
  for (const p of corners) {
    if (p.e < minE) minE = p.e
    if (p.e > maxE) maxE = p.e
    if (p.n < minN) minN = p.n
    if (p.n > maxN) maxN = p.n
  }
  return { minE, maxE, minN, maxN }
}

// Gitt UTM-bbox lagret i kartets metadata, regn om en posisjon
// til SVG-koordinater (1 SVG-enhet = 1 m, y-aksen flippet).
export function utmToSvg(utm, meta) {
  return {
    x: utm.e - meta.minE,
    y: meta.heightM - (utm.n - meta.minN),
  }
}

export function wgs84ToSvg(lat, lon, meta) {
  return utmToSvg(wgs84ToUtm32(lat, lon), meta)
}

// Inverse — UTM 32N → WGS84.
//
// v12.1.52: Snyder-serien alene DIVERGERER langt fra sentralmeridianen —
// roundtrip-feilen er ~0 ved Oslo, men ~18 m i Alta, ~310 m i Kirkenes og
// ~440 m i Vardø (Δλ = 21–22° fra 9°E, langt utenfor serienes gyldighets-
// område på ±3–4°). Forward-serien holder seg derimot god (< 6 m selv i
// Vardø). Symptom i felt: Terrarium-fyllet samplet høyder ~300 m øst for
// riktig posisjon i Kirkenes → DEM-kystlinjen forskjøvet mot OSM-data
// (naturreservat-grensa), og Overpass-bboksen (utledet via inversen) mistet
// en ~300 m-stripe i vest. Fiks: bruk serien som startgjett og iterér mot
// vår EGEN forward til residualen er < 1 mm — inversen er da per definisjon
// konsistent med forward i hele sone-utvidelsen vi bruker (5–31°E).
// Residualen roteres med meridiankonvergensen γ ≈ (λ−λ0)·sin(φ) (opptil
// ~20° i Øst-Finnmark) før grader↔meter-skalering — uten rotasjonen
// kontraherer iterasjonen bare ~0.36 pr steg der; med den konvergerer
// selv Vardø på ~4 iterasjoner (1–2 innenfor normal sonebredde).
export function utm32ToWgs84(e, n) {
  let { lat, lon } = utm32ToWgs84Series(e, n)
  for (let i = 0; i < 25; i++) {
    const p = wgs84ToUtm32(lat, lon)
    const dE = e - p.e
    const dN = n - p.n
    if (Math.abs(dE) < 1e-3 && Math.abs(dN) < 1e-3) break
    const g = (lon * Math.PI / 180 - LON0) * Math.sin(lat * Math.PI / 180)
    const cg = Math.cos(g), sg = Math.sin(g)
    lat += (dN * cg - dE * sg) / 111132
    lon += (dE * cg + dN * sg) / (111320 * Math.cos(lat * Math.PI / 180))
  }
  return { lat, lon }
}

function utm32ToWgs84Series(e, n) {
  const x = e - FALSE_EASTING
  const y = n
  const M = y / K0
  const mu = M / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256))
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2))
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu)
  const C1 = EP2 * Math.cos(phi1) ** 2
  const T1 = Math.tan(phi1) ** 2
  const N1 = A / Math.sqrt(1 - E2 * Math.sin(phi1) ** 2)
  const R1 = A * (1 - E2) / (1 - E2 * Math.sin(phi1) ** 2) ** 1.5
  const D = x / (N1 * K0)

  const phi = phi1 - (N1 * Math.tan(phi1) / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720
  )

  const lam = LON0 + (
    D
    - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120
  ) / Math.cos(phi1)

  return { lat: phi * 180 / Math.PI, lon: lam * 180 / Math.PI }
}

// Inverse av utmToSvg + utm32ToWgs84 — SVG-koordinater til WGS84.
export function svgToWgs84(x, y, meta) {
  const e = x + meta.minE
  const n = meta.minN + (meta.heightM - y)
  return utm32ToWgs84(e, n)
}
