import { describe, it, expect } from 'vitest'
import { buildSvg, bboxFromCenter, viewportAspect, autoMapAFormat, autoMapSquare, PRINT_ASPECT, makeLabelNameClaimer } from './mapBuilder.js'
import { syntheticDEM } from './dem.js'
import { wgs84ToUtm32 } from './utm.js'

describe('bboxFromCenter — aspekt strekker N/S, ikke E/V (v10.1.10)', () => {
  const lat = 59.9, lon = 10.75, halfKm = 2

  it('aspect=1 gir kvadratisk bbox (uendret oppførsel)', () => {
    const b = bboxFromCenter(lat, lon, halfKm, 1)
    const dLat = b.north - b.south
    const groundHeightKm = dLat * 111
    const groundWidthKm = (b.east - b.west) * 111 * Math.cos(lat * Math.PI / 180)
    expect(groundWidthKm).toBeCloseTo(2 * halfKm, 3)
    expect(groundHeightKm).toBeCloseTo(2 * halfKm, 3)
  })

  it('default-parameter = kvadrat (bakoverkompatibelt)', () => {
    expect(bboxFromCenter(lat, lon, halfKm)).toEqual(bboxFromCenter(lat, lon, halfKm, 1))
  })

  it('aspect=2 dobler N/S-utstrekning men holder E/V uendret', () => {
    const sq = bboxFromCenter(lat, lon, halfKm, 1)
    const tall = bboxFromCenter(lat, lon, halfKm, 2)
    // E/V (bredde) uendret
    expect(tall.east - tall.west).toBeCloseTo(sq.east - sq.west, 9)
    // N/S (høyde) doblet
    expect(tall.north - tall.south).toBeCloseTo(2 * (sq.north - sq.south), 9)
    // fortsatt sentrert på samme punkt
    expect((tall.north + tall.south) / 2).toBeCloseTo(lat, 9)
  })
})

describe('viewportAspect — klampet [1, 2.2] (v10.1.10)', () => {
  it('uten window (test/worker) faller til 1 (kvadrat)', () => {
    expect(viewportAspect()).toBe(1)
  })
})

describe('autoMapAFormat — A-format stående utsnitt (v10.1.23)', () => {
  const lat = 59.9, lon = 10.75

  it('returnerer aspect = √2 (PRINT_ASPECT)', () => {
    expect(autoMapAFormat(2).aspect).toBeCloseTo(PRINT_ASPECT, 9)
    expect(PRINT_ASPECT).toBeCloseTo(Math.SQRT2, 9)
  })

  it('beholder høyden (= 2·halfKm·viewportAspect) og utvider bredden til A-format', () => {
    // I test-miljøet er viewportAspect()=1, så høyden = 2·halfKm = 4 km.
    const { halfKm, aspect } = autoMapAFormat(2)
    const widthKm = 2 * halfKm
    const heightKm = 2 * halfKm * aspect
    expect(heightKm).toBeCloseTo(4, 6)              // høyden bevart
    expect(widthKm).toBeCloseTo(4 / PRINT_ASPECT, 6) // bredden = høyde/√2
    expect(widthKm).toBeGreaterThan(0)
  })

  it('produsert bbox har høyde/bredde = √2 (stående A-ark)', () => {
    const { halfKm, aspect } = autoMapAFormat(2)
    const b = bboxFromCenter(lat, lon, halfKm, aspect)
    const groundHeightKm = (b.north - b.south) * 111
    const groundWidthKm = (b.east - b.west) * 111 * Math.cos(lat * Math.PI / 180)
    expect(groundHeightKm / groundWidthKm).toBeCloseTo(PRINT_ASPECT, 4)
  })
})

describe('autoMapSquare — kvadratisk utsnitt (v11.0.32)', () => {
  it('returnerer aspect = 1 (kvadrat)', () => {
    expect(autoMapSquare(2).aspect).toBe(1)
  })

  it('beholder samme høyde som autoMapAFormat og utvider bredden til kvadrat', () => {
    // I test-miljøet er viewportAspect()=1, så høyden = 2·halfKm = 4 km.
    const sq = autoMapSquare(2)
    const af = autoMapAFormat(2)
    const sqHeight = 2 * sq.halfKm * sq.aspect
    const afHeight = 2 * af.halfKm * af.aspect
    const sqWidth = 2 * sq.halfKm
    const afWidth = 2 * af.halfKm
    expect(sqHeight).toBeCloseTo(afHeight, 6)   // høyden bevart
    expect(sqWidth).toBeCloseTo(sqHeight, 6)    // bredde = høyde (kvadrat)
    expect(sqWidth).toBeGreaterThan(afWidth)    // bredere enn A-format
  })
})

// Syntetisk DEM (Gaussisk topp i midten) som dekker kartets UTM-utstrekning, så
// buildContours gir høydekurver innenfor kart-rammen. demProject er identitet,
// så DEM-world-koord (origin 0, gridToWorld = col*res) = kart-meter-rommet.
function synthDemForBbox(b) {
  const sw = wgs84ToUtm32(b.south, b.west)
  const ne = wgs84ToUtm32(b.north, b.east)
  const widthM = Math.abs(ne.e - sw.e)
  const heightM = Math.abs(ne.n - sw.n)
  return syntheticDEM(widthM, heightM,
    { originX: 0, originY: 0, pixelWidth: 50, pixelHeight: 50 },
    [{ x: widthM / 2, y: heightM / 2, h: 220, sigma: Math.min(widthM, heightM) / 4 }], 50)
}

// Integrasjonstester for Fase 1: single coastline + topologisk klipping av
// dybdeareal (307). Vi unngår DEM-koordinat-justering ved å la N50-sjøen
// definere den autoritative kysten — både N50-ringen og 307-arealene
// projiseres gjennom samme project(), så koordinatrommet er identisk.

const bbox = { south: 59.0, west: 10.0, north: 59.05, east: 10.1 }

const ring = (lat0, lon0, lat1, lon1) => [
  { lat: lat0, lon: lon0 },
  { lat: lat0, lon: lon1 },
  { lat: lat1, lon: lon1 },
  { lat: lat1, lon: lon0 },
  { lat: lat0, lon: lon0 },
]

// N50 Havflate som dekker ØSTRE halvdel (lon 10.05–10.1).
const n50Sea = {
  type: 'way', id: 1,
  tags: { natural: 'water', water: 'sea', salt: 'yes' },
  geometry: ring(59.0, 10.05, 59.05, 10.1),
  _source: 'n50',
}

// Dybdeareal i sjøen (øst). avgD = 3 → data-dybde="3".
const depthInSea = {
  type: 'way', id: 2,
  tags: { sjokart: 'dybdeareal', minDybde: '2', maxDybde: '4' },
  geometry: ring(59.01, 10.06, 59.04, 10.08),
  _source: 'sjokart',
}

// Dybdeareal UTENFOR den DEM/N50-deriverte sjøen (vest) — f.eks. en elvekanal
// som ligger over havnivå. avgD = 99 → data-dybde="99". Tidligere ble dette
// klippet bort (DepthArea ∩ DEM-sjø); nå rendres det med Sjøkarts egen geometri
// (Holmen/Drammen-fiks: elvekanaler skal vises med dybde, ikke kappes til beige).
const depthOutsideDemSea = {
  type: 'way', id: 3,
  tags: { sjokart: 'dybdeareal', minDybde: '98', maxDybde: '100' },
  geometry: ring(59.01, 10.01, 59.04, 10.03),
  _source: 'sjokart',
}

describe('buildSvg — dybdeareal (307) rendres med Sjøkarts egen geometri', () => {
  it('beholder dybdeareal som ligger i sjøen', () => {
    const { svg } = buildSvg([n50Sea, depthInSea], bbox, {})
    expect(svg).toContain('data-iso="307"')
    expect(svg).toContain('data-dybde="3"')
  })

  it('klipper IKKE bort dybdeareal utenfor DEM/N50-sjøen (elvekanal beholdes)', () => {
    // Sjøkart er autoritativt for sjø-utstrekning; øyer karves av bevarte
    // øy-hull (se marineDepthArea.test.js), ikke av DEM-klipping. Dybdeareal
    // utenfor DEM-sjøen (elvekanal over havnivå) skal derfor rendres.
    const { svg } = buildSvg([n50Sea, depthOutsideDemSea], bbox, {})
    expect(svg).toContain('data-dybde="99"')
  })

  it('både sjø-dybde og kanal-dybde rendres samtidig', () => {
    const { svg } = buildSvg([n50Sea, depthInSea, depthOutsideDemSea], bbox, {})
    expect(svg).toContain('data-dybde="3"')
    expect(svg).toContain('data-dybde="99"')
  })

  it('uten kyst-modell (ingen sjø) renderes dybdeareal urørt', () => {
    const { svg } = buildSvg([depthOutsideDemSea], bbox, {})
    expect(svg).toContain('data-dybde="99"')
  })
})

describe('åpen natural=strait/bay way gir ikke wedge-fyll (Kjerringholmen, Hvaler)', () => {
  // natural=strait hentes navngitt fra Overpass for sund-etiketten, men tegnes
  // i OSM ofte som en ÅPEN linje midt i sundet. Tvangslukking til polygon ga en
  // diger trekant-wedge tvers over sundet som dekket holmer. Åpen vann-way skal
  // derfor ikke gi vann-fyll — men navnet skal fortsatt vises.
  const openStrait = {
    type: 'way', id: 70,
    tags: { natural: 'strait', name: 'Testsund' },
    geometry: [
      { lat: 59.045, lon: 10.01 },
      { lat: 59.03, lon: 10.04 },
      { lat: 59.01, lon: 10.06 },
      { lat: 59.005, lon: 10.09 },
    ],
  }
  const closedBay = {
    type: 'way', id: 71,
    tags: { natural: 'bay', name: 'Testbukt' },
    geometry: ring(59.01, 10.02, 59.04, 10.07),
  }

  it('åpen sund-linje gir INGEN vann-fyll (ingen wedge)', () => {
    const { svg } = buildSvg([openStrait], bbox, {})
    expect(svg).not.toContain('data-name="Testsund"')
  })

  it('åpen sund-linje beholder sjø-navn-etiketten', () => {
    const { svg } = buildSvg([openStrait], bbox, {})
    expect(svg).toContain('>Testsund</text>')
  })

  it('lukket bukt-areal rendres fortsatt som vann-fyll', () => {
    const { svg } = buildSvg([closedBay], bbox, {})
    expect(svg).toContain('data-name="Testbukt"')
  })
})

describe('OSM-vann rendres uten størrelses-filtrering (velprøvd norsk oppførsel)', () => {
  // Svensk-saga-eksperimentet med å droppe vann basert på areal/type er fjernet.
  // OSM-vann skal rendres som før: ways OG relasjoner, uansett størrelse. (Norske
  // klient-kart undertrykker OSM-ferskvann oppstrøms via NVE/N50; det innebygde
  // Vardåsen-kartet bygges uten dem og bruker rent OSM-vann — Bondivannet er en
  // OSM-relasjon som MÅ rendres.)
  const freshShown = (svg) => /data-iso="301">(?!<\/g>)/.test(svg) || /data-iso="302">(?!<\/g>)/.test(svg)
  const osmLakeWay = { type: 'way', id: 50, tags: { natural: 'water', name: 'Vatn' }, geometry: ring(59.01, 10.02, 59.04, 10.07) }
  const osmLakeRel = {
    type: 'relation', id: 51, tags: { natural: 'water', name: 'Bondivannet' },
    members: [{ type: 'way', role: 'outer', geometry: ring(59.01, 10.02, 59.04, 10.07) }],
  }

  it('OSM-innsjø-WAY rendres (ingen størrelses-filtrering)', () => {
    expect(freshShown(buildSvg([osmLakeWay], bbox, {}).svg)).toBe(true)
  })

  it('OSM-innsjø-RELASJON rendres (Bondivannet på innebygd kart — ikke droppet)', () => {
    expect(freshShown(buildSvg([osmLakeRel], bbox, {}).svg)).toBe(true)
  })

  it('overlappende navnløse vann-flater (samme kilde) males som EGNE paths — ikke ett evenodd-hull (Ulvenvann-fiks)', () => {
    // To konsentriske navnløse OSM-vann-ways (samme bbox-senter → samme bucket-
    // celle). Slått sammen i én fill-rule="evenodd"-path ville den indre blitt
    // et hull (vikletall 2 = ikke fylt) → innsjø som beige hull i blått vann.
    // Skal nå emitteres som to separate opake paths.
    const bigWater = { type: 'way', id: 60, tags: { natural: 'water' }, geometry: ring(59.01, 10.02, 59.04, 10.08) }
    const nestedWater = { type: 'way', id: 61, tags: { natural: 'water' }, geometry: ring(59.022, 10.045, 59.028, 10.055) }
    const { svg } = buildSvg([bigWater, nestedWater], bbox, {})
    const wayPaths = svg.split('data-src="way"').length - 1
    expect(wayPaths).toBe(2)
  })
})

describe('område-navn — lineære features får ALDRI areal-label (tullenavn-fiks v10.2.43)', () => {
  // En busslinje-relasjon: type=route, way-medlemmer med TOM rolle. Tidligere
  // plukket assembleRelationRings(..,'outer') opp trasé-wayene som «outer» og
  // polygonAreaM2 wrappet den åpne traséen til et falskt areal > 1000 m² →
  // labelet med rute-navnet. Lengde-cappen var building-only, så den traff aldri.
  const tullenavn = 'Langum - Hafskjold / Langum - (Bragernes) - Hafskjold / Sundhaug - Asker'
  const busRoute = {
    type: 'relation', id: 90,
    tags: { type: 'route', route: 'bus', name: tullenavn },
    members: [
      { type: 'way', role: '', geometry: [
        { lat: 59.01, lon: 10.02 }, { lat: 59.02, lon: 10.05 },
        { lat: 59.03, lon: 10.03 }, { lat: 59.04, lon: 10.07 },
      ] },
    ],
  }

  it('busslinje-relasjon gir ingen område-navn-label', () => {
    const { svg } = buildSvg([busRoute], bbox, {})
    expect(svg).not.toContain(tullenavn)
  })

  it('navngitt åpen vei (highway) gir ingen område-navn-label', () => {
    const namedRoad = {
      type: 'way', id: 91,
      tags: { highway: 'residential', name: tullenavn },
      geometry: [
        { lat: 59.01, lon: 10.02 }, { lat: 59.02, lon: 10.05 },
        { lat: 59.03, lon: 10.03 }, { lat: 59.04, lon: 10.07 },
      ],
    }
    const { svg } = buildSvg([namedRoad], bbox, {})
    expect(svg).not.toContain(tullenavn)
  })
})

describe('routes filtreres ut globalt før all prosessering (v10.2.43)', () => {
  // «Fjern routes generelt»: rute-relasjoner/-elementer skal aldri bidra til
  // kartet — verken navn, geometri eller søk/highlight (data-name).
  const routeRel = (extra) => ({
    type: 'relation', id: 95,
    tags: { name: 'Buss 251 — Langum', ...extra },
    members: [{ type: 'way', role: '', geometry: ring(59.01, 10.02, 59.04, 10.07) }],
  })

  it('type=route droppes (intet navn, ingen data-name)', () => {
    const { svg } = buildSvg([routeRel({ type: 'route', route: 'bus' })], bbox, {})
    expect(svg).not.toContain('Buss 251')
  })

  it('route=* (uten type) droppes også', () => {
    const { svg } = buildSvg([routeRel({ route: 'hiking' })], bbox, {})
    expect(svg).not.toContain('Buss 251')
  })

  it('type=route_master droppes', () => {
    const { svg } = buildSvg([routeRel({ type: 'route_master' })], bbox, {})
    expect(svg).not.toContain('Buss 251')
  })

  it('ferge-way (route=ferry) droppes', () => {
    const ferry = { type: 'way', id: 96, tags: { route: 'ferry', name: 'Buss 251' }, geometry: ring(59.01, 10.02, 59.04, 10.07) }
    const { svg } = buildSvg([ferry], bbox, {})
    expect(svg).not.toContain('Buss 251')
  })
})

describe('xmlEscape — navn med spesialtegn gir gyldig XML (Stockholm-bug)', () => {
  // Et OSM-navn med " brøt data-name="…"-attributtet → hele SVG-en ble
  // ugyldig XML → MapView «Ugyldig SVG». Gjaldt store byer (Stockholm) der
  // POI-er oftere har anførselstegn/spesialtegn i navnet.
  // _source='n50' → behandles som «i Norge» så vannet faktisk rendres (med
  // data-name) og escaping kan verifiseres — uavhengig av svensk vann-tømming.
  const named = (name) => ({
    type: 'way', id: 42, _source: 'n50',
    tags: { natural: 'water', name },
    geometry: ring(59.01, 10.06, 59.04, 10.08),
  })

  it('escaper " → &quot; (lukker ikke attributtet)', () => {
    const { svg } = buildSvg([named('Lake "A"')], bbox, {})
    expect(svg).toContain('Lake &quot;A&quot;')
    expect(svg).not.toContain('Lake "A"')   // ingen rå anførselstegn i attr
  })

  it('escaper &, <, >', () => {
    const { svg } = buildSvg([named('X & <Y>')], bbox, {})
    expect(svg).toContain('X &amp; &lt;Y&gt;')
  })

  it('stripper ulovlige XML-kontrolltegn', () => {
    const { svg } = buildSvg([named('Bad\u0007Name')], bbox, {})
    expect(svg).toContain('BadName')
    expect(svg).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/)
  })
})

describe('painter\'s order — vann males OPPÅ terreng, ingen land-mask', () => {
  // To overlappende vann-polygoner fra ulike kilder (etterligner N50 + OSM for
  // samme innsjø, Tyrifjorden). Robusthets-kravet: konturer/stupkanter skjules
  // av det OPAKE vann-fyllet via z-order, ikke av en <mask>. Derfor: ingen
  // land-mask i SVG-en, og kontur-laget skal stå FØR vann-laget i kilden (males
  // først → vann males over det).
  const lakeOsm = {
    type: 'way', id: 10, tags: { natural: 'water', name: 'Tyrifjorden' },
    geometry: ring(59.01, 10.02, 59.04, 10.07),
  }
  const lakeN50 = {
    type: 'way', id: 11, tags: { natural: 'water' }, _source: 'n50',
    geometry: ring(59.015, 10.03, 59.045, 10.08),
  }

  it('emitterer ingen land-mask (maskeringen er fjernet)', () => {
    const { svg } = buildSvg([lakeOsm, lakeN50], bbox, {})
    expect(svg).not.toContain('land-mask')
    expect(svg).not.toContain('mask="url(')
  })

  it('maler konturer FØR vann (painter\'s order) når begge finnes', () => {
    // Syntetisk DEM gir konturer; vann fra polygonene over. Konturlaget skal
    // forekomme tidligere i kilden enn vann-laget, så det opake vannet dekker
    // konturer som strekker seg ut over innsjøen.
    const { svg } = buildSvg([lakeOsm, lakeN50], bbox, { dem: synthDemForBbox(bbox) })
    // Anker på <g data-layer=…> (kun i body; CSS bruker [data-iso] selektorer).
    const contourIdx = svg.indexOf('<g data-layer="kontur"')
    const waterIdx = svg.indexOf('<g data-layer="vann"')
    expect(contourIdx).toBeGreaterThanOrEqual(0)
    expect(waterIdx).toBeGreaterThanOrEqual(0)
    expect(contourIdx).toBeLessThan(waterIdx)
  })
})

describe('vektor-vann er autoritativt over DEM-sjø (steg 2)', () => {
  // DEM med vestre halvdel = 0 m (rører kart-kanten → buildSeaFromDem ser «sjø»),
  // østre halvdel = 80 m. En vektor-innsjø som dekker vestre halvdel skal TRUMFE:
  // DEM-sjøen trekkes bort (ingen 303/teal/trappetrinn), innsjøen rendres som
  // ekte ferskvann (301). Etterligner Tyrifjorden lest som ~0 m i DTM.
  function demWithWestSea(b) {
    const sw = wgs84ToUtm32(b.south, b.west)
    const ne = wgs84ToUtm32(b.north, b.east)
    const widthM = Math.abs(ne.e - sw.e)
    const heightM = Math.abs(ne.n - sw.n)
    const res = 50
    const cols = Math.round(widthM / res)
    const rows = Math.round(heightM / res)
    const data = new Float32Array(cols * rows)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) data[r * cols + c] = c < cols / 2 ? 0 : 80
    }
    return { data, cols, rows, transform: { originX: 0, originY: 0, pixelWidth: res, pixelHeight: res }, noData: -9999, resolution: res }
  }
  // Innsjø som dekker mer enn vestre halvdel (lon 10.0–10.06 ⊃ DEM-sjøen ved lon<10.05).
  const westLake = {
    type: 'way', id: 50, tags: { natural: 'water', name: 'Testvatn' },
    geometry: ring(59.0, 10.0, 59.05, 10.06),
  }

  it('DEM-sjø under en vektor-innsjø trekkes bort, innsjøen rendres som 301', () => {
    const { svg } = buildSvg([westLake], bbox, { dem: demWithWestSea(bbox), skipDemSea: false })
    expect(svg).not.toContain('data-src="dem-sea"')   // falsk DEM-sjø fjernet
    expect(svg).toContain('data-iso="301"')            // innsjøen som ekte ferskvann
  })

  it('uten overlappende ferskvann beholdes DEM-sjøen (kyst-fallback urørt)', () => {
    const { svg } = buildSvg([], bbox, { dem: demWithWestSea(bbox), skipDemSea: false })
    expect(svg).toContain('data-src="dem-sea"')        // ekte kyst-sjø overlever
  })
})

describe('navngitte vannveier (elv/bekk) får data-name for klikk-oppslag (v10.2.44)', () => {
  // En polylinje (ikke lukket ring) langs øst-vest. waterway=river → ISOM 304.
  const elvLine = (name, way = 'river') => [
    {
      type: 'way', id: 70,
      tags: { waterway: way, name },
      geometry: [
        { lat: 59.02, lon: 10.01 },
        { lat: 59.02, lon: 10.05 },
        { lat: 59.02, lon: 10.09 },
      ],
    },
  ]

  it('navngitt elv (304) emitteres standalone med data-name', () => {
    const { svg } = buildSvg(elvLine('Drammenselva', 'river'), bbox, {})
    expect(svg).toContain('data-iso="304"')
    expect(svg).toMatch(/data-iso="304">[\s\S]*data-name="Drammenselva"/)
  })

  it('navngitt bekk (305) emitteres standalone med data-name', () => {
    const { svg } = buildSvg(elvLine('Lurbekken', 'stream'), bbox, {})
    expect(svg).toMatch(/data-iso="305">[\s\S]*data-name="Lurbekken"/)
  })

  it('unavngitt vannvei får ingen data-name (slås sammen som før)', () => {
    const { svg } = buildSvg(elvLine('', 'stream'), bbox, {})
    // Ingen data-name på 305-linja når navnet mangler.
    const seg = svg.slice(svg.indexOf('data-iso="305"'))
    const end = seg.indexOf('</g>')
    expect(seg.slice(0, end)).not.toContain('data-name=')
  })
})

describe('makeLabelNameClaimer — navn-dedup med type- og avstands-unntak (v12.1.22)', () => {
  it('samme navn + samme type + nær → dedupes (kun første vinner)', () => {
    const claim = makeLabelNameClaimer()
    expect(claim('Slottsberget', 'topp', 0, 0)).toBe(true)
    expect(claim('Slottsberget', 'topp', 400, 300)).toBe(false)
  })
  it('samme navn + samme type + ≥1 km → begge vises', () => {
    const claim = makeLabelNameClaimer()
    expect(claim('Slottsberget', 'topp', 0, 0)).toBe(true)
    expect(claim('Slottsberget', 'topp', 1200, 0)).toBe(true)
  })
  it('navnetvilling på ULIK type vises alltid — også nær (gården og fjellet)', () => {
    const claim = makeLabelNameClaimer()
    expect(claim('Kolsås', 'topp', 0, 0)).toBe(true)
    expect(claim('Kolsås', 'sted', 150, 100)).toBe(true)    // gården under fjellet
    expect(claim('Kolsås', 'vann', 50, 50)).toBe(true)      // tjernet ved siden av
  })
  it('tredje forekomst må være ≥1 km fra ALLE tidligere av samme type', () => {
    const claim = makeLabelNameClaimer()
    expect(claim('Rundhøgda', 'topp', 0, 0)).toBe(true)
    expect(claim('Rundhøgda', 'topp', 1500, 0)).toBe(true)
    expect(claim('Rundhøgda', 'topp', 800, 0)).toBe(false)  // <1 km fra begge
  })
  it('uten koordinater kollapser samme type alltid (elv-labels hver ~2 km)', () => {
    const claim = makeLabelNameClaimer()
    expect(claim('Lurbekken', 'elv')).toBe(true)
    expect(claim('Lurbekken', 'elv')).toBe(false)
    expect(claim('Lurbekken', 'elv')).toBe(false)
  })
  it('case-insensitiv og trimmet nøkkel; navnløst er alltid ok', () => {
    const claim = makeLabelNameClaimer()
    expect(claim(' Slottsberget ', 'topp', 0, 0)).toBe(true)
    expect(claim('SLOTTSBERGET', 'topp', 10, 10)).toBe(false)
    expect(claim('', 'topp', 0, 0)).toBe(true)
    expect(claim(null, 'topp', 0, 0)).toBe(true)
  })
})
