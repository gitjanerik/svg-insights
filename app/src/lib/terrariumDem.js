// terrariumDem.js — global høyde-fyll fra AWS Terrain Tiles (Terrarium).
//
// HVORFOR: Kartverkets NHM_DTM dekker bare norsk territorium. Et kart som
// krysser riksgrensa (Børgefjell mot Sverige, Pasvik mot Finland/Russland)
// får derfor en «mur» av høydekurver langs grensa: cellene utenfor norsk
// dekning kommer tilbake enten som noData (-9999) eller som et lavt konstant
// fyll (~0 m). Det siste er gyldig-men-feil og lager en kunstig klippe
// (ekte terreng 600 m → 0 m) som marching squares stabler hver ekvidistanse
// oppå hverandre på. Resultat: en tett rosa vegg, ikke en fjellside.
//
// KILDE: AWS Terrain Tiles (https://registry.opendata.aws/terrain-tiles/),
// Terrarium-PNG-format. Global dekning (Norge OG Sverige sømløst), ingen
// nøkkel/konto, og verifisert `access-control-allow-origin: *` — så vi kan
// tegne flisene til canvas og lese pikslene uten at canvas blir «tainted».
// Oppløsningen er grovere enn Kartverkets 1 m LiDAR (~10–30 m i Norden), så
// vi bruker den KUN til å fylle hull/klipper — norsk terreng beholder sin
// fulle detalj.
//
// Terrarium-koding: høyde_m = (R*256 + G + B/256) - 32768.
//
// VIKTIG — PNG dekodes i REN JS, IKKE via canvas (v10.2.23): første versjon
// tegnet flisene til canvas og leste getImageData. Det ga terrasse-artefakter
// («sagtann»-vegger av stablede kurver + flate platåer i relieffet) på mobil:
// nettleserens bilde-dekoding kan kjøre fargerom-konvertering/-management på
// pikslene (typisk på wide-gamut-Android), og i Terrarium-koding er ±1 i
// RØD-kanalen ±256 METER. MapLibre omgår samme felle med createImageBitmap-
// opsjonene {premultiplyAlpha:'none', colorSpaceConversion:'none'}, men de
// respekteres ikke overalt — så vi parser PNG-en selv (IDAT er zlib; native
// DecompressionStream) og er bit-eksakte på alle plattformer. Verifisert:
// samme data gjennom ren-JS-dekoding ga rene, glatte grensekryssende kurver.
//
// STRATEGI (gated så innlands full-dekning er byte-identisk):
//   1. detectTerrariumTrigger: finnes noData ELLER et stort ~0 m-felt mot
//      ellers høyt terreng? Nei → ingen henting, DEM uendret.
//   2. Ja → hent Terrarium-fliser over bbox, bygg en sampler.
//   3. fillDemCells: bytt ut suspekte celler (noData, eller v≤1 m der
//      Terrarium sier ≥ CLIFF_GAP_M høyere) med Terrarium-høyde. Ekte sjø/
//      innsjø (Terrarium ~0 der óg) og ekte norsk terreng røres ikke.

import { utm32ToWgs84 } from './utm.js'

const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const TILE_PX = 256
const EARTH_CIRC = 40075016.686

// Terskler for trigger + erstatning. Konservative med vilje: en ekte celle
// skal aldri byttes ut.
const SUSPECT_LOW_M = 1.0        // celle ≤ dette = «mistenkelig lav»
const NEAR_ZERO_FRAC = 0.02      // ≥ 2 % ~0 m-celler trigger henting …
const CLIFF_MIN_TERRAIN_M = 120  // … men kun når kartet ellers har høyt terreng
const CLIFF_GAP_M = 30           // bytt 0-celle kun om Terrarium er ≥ 30 m høyere

// ── Rene funksjoner (enhetstestet) ────────────────────────────────────────

/** Dekod én Terrarium-RGB-trippel til meter. */
export function terrariumElevation(r, g, b) {
  return (r * 256 + g + b / 256) - 32768
}

/** Dekod en RGBA-buffer (Uint8ClampedArray, lengde = px*px*4) til Float32Array. */
export function decodeTerrariumRGBA(rgba, px = TILE_PX) {
  const out = new Float32Array(px * px)
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = terrariumElevation(rgba[j], rgba[j + 1], rgba[j + 2])
  }
  return out
}

// ── Minimal PNG-dekoder (bit-eksakt, ingen canvas/fargerom) ────────────────
// Dekker det Terrarium-fliser faktisk er: 8-bit RGB (type 2) / RGBA (type 6),
// ikke-interlaced, alle 5 scanline-filtre. Alt annet → kast (flisen droppes
// og cellene forblir ufylt — aldri verre enn før). CRC verifiseres ikke.

/** PNG-scanline-unfilter (ren funksjon, enhetstestet). raw = inflatet IDAT. */
export function unfilterScanlines(raw, width, height, channels) {
  const stride = width * channels
  const out = new Uint8Array(stride * height)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    const row = y * stride
    const prev = row - stride
    for (let x = 0; x < stride; x++) {
      const rv = raw[rp + x]
      const a = x >= channels ? out[row + x - channels] : 0
      const b = y > 0 ? out[prev + x] : 0
      const c = (x >= channels && y > 0) ? out[prev + x - channels] : 0
      let v
      switch (filter) {
        case 0: v = rv; break
        case 1: v = rv + a; break
        case 2: v = rv + b; break
        case 3: v = rv + ((a + b) >> 1); break
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
          v = rv + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: throw new Error(`PNG-filter ${filter} ustøttet`)
      }
      out[row + x] = v & 0xff
    }
    rp += stride
  }
  return out
}

async function inflateZlib(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Parse + dekod en PNG-fil til { width, height, channels, pixels }. */
export async function decodePng(buf) {
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('ikke PNG')
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let off = 8
  let width = 0, height = 0, channels = 0
  const idat = []
  while (off + 8 <= buf.length) {
    const len = dv.getUint32(off)
    const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7])
    if (type === 'IHDR') {
      width = dv.getUint32(off + 8)
      height = dv.getUint32(off + 12)
      const bitDepth = buf[off + 16], colorType = buf[off + 17], interlace = buf[off + 20]
      if (bitDepth !== 8) throw new Error(`PNG bitDepth ${bitDepth} ustøttet`)
      if (colorType === 2) channels = 3
      else if (colorType === 6) channels = 4
      else throw new Error(`PNG colorType ${colorType} ustøttet`)
      if (interlace !== 0) throw new Error('interlaced PNG ustøttet')
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(off + 8, off + 8 + len))
    } else if (type === 'IEND') break
    off += 12 + len
  }
  if (!width || !channels || idat.length === 0) throw new Error('ufullstendig PNG')
  const total = idat.reduce((s, d) => s + d.length, 0)
  const z = new Uint8Array(total)
  let p = 0
  for (const d of idat) { z.set(d, p); p += d.length }
  const raw = await inflateZlib(z)
  const expected = height * (1 + width * channels)
  if (raw.length < expected) throw new Error(`PNG-data for kort (${raw.length} < ${expected})`)
  return { width, height, channels, pixels: unfilterScanlines(raw, width, height, channels) }
}

/** Dekod PNG-piksler (3 eller 4 kanaler) til Terrarium-høyder. */
export function decodeTerrariumPixels(pixels, channels, count) {
  const out = new Float32Array(count)
  for (let i = 0, j = 0; i < count; i++, j += channels) {
    out[i] = terrariumElevation(pixels[j], pixels[j + 1], pixels[j + 2])
  }
  return out
}

/** Velg zoom så én Terrarium-piksel ≈ DEM-oppløsningen ved gitt breddegrad. */
export function chooseTerrariumZoom(lat, resM) {
  const mppEquator = EARTH_CIRC / TILE_PX            // m/px ved z0, ekvator
  const target = (mppEquator * Math.cos(lat * Math.PI / 180)) / Math.max(1, resM)
  const z = Math.round(Math.log2(target))
  return Math.max(8, Math.min(14, z))
}

/** lon → global piksel-X (Web Mercator) ved zoom z. */
export function lonToGlobalPx(lon, z) {
  return ((lon + 180) / 360) * (2 ** z) * TILE_PX
}

/** lat → global piksel-Y (Web Mercator) ved zoom z. */
export function latToGlobalPx(lat, z) {
  const r = lat * Math.PI / 180
  const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2
  return y * (2 ** z) * TILE_PX
}

/**
 * Bygg en nearest-neighbour sampler over et sett dekodede fliser.
 * @param {Map<string,Float32Array>} tiles  nøkkel `${z}/${x}/${y}`
 * @param {number} z
 * @returns {(lat:number, lon:number) => (number|null)}
 */
export function makeSampler(tiles, z) {
  return (lat, lon) => {
    const gx = lonToGlobalPx(lon, z)
    const gy = latToGlobalPx(lat, z)
    const tx = Math.floor(gx / TILE_PX)
    const ty = Math.floor(gy / TILE_PX)
    const tile = tiles.get(`${z}/${tx}/${ty}`)
    if (!tile) return null
    let px = Math.floor(gx - tx * TILE_PX)
    let py = Math.floor(gy - ty * TILE_PX)
    if (px < 0) px = 0; else if (px > TILE_PX - 1) px = TILE_PX - 1
    if (py < 0) py = 0; else if (py > TILE_PX - 1) py = TILE_PX - 1
    const v = tile[py * TILE_PX + px]
    return Number.isFinite(v) ? v : null
  }
}

/**
 * Avgjør om et DEM trenger Terrarium-fyll. Billig (ett gjennomløp), så det
 * gater den dyrere flis-hentingen. Full-dekning innlands-kart → trigger=false.
 */
export function detectTerrariumTrigger(dem) {
  const { data, cols, rows, noData } = dem
  let hasNoData = false
  let nearZero = 0
  let maxV = -Infinity
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (v === noData || !Number.isFinite(v) || v < -1000) { hasNoData = true; continue }
    if (v <= SUSPECT_LOW_M) nearZero++
    if (v > maxV) maxV = v
  }
  const nearZeroFrac = nearZero / (cols * rows)
  const trigger = hasNoData ||
    (nearZeroFrac > NEAR_ZERO_FRAC && maxV > CLIFF_MIN_TERRAIN_M)
  return { trigger, hasNoData, nearZeroFrac, maxV }
}

/**
 * Bytt suspekte celler med Terrarium-høyde via en injisert sampler.
 * Ren funksjon (ingen nett) → enhetstestbar. Returnerer SAMME dem-objekt
 * (referanse-identisk) hvis ingenting ble byttet, så uendrede kart er
 * byte-identiske nedstrøms.
 *
 * @param {DEM} dem
 * @param {{minE,minN,maxE,maxN}} utmBbox  samme extent som dem-griddet
 * @param {(lat:number,lon:number)=>(number|null)} sample
 */
export function fillDemCells(dem, utmBbox, sample) {
  const { data, cols, rows, transform, noData } = dem
  const out = Float32Array.from(data)
  // Void-masken bevarer HVILKE celler som manglet Kartverket-data FØR fylling.
  // På kystkart er slike celler sjø (ingen LiDAR-retur over vann), og
  // Terrarium kan fylle dem med grov global LANDhøyde i smale sund — sjø-
  // deteksjonen (seaFromDem.js) trenger den opprinnelige void-statusen for å
  // kunne åpne sundet igjen. Konturer/relieff bruker de fylte verdiene som før.
  const voidMask = new Uint8Array(data.length)
  let replaced = 0
  for (let row = 0; row < rows; row++) {
    const northing = utmBbox.maxN - (row + 0.5) * transform.pixelHeight
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      const v = data[i]
      const isVoid = v === noData || !Number.isFinite(v) || v < -1000
      if (isVoid) voidMask[i] = 1
      const isCliffLow = !isVoid && v <= SUSPECT_LOW_M
      if (!isVoid && !isCliffLow) continue
      const easting = utmBbox.minE + (col + 0.5) * transform.pixelWidth
      const { lat, lon } = utm32ToWgs84(easting, northing)
      const t = sample(lat, lon)
      if (t == null || !Number.isFinite(t)) continue
      if (isVoid) { out[i] = t; replaced++ }
      else if (t - v >= CLIFF_GAP_M) { out[i] = t; replaced++ }
    }
  }
  if (replaced === 0) return { dem, filled: false, replaced: 0 }
  const source = dem.source ? `${dem.source} + Terrarium-fyll` : 'Terrarium-fyll'
  return { dem: { ...dem, data: out, source, voidMask }, filled: true, replaced }
}

// ── Nett-henting (ren JS-dekoding — se modul-kommentaren om canvas-fella) ──

// Per-flis-timeout: fyllet er en ren forbedring (trygg degradering), så én
// hengende flis skal ikke holde full-byggingen tilbake.
const TILE_TIMEOUT_MS = 8000

async function loadTerrariumTile(z, x, y, signal) {
  const url = `${TERRARIUM_URL}/${z}/${x}/${y}.png`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('Terrarium-flis-timeout', 'TimeoutError')), TILE_TIMEOUT_MS)
  const onAbort = () => ctrl.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    const png = await decodePng(new Uint8Array(await res.arrayBuffer()))
    if (png.width !== TILE_PX || png.height !== TILE_PX) return null
    return decodeTerrariumPixels(png.pixels, png.channels, TILE_PX * TILE_PX)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Hovedinngang: fyll Kartverket-DEM-ets hull/klipper fra Terrarium.
 * Trygg degradering — feiler henting, dekoding eller miljøstøtte, returneres
 * DEM-et uendret (kartet blir aldri verre enn før).
 *
 * @returns {Promise<{dem:DEM, filled:boolean, replaced:number}>}
 */
export async function fillDemVoidsFromTerrarium(dem, utmBbox, opts = {}) {
  const { signal } = opts
  if (!dem?.data) return { dem, filled: false, replaced: 0 }

  const { trigger } = detectTerrariumTrigger(dem)
  if (!trigger) return { dem, filled: false, replaced: 0 }

  // Miljø-guard: trenger fetch + DecompressionStream (alle moderne nettlesere
  // og Node 18+ — så fyllet virker også i CI-bygg). Mangler de → hopp over.
  if (typeof fetch !== 'function' || typeof DecompressionStream !== 'function') {
    return { dem, filled: false, replaced: 0 }
  }

  // bbox i lat/lon fra alle fire UTM-hjørner.
  const cs = [
    utm32ToWgs84(utmBbox.minE, utmBbox.minN),
    utm32ToWgs84(utmBbox.maxE, utmBbox.minN),
    utm32ToWgs84(utmBbox.minE, utmBbox.maxN),
    utm32ToWgs84(utmBbox.maxE, utmBbox.maxN),
  ]
  const latMin = Math.min(...cs.map(c => c.lat))
  const latMax = Math.max(...cs.map(c => c.lat))
  const lonMin = Math.min(...cs.map(c => c.lon))
  const lonMax = Math.max(...cs.map(c => c.lon))

  const resM = Math.max(dem.transform.pixelWidth, dem.transform.pixelHeight)
  const z = chooseTerrariumZoom((latMin + latMax) / 2, resM)

  const tx0 = Math.floor(lonToGlobalPx(lonMin, z) / TILE_PX)
  const tx1 = Math.floor(lonToGlobalPx(lonMax, z) / TILE_PX)
  const ty0 = Math.floor(latToGlobalPx(latMax, z) / TILE_PX)  // nord = mindre y
  const ty1 = Math.floor(latToGlobalPx(latMin, z) / TILE_PX)

  const want = []
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) want.push([tx, ty])
  }
  if (want.length === 0 || want.length > 64) {
    // Tomt eller urimelig mange fliser (skadet bbox) → ikke risiker en storm.
    return { dem, filled: false, replaced: 0 }
  }

  const tiles = new Map()
  await Promise.all(want.map(async ([tx, ty]) => {
    try {
      const arr = await loadTerrariumTile(z, tx, ty, signal)
      if (arr) tiles.set(`${z}/${tx}/${ty}`, arr)
    } catch { /* enkelt-flis-feil ignoreres → sampler gir null der */ }
  }))
  if (tiles.size === 0) return { dem, filled: false, replaced: 0 }

  return fillDemCells(dem, utmBbox, makeSampler(tiles, z))
}
