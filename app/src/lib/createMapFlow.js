// createMapFlow.js — gjenbrukbar bygging av et nytt turkart fra ett senter-punkt.
//
// Pipeline-en speiler MapPickerView.generateMap() men er parametrisert slik at
// både picker-vyen og «lag kart der jeg er»-snarveiene (MapHomeView FAB,
// MapView FAB) kan kalle den med samme garanti for resultat. Endringer i
// hvordan kartet bygges skal komme her, ikke i view-en.
//
// Bruks-eksempel:
//   const { id } = await buildMapFromCenter({
//     center: { lat, lon, name: 'Min posisjon' },
//     halfKm: 2,
//     equidistanceM: 20,
//     navn: 'Min tur',
//     onProgress: (msg) => statusText.value = msg,
//   })
//   router.push({ name: 'kart-vis', params: { id } })

import { fetchOverpass, buildSvg, bboxFromCenter } from './mapBuilder.js'
import { fetchN50Water } from './n50Fetcher.js'
import { fetchSjokart, sjokartToElements } from './sjokartFetcher.js'
import { isOsmWaterSalty } from './symbolizer.js'
import { fetchDEM } from './demFetcher.js'
import { findHighestPoint, packDem } from './demSampling.js'
import { wgs84ToUtm32 } from './utm.js'
import { saveMap, generateMapId } from './mapStorage.js'

const EMPTY_SJOKART = {
  dybdeareal: [], dybdekontur: [], grunne: [], lanterne: [], dybdepunkt: [],
}

const SJOKART_TIMEOUT_MS = 8000

function hasNearSeaLevelPixels(dem) {
  if (!dem?.data) return false
  const { data, noData } = dem
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (v === noData || !Number.isFinite(v)) continue
    if (v <= 0.5) return true
  }
  return false
}

function withHardTimeout(promise, ms, fallback, label) {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      console.warn(`[${label}] timeout etter ${ms}ms — bruker fallback`)
      resolve(fallback)
    }, ms)
    promise.then(
      (v) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        console.warn(`[${label}] feilet: ${e?.message ?? e} — bruker fallback`)
        resolve(fallback)
      }
    )
  })
}

/**
 * Bygg, lagre og returnér en kart-entry. Kaster ved feil.
 *
 * @param {object} opts
 * @param {{lat:number, lon:number, name?:string}} opts.center
 * @param {number} opts.halfKm  — halv-bredde i km (kart blir 2*halfKm × 2*halfKm)
 * @param {number} opts.equidistanceM  — kontur-intervall
 * @param {string} opts.navn  — kartets navn
 * @param {(msg:string)=>void} [opts.onProgress]  — status-callback for UI
 */
export async function buildMapFromCenter({
  center,
  halfKm,
  equidistanceM,
  navn,
  onProgress = () => {},
}) {
  const bbox = bboxFromCenter(center.lat, center.lon, halfKm)
  const sizeKm = (halfKm * 2).toFixed(1)
  onProgress(`Henter kartdata for ${sizeKm} × ${sizeKm} km …`)

  // Beregn UTM-bbox tidlig så fetchDEM kan startes parallelt med
  // Overpass/N50 i stedet for å vente på dem (v8.10.18: sparer 3-10 s).
  const sw = wgs84ToUtm32(bbox.south, bbox.west)
  const ne = wgs84ToUtm32(bbox.north, bbox.east)
  const utmBbox = {
    minE: Math.min(sw.e, ne.e), maxE: Math.max(sw.e, ne.e),
    minN: Math.min(sw.n, ne.n), maxN: Math.max(sw.n, ne.n),
  }

  // Vann-strategi:
  //   - SJØ: DEM (Kartverket NHM_DTM_25832). 0 m elevasjon = sjø.
  //   - INNSJØ: N50 Innsjø + OSM natural=water.
  //   - SJØKART: kun kjørt når DEM viser at bbox faktisk har piksler nær
  //     havflaten (≤ 0.5 m). For innlands-bbox er Sjøkart-WFS overflødig
  //     og kostet 2-10 s ekstra per kart-bygg. v8.10.18: gating fra DEM
  //     droppe Sjøkart-fetch helt når den ikke gir verdi.
  //
  // Perf-strategi:
  //   - Overpass, N50 og DEM kjøres parallelt fra start.
  //   - Sjøkart kjøres parallelt så snart DEM-resultatet bekrefter kyst-bbox;
  //     hard 8s timeout så et hengende Geonorge-endpoint aldri blokkerer kartet.
  // DEM-oppløsning: 20 m som default, 10 m bare når brukeren har valgt
  // fine konturer (≤ 5 m ekvidistanse). 20 m halverer cellene per akse →
  // 4× mindre TIFF å laste ned + dekode, typisk 1-3 s besparelse på 4×4 km
  // kart. Konturer rendres fortsatt fint takket være Chaikin-glatting; tap
  // av presisjon er umerkelig på print 1:10 000.
  const resolutionM = equidistanceM <= 5 ? 10 : 20
  const demPromise = fetchDEM(bbox, utmBbox, { resolutionM, useReal: true })
  const sjokartPromise = demPromise.then(dem => {
    if (!hasNearSeaLevelPixels(dem)) {
      console.log('[Sjøkart] hopper over — bbox er innlands (ingen DEM-piksler ≤ 0.5 m)')
      return EMPTY_SJOKART
    }
    return withHardTimeout(fetchSjokart(bbox), SJOKART_TIMEOUT_MS, EMPTY_SJOKART, 'Sjøkart')
  }).catch(() => EMPTY_SJOKART)

  const [osmData, n50Water, dem, sjokart] = await Promise.all([
    fetchOverpass(bbox),
    fetchN50Water(bbox).catch(e => {
      console.warn('N50-vann ikke tilgjengelig:', e.message)
      return []
    }),
    demPromise,
    sjokartPromise,
  ])
  const sjokartElements = sjokartToElements(sjokart)

  const n50HasFreshwater = n50Water.some(el =>
    (el.tags?.natural === 'water' && el.tags?.salt !== 'yes') ||
    el.tags?.waterway === 'stream'
  )
  const n50HasSea = n50Water.some(el =>
    el.tags?.water === 'sea' || el.tags?.salt === 'yes'
  )

  const elements = osmData.elements.filter(el => {
    const tags = el.tags ?? {}
    const isWaterPolygon = tags.natural === 'water' || !!tags.water ||
                           tags.natural === 'bay' || tags.natural === 'strait' ||
                           tags.place === 'sea' || tags.place === 'ocean'
    if (isWaterPolygon) {
      if (isOsmWaterSalty(tags)) return !n50HasSea
      if (tags.name) return true
      return !n50HasFreshwater
    }
    if (tags.waterway === 'stream' || tags.waterway === 'ditch') {
      return !n50HasFreshwater
    }
    return true
  })
  if (n50Water.length > 0) elements.push(...n50Water)
  if (sjokartElements.length > 0) elements.push(...sjokartElements)

  const sourceParts = ['OSM']
  if (n50Water.length > 0) sourceParts.push(`N50 (${n50Water.length} vann${n50HasSea ? ', m/sjø' : ''})`)
  if (sjokartElements.length > 0) sourceParts.push(`Sjøkart (${sjokartElements.length} dybde-features)`)
  sourceParts.push('DEM-sjø (NHM_DTM_25832)')
  const source = sourceParts.join(' + ')

  onProgress(`Bygger SVG fra ${elements.length} elementer …`)

  const { svg, counts } = buildSvg(elements, bbox, {
    dem,
    contourIntervalM: equidistanceM,
    scaleDenom: 10000,
    skipContoursIfSynthetic: true,
    // DEM-sjø ALLTID på når DEM er ekte. Buggy «smitter inn på lavtliggende
    // øyer»-tilfeller dekkes av ISOM 001 land-overlay (OSM place=island).
    skipDemSea: false,
  })

  onProgress(`Lagrer kart …`)

  const id = generateMapId()
  const isRealDem = dem && !dem.source?.startsWith('synthetic')
  const packedDem = isRealDem ? packDem(dem) : null
  const highestPoint = isRealDem ? findHighestPoint(dem) : null

  const entry = {
    id,
    navn,
    bbox,
    center: { ...center },
    halfKm,
    counts,
    svg,
    source,
    annotations: [],
    dem: packedDem,
    highestPoint,
    opprettet: Date.now(),
  }
  await saveMap(entry)
  return { id, entry }
}
