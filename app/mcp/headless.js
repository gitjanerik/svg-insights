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

// sjokartFetcher sjekker `typeof DOMParser` for GML-parsing — uten shim
// returnerer den tomt og kystkart mister dybdedata i Node.
if (typeof globalThis.DOMParser === 'undefined') {
  globalThis.DOMParser = DOMParser
}

/**
 * Bygg et komplett turkart headless.
 * @param {{lat:number, lon:number, halfKm:number, equidistanceM?:number}} opts
 * @returns {Promise<{svg:string, counts:object, meta:object, dem:object, bbox:object}>}
 */
export async function buildMapHeadless({ lat, lon, halfKm, equidistanceM }) {
  const bbox = bboxFromCenter(lat, lon, halfKm)
  const utmBbox = utm32BboxFromWgs84(bbox)

  const [overpass, n50Water, dem] = await Promise.all([
    fetchOverpass(bbox),
    fetchN50Water(bbox).catch(() => []),
    fetchDEM(bbox, utmBbox, { resolutionM: 5, useReal: true }),
  ])
  const dom = await fetchDOM(utmBbox, 5).catch(() => null)

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
