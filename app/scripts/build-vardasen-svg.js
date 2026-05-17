// Henter OSM-data for et bbox rundt Vardåsen i Asker via Overpass API,
// og skriver et SVG-turkart til app/public/maps/vardasen.svg.
//
// Bruker `app/src/lib/mapBuilder.js` for selve byggingen — samme kode
// som klienten bruker når brukeren genererer egne kart.
//
// Kjør: node scripts/build-vardasen-svg.js

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchOverpass, buildSvg, bboxFromCenter } from '../src/lib/mapBuilder.js'
import { fetchDEM } from '../src/lib/demFetcher.js'
import { fetchDOM } from '../src/lib/canopyHeight.js'
import { fetchN50Water } from '../src/lib/n50Fetcher.js'
import { wgs84ToUtm32 } from '../src/lib/utm.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const CENTER = { lat: 59.813746, lon: 10.414616 }
const HALF_KM = 2.5
const bbox = bboxFromCenter(CENTER.lat, CENTER.lon, HALF_KM)

console.log(`Henter OSM for bbox: ${bbox.south.toFixed(4)}, ${bbox.west.toFixed(4)} → ${bbox.north.toFixed(4)}, ${bbox.east.toFixed(4)}`)

const data = await fetchOverpass(bbox)
console.log(`Mottok ${data.elements.length} elementer fra Overpass`)

// Hent N50-vann fra Kartverket — autoritativ kilde for sjø/innsjø/elv.
// Erstatter OSM `natural=water` siden OSM mistagger ofte store norske
// innsjøer som natural=coastline. N50 har korrekt klassifisering.
let n50Water = []
try {
  n50Water = await fetchN50Water(bbox)
  console.log(`Mottok ${n50Water.length} vann-features fra N50`)
} catch (e) {
  console.warn(`N50-vann feilet: ${e.message} — bruker OSM-vann`)
}

// mapBuilder fra v6.8.0 fetcher ikke OSM coastline lenger, så ingen
// coastline-polygonisering kan fyre. Hvis N50 lyktes: filtrer OSM-vann.
const N50_USE_FOR_WATER = n50Water.length > 0
const elements = N50_USE_FOR_WATER
  ? data.elements.filter(el => {
      const t = el.tags ?? {}
      if (t.natural === 'water') return false
      if (t.water) return false
      if (t.waterway === 'stream' || t.waterway === 'ditch') return false
      return true
    })
  : data.elements
if (N50_USE_FOR_WATER) elements.push(...n50Water)
console.log(`Etter merge: ${elements.length} elementer (N50-vann ${N50_USE_FOR_WATER ? 'aktiv' : 'inaktiv'})`)

// DEM: forsøk ekte Kartverket WCS DTM først (workflow har full nettverkstilgang).
// Fallback til syntetisk Vardåsen-modell hvis WCS feiler eller coverage ikke
// matcher.
const sw = wgs84ToUtm32(bbox.south, bbox.west)
const ne = wgs84ToUtm32(bbox.north, bbox.east)
const utmBbox = {
  minE: Math.min(sw.e, ne.e), maxE: Math.max(sw.e, ne.e),
  minN: Math.min(sw.n, ne.n), maxN: Math.max(sw.n, ne.n),
}
// 5m oppløsning: 1000×1000 celler for 5×5 km — ~4 MB GeoTIFF.
// Hvis WCS-tjenesten har 1m-data tilgjengelig blir det resamplet ved
// kilden; hvis bare 10m, får vi resampled 5m (ikke ekte detalj, men
// får skikkelig stupkant-vectorisering uansett).
const dem = await fetchDEM(bbox, utmBbox, {
  resolutionM: 5,
  knownArea: 'vardasen',     // fallback hvis WCS feiler
  useReal: true,
})
console.log(`DEM: ${dem.cols} × ${dem.rows} (oppløsning ${dem.resolution.toFixed(1)} m, kilde: ${dem.source})`)

// DOM (overflate-modell) — grunnlag for CHM og vegetasjons-klassifisering
const dom = await fetchDOM(utmBbox, 5)
if (dom) console.log(`DOM: ${dom.cols} × ${dom.rows} (kilde: ${dom.source})`)

const { svg, counts, meta } = buildSvg(elements, bbox, { dem, dom, contourIntervalM: 10 })
console.log('Klassifisering:', counts)
console.log(`Konturer: ekvidistanse ${meta.equidistance} m, høyde ${meta.elevationRange?.min}–${meta.elevationRange?.max} m`)

const outDir = resolve(__dirname, '..', 'public', 'maps')
mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, 'vardasen.svg')
writeFileSync(outPath, svg)
console.log(`Skrev ${outPath} (${(svg.length / 1024).toFixed(1)} KB)`)
console.log(`Kart-størrelse: ${meta.widthM.toFixed(0)} × ${meta.heightM.toFixed(0)} m`)
// Force fresh build 1778174983
