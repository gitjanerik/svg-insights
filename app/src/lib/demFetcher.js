// DEM-data-henting. Strategi:
//  1. Forsøk Geonorge OGC API (åpen, men kan være CORS-blokkert)
//  2. Hvis ikke tilgjengelig: fall tilbake til syntetisk DEM som
//     ligner det området vi vet om (manuelt kalibrert for Vardåsen
//     og noen testområder).
//
// Når man har en DEM-tjeneste fra serverside (CI eller backend) som
// genererer GeoTIFF for vilkårlige bbox, bytt fetchKnown() til en
// som peker dit.
//
// For Norge er den primære kilden hoydedata.no atom-feed for DTM 1m,
// som kan lastes ned i UTM 32N/33N-ruter (typisk 1×1 km tiles).

import { syntheticDEM } from './dem.js'

/**
 * Kalibrert kjent-områder med Gaussian-modeller.
 * Hentet fra peakbook + topografisk kunnskap.
 */
const KNOWN_AREAS = {
  vardasen: {
    description: 'Vardåsen i Asker (1 topp 349 m)',
    centerLat: 59.813746, centerLon: 10.414616,
    baseElevM: 50,
    peaks: [
      // x/y er meter relativ til UTM bbox sw-hjørne
      // bbox er ca 5 km bredt med center i midten → topp i ca midten
      { name: 'Vardåsen', xRel: 0.50, yRel: 0.50, h: 280, sigmaM: 800 },
      { name: 'Bondivannet', xRel: 0.30, yRel: 0.65, h: -40, sigmaM: 600 },  // dal
    ],
  },
}

/**
 * Forsøk å hente DEM for et bbox. Ved feil eller manglende tjeneste,
 * returner et syntetisk DEM kalibrert på kjente områder.
 *
 * @param {{ south:number, west:number, north:number, east:number }} bbox  (WGS84)
 * @param {{ minE:number, minN:number, maxE:number, maxN:number }} utmBbox
 * @param {object} options
 * @param {number} [options.resolutionM=10]   Lav oppløsning for klient-side
 * @param {string} [options.knownArea]        Hvis satt, bruk kalibrert syntetisk
 * @returns {Promise<DEM>}
 */
export async function fetchDEM(bbox, utmBbox, options = {}) {
  const { resolutionM = 10, knownArea } = options
  const widthM = utmBbox.maxE - utmBbox.minE
  const heightM = utmBbox.maxN - utmBbox.minN

  const transform = {
    originX: 0,                       // grid-koord 0 = bbox sw-hjørne i meter
    originY: 0,
    pixelWidth: resolutionM,
    pixelHeight: resolutionM,
  }

  // Forsøk ekte data først (kan CORS-feile)
  // try {
  //   return await fetchGeonorgeDtm(utmBbox, resolutionM)
  // } catch (e) {
  //   console.warn('Geonorge DTM ikke tilgjengelig, bruker syntetisk:', e.message)
  // }

  // Fallback: syntetisk
  if (knownArea && KNOWN_AREAS[knownArea]) {
    const area = KNOWN_AREAS[knownArea]
    const peaks = area.peaks.map(p => ({
      x: p.xRel * widthM,
      y: p.yRel * heightM,
      h: p.h,
      sigma: p.sigmaM,
    }))
    return syntheticDEM(widthM, heightM, transform, peaks, area.baseElevM)
  }

  // Helt generisk: en enkelt slak topp i sentrum
  return syntheticDEM(widthM, heightM, transform, [
    { x: widthM / 2, y: heightM / 2, h: 100, sigma: Math.min(widthM, heightM) / 3 },
  ], 100)
}

/**
 * Når serverside er tilgjengelig (CI eller backend): fyll inn denne
 * med en URL som returnerer GeoTIFF, og bruk geotiff.js til å lese.
 */
// async function fetchGeonorgeDtm(utmBbox, resolutionM) {
//   const url = `https://wms.geonorge.no/skwms1/wms.hoyde-dtm?... bbox=${utmBbox}&format=image/tiff`
//   const res = await fetch(url)
//   if (!res.ok) throw new Error(`HTTP ${res.status}`)
//   const arrayBuffer = await res.arrayBuffer()
//   const { fromArrayBuffer } = await import('geotiff')
//   const tiff = await fromArrayBuffer(arrayBuffer)
//   const image = await tiff.getImage()
//   const data = await image.readRasters()
//   // ... pakk til DEM
// }
