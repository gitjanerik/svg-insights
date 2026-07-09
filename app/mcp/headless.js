// Headless kart-bygging for MCP-serveren. Samme løype som CI-scriptet
// (scripts/build-vardasen-svg.js): Overpass + N50 + DEM/DOM → buildSvg.
// Kjører i ren Node — ingen IndexedDB, ingen Web Worker.

import { DOMParser, parseHTML } from 'linkedom'
import { fetchOverpass, buildSvg, bboxFromCenter } from '../src/lib/mapBuilder.js'
import { fetchDEM } from '../src/lib/demFetcher.js'
import { fetchDOM } from '../src/lib/canopyHeight.js'
import { fetchN50Water } from '../src/lib/n50Fetcher.js'
import { utm32BboxFromWgs84 } from '../src/lib/utm.js'
import { parsePathSubpaths } from '../src/lib/pathUtils.js'
import { poiType, parseLen, sumTranslate, mmToUnitFromSvg, dedupePoi } from '../src/lib/mapPoi.js'
import { buildSearchIndex, filterIndex } from '../src/composables/useMapSearch.js'

// sjokartFetcher sjekker `typeof DOMParser` for GML-parsing — uten shim
// returnerer den tomt og kystkart mister dybdedata i Node.
if (typeof globalThis.DOMParser === 'undefined') {
  globalThis.DOMParser = DOMParser
}

// Velg DEM/DOM-oppløsning ut fra kart-arealet så WCS-forespørselen holder seg
// under et celletak. Headless-motstykket til appens coastalTargetResFor: små
// kart beholder 5 m (uendret oppførsel ≤ ~8×8 km), mens store turområder/
// nasjonalparker faller til 10/20/25 m i stedet for å be om titalls millioner
// celler, time ut, og falle stille tilbake til syntetisk DEM (terrengløst kart).
const DEM_MAX_CELLS = 4e6
export function demResolutionForArea(utmBbox, maxCells = DEM_MAX_CELLS) {
  const areaM2 = (utmBbox.maxE - utmBbox.minE) * (utmBbox.maxN - utmBbox.minN)
  if (!(areaM2 > 0)) return 5
  for (const res of [5, 10, 20, 25]) {
    if (areaM2 / (res * res) <= maxCells) return res
  }
  return 25
}

/**
 * Bygg et komplett turkart headless.
 * @param {{lat:number, lon:number, halfKm:number, equidistanceM?:number}} opts
 * @returns {Promise<{svg:string, counts:object, meta:object, dem:object, bbox:object}>}
 */
export async function buildMapHeadless({ lat, lon, halfKm, equidistanceM }) {
  const bbox = bboxFromCenter(lat, lon, halfKm)
  const utmBbox = utm32BboxFromWgs84(bbox)
  const resolutionM = demResolutionForArea(utmBbox)
  console.error(`[buildMapHeadless] halfKm=${halfKm} → DEM/DOM-oppløsning ${resolutionM} m`)

  const [overpass, n50Water, dem] = await Promise.all([
    fetchOverpass(bbox),
    fetchN50Water(bbox).catch(() => []),
    fetchDEM(bbox, utmBbox, { resolutionM, useReal: true }),
  ])
  const dom = await fetchDOM(utmBbox, resolutionM).catch(() => null)

  // N50 er autoritativ vannkilde når den leverer (samme filter som CI-scriptet).
  const useN50 = n50Water.length > 0
  const elements = useN50
    ? overpass.elements.filter(el => {
        const t = el.tags ?? {}
        if (t.natural === 'water') return false
        if (t.water) return false
        if (t.waterway === 'stream' || t.waterway === 'ditch') return false
        return true
      })
    : overpass.elements
  if (useN50) elements.push(...n50Water)

  const { svg, counts, meta } = buildSvg(elements, bbox, {
    dem,
    dom,
    utmBbox,
    contourIntervalM: equidistanceM,
    skipContoursIfSynthetic: true,
  })
  return { svg, counts, meta, dem, bbox }
}

// Routbare ISOM-koder — må matche ISOM_COST i lib/routing.js og
// ROUTABLE_CODES i useStifinner.js.
const ROUTABLE_CODES = new Set(['501', '502', '503', '504', '505', '506', '507', '509'])

/**
 * Ekstraher routbare features fra en generert SVG-streng. Node-varianten av
 * useStifinner.featuresFromSvg — et nybygd kart har ingen nestede fliser,
 * så ingen offset-håndtering trengs.
 * @param {string} svgText
 * @returns {Array<{coordinates: Array<[number,number]>, isomCode: string}>}
 */
export function routableFeaturesFromSvg(svgText) {
  const { document } = parseHTML(`<html><body>${svgText}</body></html>`)
  const features = []
  for (const g of document.querySelectorAll('[data-iso]')) {
    const code = g.getAttribute('data-iso')
    if (!ROUTABLE_CODES.has(code)) continue
    const paths = g.tagName.toLowerCase() === 'path' ? [g] : g.querySelectorAll('path')
    for (const p of paths) {
      const d = p.getAttribute('d')
      if (!d) continue
      for (const sub of parsePathSubpaths(d)) {
        if (sub.length < 2) continue
        features.push({ coordinates: sub, isomCode: code })
      }
    }
  }
  return features
}

/**
 * Ekstraher navngitte POI-er fra en generert kart-SVG med absolutt posisjon
 * (SVG-meter). Etikett-tekstens egen x/y (kan være en mm-offset) legges til
 * summen av forelder-transformenes translate, så både absolutt-plasserte
 * (hytte/vann) og gruppe-plasserte (topp) etiketter havner riktig.
 * @param {string} svgText
 * @returns {Array<{navn:string, type:string, x:number, y:number}>}
 */
export function extractMapPoiFromSvg(svgText) {
  const { document } = parseHTML(`<html><body>${svgText}</body></html>`)
  const mmToUnit = mmToUnitFromSvg(svgText)
  const out = []
  for (const el of document.querySelectorAll('text[data-label]')) {
    const type = poiType(el.getAttribute('data-label'))
    if (!type) continue
    const navn = (el.textContent ?? '').trim()
    if (!navn) continue
    let dx = 0, dy = 0
    for (let n = el; n && n.getAttribute; n = n.parentNode) {
      const t = sumTranslate(n.getAttribute('transform'))
      dx += t.dx; dy += t.dy
    }
    const x = dx + parseLen(el.getAttribute('x'), mmToUnit)
    const y = dy + parseLen(el.getAttribute('y'), mmToUnit)
    out.push({ navn, type, x, y })
  }
  return dedupePoi(out)
}

/**
 * Kjør appens kart-søk headless mot en generert SVG-streng. Gjenbruker
 * useMapSearch (buildSearchIndex + filterIndex) så spesial-nøkkelord som
 * «vann» (alle innsjøer, navnløse inkludert, sortert på areal) og «topp» (de
 * høyeste, sortert på moh) oppfører seg identisk med nettleser-appen. Treffenes
 * x/y er i SVG-meter (samme som extractMapPoiFromSvg) og konverteres til WGS84
 * av kalleren.
 * @param {string} svgText
 * @param {string} query
 * @param {number} [limit]
 * @returns {Array<{name:string, kind:string, label:string, x:number, y:number, ele:number|null, areaM2:number|null, categories:string[]|null}>}
 */
export function searchMapSvg(svgText, query, limit = 30) {
  const { document } = parseHTML(`<html><body>${svgText}</body></html>`)
  const svgEl = document.querySelector('svg')
  if (!svgEl) return []
  const index = buildSearchIndex(svgEl)
  return filterIndex(index, query, limit)
}
