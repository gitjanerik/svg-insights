// Lager en stub-SVG med samme struktur som ekte byggeskript, men uten
// data fra Overpass. Brukes som midlertidig placeholder til CI-en kan
// generere den ordentlige versjonen.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSvg, bboxFromCenter } from '../src/lib/mapBuilder.js'
import { fetchDEM } from '../src/lib/demFetcher.js'
import { utm32BboxFromWgs84 } from '../src/lib/utm.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const CENTER = { lat: 59.813746, lon: 10.414616 }
const HALF_KM = 2.5
const bbox = bboxFromCenter(CENTER.lat, CENTER.lon, HALF_KM)

// Fire-hjørners UTM-bbox (kvadratisk) — samme extent til DEM-fetch og buildSvg
const utmBbox = utm32BboxFromWgs84(bbox)

// Hent DEM (syntetisk for stub — workflow regenererer med ekte WCS-data)
const dem = await fetchDEM(bbox, utmBbox, {
  resolutionM: 20, knownArea: 'vardasen', useReal: false,
})

// Tom feature-liste = bare ISOM-defs/CSS/bakgrunn + DEM-deriverte konturer
const { svg: baseSvg, meta } = buildSvg([], bbox, {
  scaleDenom: 10000,
  dem,
  utmBbox,
  contourIntervalM: 20,
})

// Sett inn en sentral "venter på CI"-melding i SVG-en. Vi finner
// </svg> og setter inn et overlegg rett før.
const cx = (meta.widthM / 2).toFixed(0)
const cy = (meta.heightM / 2).toFixed(0)
const overlay = `
  <g data-layer="navn" pointer-events="none">
    <text x="${cx}" y="${cy - 200}" text-anchor="middle"
          font-size="120" font-weight="700" fill="#7f4f24" opacity="0.45">
      Kart genereres av CI
    </text>
    <text x="${cx}" y="${cy - 60}" text-anchor="middle"
          font-size="60" fill="#7f4f24" opacity="0.4">
      Trigge "Build map and deploy" i GitHub Actions
    </text>
    <text x="${cx}" y="${cy + 20}" text-anchor="middle"
          font-size="60" fill="#7f4f24" opacity="0.4">
      eller vent på neste push til feature-branchen
    </text>
    <text x="${cx}" y="${cy + 200}" text-anchor="middle"
          font-size="50" fill="#7f4f24" opacity="0.5" font-weight="600">
      Vardåsen i Asker
    </text>
  </g>
`

// Sett kilden til "Stub" i meta så MapView vet det
meta.source = 'Stub — venter på CI-generert OSM-data (men inkluderer syntetisk DEM-konturer)'
const newMetaJson = JSON.stringify(meta).replace(/'/g, '&apos;')
let svg = baseSvg.replace(
  /data-meta='[^']*'/,
  `data-meta='${newMetaJson}'`
)
svg = svg.replace('</svg>\n', `${overlay}</svg>\n`)

const outDir = resolve(__dirname, '..', 'public', 'maps')
mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, 'vardasen.svg')
writeFileSync(outPath, svg)
console.log(`Skrev stub: ${outPath} (${(svg.length / 1024).toFixed(1)} KB)`)
console.log(`Bbox: ${meta.widthM.toFixed(0)} × ${meta.heightM.toFixed(0)} m`)
