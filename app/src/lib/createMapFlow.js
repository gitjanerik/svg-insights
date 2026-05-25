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
import { buildWaterMaskFromTiles, polygonsToOsmLikeWays } from './waterMaskFromTiles.js'
import { buildWaterMaskFromWms } from './waterMaskFromWms.js'
import { isOsmWaterSalty } from './symbolizer.js'
import { fetchDEM } from './demFetcher.js'
import { findHighestPoint, packDem } from './demSampling.js'
import { wgs84ToUtm32 } from './utm.js'
import { saveMap, generateMapId } from './mapStorage.js'

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

  // Kjør begge vannmaske-kildene i parallel så sluttiden styres av den
  // raskeste suksessen — ikke av sekvensielle WMS-probes som henger.
  // Vi foretrekker WMS når den svarer (mest presis), men aksepterer WMTS-
  // backup om WMS ikke leverer (typisk Indre Oslofjord / Asker-skjærgården
  // der enkelte FKB-Vann-lag ikke er publisert). Hvis BEGGE feiler slår vi
  // på DEM-derivert sjø som siste fallback (skipDemSea: false).
  const [osmData, n50Water, sjokart, wmsWater, wmtsWater] = await Promise.all([
    fetchOverpass(bbox),
    fetchN50Water(bbox).catch(e => {
      console.warn('N50-vann ikke tilgjengelig:', e.message)
      return []
    }),
    fetchSjokart(bbox).catch(e => {
      console.warn('Sjøkart-Dybdedata ikke tilgjengelig:', e.message)
      return { dybdeareal: [], dybdekontur: [], grunne: [], lanterne: [], dybdepunkt: [] }
    }),
    buildWaterMaskFromWms(bbox).catch(e => {
      console.warn('WMS-vannmaske ikke tilgjengelig:', e.message)
      return { polygons: [], source: 'failed' }
    }),
    buildWaterMaskFromTiles(bbox).catch(e => {
      console.warn('WMTS-vannmaske ikke tilgjengelig:', e.message)
      return { polygons: [], source: 'failed' }
    }),
  ])
  const sjokartElements = sjokartToElements(sjokart)

  let waterMask = wmsWater
  if (waterMask.source !== 'wms' || waterMask.polygons.length === 0) {
    if (wmtsWater.polygons.length > 0) {
      console.info('[Vannmaske] WMS uten data — bruker WMTS-tile-fallback')
      waterMask = wmtsWater
    }
  }
  const waterMaskElements = polygonsToOsmLikeWays(waterMask.polygons)
  const waterMaskFailed = waterMask.polygons.length === 0

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
  if (waterMaskElements.length > 0) elements.push(...waterMaskElements)

  const sourceParts = ['OSM']
  if (n50Water.length > 0) sourceParts.push(`N50 (${n50Water.length} vann${n50HasSea ? ', m/sjø' : ''})`)
  if (sjokartElements.length > 0) sourceParts.push(`Sjøkart (${sjokartElements.length} dybde-features)`)
  if (waterMaskElements.length > 0) {
    const seaCount = waterMask.polygons.filter(p => p.type === 'sea').length
    const lakeCount = waterMask.polygons.filter(p => p.type === 'lake').length
    const label = waterMask.source === 'wmts' ? 'WMTS-vann' : 'WMS-vann'
    const meta = waterMask.endpoint ?? waterMask.source ?? 'ukjent'
    sourceParts.push(`${label} (${meta}): ${seaCount} sjø + ${lakeCount} innsjø`)
  } else if (waterMaskFailed) {
    sourceParts.push('⚠ vannmaske feilet — bruker DEM-fallback for sjø')
  }
  const source = sourceParts.join(' + ')

  onProgress(`Bygger SVG fra ${elements.length} elementer …`)

  const sw = wgs84ToUtm32(bbox.south, bbox.west)
  const ne = wgs84ToUtm32(bbox.north, bbox.east)
  const utmBbox = {
    minE: Math.min(sw.e, ne.e), maxE: Math.max(sw.e, ne.e),
    minN: Math.min(sw.n, ne.n), maxN: Math.max(sw.n, ne.n),
  }
  onProgress(`Henter høydedata fra Kartverket …`)
  await new Promise(r => setTimeout(r, 30))
  const dem = await fetchDEM(bbox, utmBbox, { resolutionM: 10, useReal: true })

  const { svg, counts } = buildSvg(elements, bbox, {
    dem,
    contourIntervalM: equidistanceM,
    scaleDenom: 10000,
    skipContoursIfSynthetic: true,
    // Bare slå på DEM-sjø-deteksjon når vannmaske-kildene ikke leverte noe
    // — den er bråkete (kan smitte på lavtliggende øyer DEM ikke ser) og
    // skal kun fylle hull, ikke konkurrere med autoritative N50/WMS-data.
    skipDemSea: !waterMaskFailed,
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
