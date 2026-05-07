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

const __dirname = dirname(fileURLToPath(import.meta.url))

const CENTER = { lat: 59.813746, lon: 10.414616 }
const HALF_KM = 2.5
const bbox = bboxFromCenter(CENTER.lat, CENTER.lon, HALF_KM)

console.log(`Henter OSM for bbox: ${bbox.south.toFixed(4)}, ${bbox.west.toFixed(4)} → ${bbox.north.toFixed(4)}, ${bbox.east.toFixed(4)}`)

const data = await fetchOverpass(bbox)
console.log(`Mottok ${data.elements.length} elementer fra Overpass`)

const { svg, counts, meta } = buildSvg(data.elements, bbox)
console.log('Klassifisering:', counts)

const outDir = resolve(__dirname, '..', 'public', 'maps')
mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, 'vardasen.svg')
writeFileSync(outPath, svg)
console.log(`Skrev ${outPath} (${(svg.length / 1024).toFixed(1)} KB)`)
console.log(`Kart-størrelse: ${meta.widthM.toFixed(0)} × ${meta.heightM.toFixed(0)} m`)
