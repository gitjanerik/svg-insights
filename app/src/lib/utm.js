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
  const phi = lat * Math.PI / 180
  const lam = lon * Math.PI / 180
  const N = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2)
  const T = Math.tan(phi) ** 2
  const C = EP2 * Math.cos(phi) ** 2
  const Aa = (lam - LON0) * Math.cos(phi)

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
