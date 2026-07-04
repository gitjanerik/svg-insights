import { describe, it, expect } from 'vitest'
import {
  buildGravelQuery, classifyGravelWay, extractGravelWays,
  classifyBarrierNode, extractBarrierNodes, extractParkingSpots,
  bboxContains, padBbox, GRAVEL_SURFACES, isMotorAccessible, isLysloype,
  PARKING_STI_FETCH_RADIUS_M, UTFART_STI_MAXDIST_M,
} from './gravelOverlay.js'

const BBOX = { south: 60.1, west: 11.2, north: 60.3, east: 11.6 }

describe('buildGravelQuery', () => {
  it('har bbox i S,W,N,E-rekkefølge og begge union-greiner', () => {
    const q = buildGravelQuery(BBOX)
    expect(q).toContain('[bbox:60.1,11.2,60.3,11.6]')
    expect(q).toContain(`"surface"~"^(${GRAVEL_SURFACES.join('|')})$"`)
    expect(q).toContain('way["highway"="track"][!"surface"]["tracktype"!~"^grade1$"]')
    expect(q).toContain('out geom;')
    expect(q).toContain('[timeout:25]')
  })
  it('henter barrier-noder på de samme veiene', () => {
    const q = buildGravelQuery(BBOX)
    expect(q).toContain('node(w)["barrier"];')
    expect(q.indexOf('node(w)')).toBeGreaterThan(q.indexOf('out geom;'))
  })
  it('uten includeParking: ingen parkering i spørringen (default)', () => {
    expect(buildGravelQuery(BBOX)).not.toContain('parking')
  })
  it('med includeParking: parkering (node+way, out center) + sti rundt P-plassene', () => {
    const q = buildGravelQuery(BBOX, { includeParking: true })
    expect(q).toContain('node["amenity"="parking"];')
    expect(q).toContain('way["amenity"="parking"];')
    expect(q).toContain('.pk out center;')
    expect(q).toContain(`way(around.pk:${PARKING_STI_FETCH_RADIUS_M})`)
    expect(q).toContain('"highway"~"^(track|path|footway|bridleway|steps)$"')
    expect(q).toContain('.sti out geom;')
    // Parkerings-delen kommer ETTER grus+barrier-delen (endrer ikke `_`-settet
    // som node(w) leser fra).
    expect(q.indexOf('amenity')).toBeGreaterThan(q.indexOf('node(w)'))
  })
})

describe('classifyGravelWay', () => {
  it('eksplisitt grus-familie → surfaced', () => {
    expect(classifyGravelWay({ highway: 'unclassified', surface: 'gravel' })).toBe('surfaced')
    expect(classifyGravelWay({ highway: 'tertiary', surface: 'compacted' })).toBe('surfaced')
    expect(classifyGravelWay({ highway: 'track', surface: 'dirt' })).toBe('surfaced')
  })
  it('track uten surface → assumed; grade1 ekskluderes', () => {
    expect(classifyGravelWay({ highway: 'track' })).toBe('assumed')
    expect(classifyGravelWay({ highway: 'track', tracktype: 'grade3' })).toBe('assumed')
    expect(classifyGravelWay({ highway: 'track', tracktype: 'grade1' })).toBe(null)
  })
  it('asfalt og umerkede vanlige veier → null', () => {
    expect(classifyGravelWay({ highway: 'unclassified', surface: 'asphalt' })).toBe(null)
    expect(classifyGravelWay({ highway: 'residential' })).toBe(null)
    expect(classifyGravelWay({ highway: 'path', surface: 'gravel' })).toBe(null)
  })
  it('enrich-callback overstyrer OSM-heuristikken begge veier', () => {
    expect(classifyGravelWay({ highway: 'residential' }, { enrich: () => 'surfaced' })).toBe('surfaced')
    expect(classifyGravelWay({ highway: 'track' }, { enrich: () => 'paved' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track' }, { enrich: () => null })).toBe('assumed')
  })
  it('ulovlig motorisert ferdsel → null (også med grus-surface og enrich)', () => {
    expect(classifyGravelWay({ highway: 'track', surface: 'gravel', motor_vehicle: 'no' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track', access: 'private' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track', motor_vehicle: 'agricultural;forestry' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track', vehicle: 'no' }, { enrich: () => 'surfaced' })).toBe(null)
  })
  it('lysløype (piste:type=nordic + lys) → null, også med bekreftet grus-dekke', () => {
    expect(classifyGravelWay({ highway: 'track', 'piste:type': 'nordic', lit: 'yes' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track', surface: 'gravel', 'piste:type': 'nordic', lit: 'yes' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track', 'piste:type': 'nordic;skitour', lit: '24/7' })).toBe(null)
    // Sperren gjelder også når enrich sier 'surfaced'.
    expect(classifyGravelWay({ highway: 'track', 'piste:type': 'nordic', lit: 'yes' }, { enrich: () => 'surfaced' })).toBe(null)
  })
  it('skiløype UTEN lys forblir antatt grus (ofte kjørbar sommerstid)', () => {
    expect(classifyGravelWay({ highway: 'track', 'piste:type': 'nordic' })).toBe('assumed')
    expect(classifyGravelWay({ highway: 'track', 'piste:type': 'nordic', lit: 'no' })).toBe('assumed')
    expect(classifyGravelWay({ highway: 'track', surface: 'gravel', 'piste:type': 'nordic' })).toBe('surfaced')
  })
  it('gang/sykkelvei-heuristikk: foot/bicycle=designated uten motor-access → null (alle veityper)', () => {
    expect(classifyGravelWay({ highway: 'track', surface: 'gravel', foot: 'designated' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track', bicycle: 'designated' })).toBe(null)
    expect(classifyGravelWay({ highway: 'unclassified', surface: 'gravel', bicycle: 'designated' })).toBe(null)
    expect(classifyGravelWay({ highway: 'service', surface: 'compacted', foot: 'designated' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track', surface: 'gravel', foot: 'designated', motor_vehicle: 'yes' })).toBe('surfaced')
  })
})

describe('isLysloype', () => {
  it('nordic + belysning (alle lit-varianter unntatt no) → true', () => {
    expect(isLysloype({ 'piste:type': 'nordic', lit: 'yes' })).toBe(true)
    expect(isLysloype({ 'piste:type': 'nordic', lit: '24/7' })).toBe(true)
    expect(isLysloype({ 'piste:type': 'nordic', lit: 'sunset-sunrise' })).toBe(true)
    expect(isLysloype({ 'piste:type': 'downhill;nordic', lit: 'yes' })).toBe(true)
  })
  it('uten lys, lit=no, eller annen piste-type → false', () => {
    expect(isLysloype({ 'piste:type': 'nordic' })).toBe(false)
    expect(isLysloype({ 'piste:type': 'nordic', lit: 'no' })).toBe(false)
    expect(isLysloype({ 'piste:type': 'downhill', lit: 'yes' })).toBe(false)
    expect(isLysloype({ lit: 'yes' })).toBe(false)
    expect(isLysloype({})).toBe(false)
  })
})

describe('isMotorAccessible', () => {
  it('default (ingen access-tags) → true', () => {
    expect(isMotorAccessible({ highway: 'track' })).toBe(true)
    expect(isMotorAccessible({})).toBe(true)
  })
  it('mest spesifikke tag vinner', () => {
    expect(isMotorAccessible({ access: 'no', motor_vehicle: 'yes' })).toBe(true)
    expect(isMotorAccessible({ access: 'yes', motor_vehicle: 'no' })).toBe(false)
    expect(isMotorAccessible({ motor_vehicle: 'no', motorcycle: 'yes' })).toBe(true)
  })
  it('destination er lovlig', () => {
    expect(isMotorAccessible({ motor_vehicle: 'destination' })).toBe(true)
    expect(isMotorAccessible({ access: 'destination' })).toBe(true)
  })
})

describe('extractGravelWays', () => {
  const fixture = {
    elements: [
      { type: 'way', id: 1, tags: { highway: 'track' },
        geometry: [{ lat: 60.1, lon: 11.2 }, { lat: 60.11, lon: 11.21 }] },
      { type: 'way', id: 2, tags: { highway: 'unclassified', surface: 'gravel' },
        geometry: [{ lat: 60.2, lon: 11.3 }, { lat: 60.21, lon: 11.31 }, { lat: 60.22, lon: 11.32 }] },
      { type: 'way', id: 3, tags: { highway: 'track' } },                      // mangler geometri → droppes
      { type: 'node', id: 4, lat: 60.1, lon: 11.2 },                           // ikke way → droppes
      { type: 'way', id: 5, tags: { highway: 'track', tracktype: 'grade1' },
        geometry: [{ lat: 60.3, lon: 11.4 }, { lat: 60.31, lon: 11.41 }] },    // grade1 → droppes
    ],
  }
  it('trekker ut riktige ways med [lon,lat]-punkter og kind', () => {
    const ways = extractGravelWays(fixture)
    expect(ways.map((w) => w.id)).toEqual([1, 2])
    expect(ways[0].kind).toBe('assumed')
    expect(ways[1].kind).toBe('surfaced')
    expect(ways[1].points[0]).toEqual([11.3, 60.2])
    expect(ways[1].points).toHaveLength(3)
  })
  it('tåler tomt/manglende svar', () => {
    expect(extractGravelWays({})).toEqual([])
    expect(extractGravelWays(null)).toEqual([])
  })
  it('dedup på way-id (samme way i grus- og sti-out-blokkene)', () => {
    const dup = {
      elements: [
        fixture.elements[0],
        { ...fixture.elements[0] },   // samme id fra .sti-blokken
      ],
    }
    expect(extractGravelWays(dup)).toHaveLength(1)
  })
})

describe('extractParkingSpots — turkartets 534/534u-regler i planleggeren', () => {
  // Ved 60°N: 50 m ≈ 0.000449° lat. Sti 22 m nord for P-punktet → innen 50 m;
  // sti 111 m nord (0.001°) → utenfor.
  const P_LAT = 60.0
  const P_LON = 11.0
  const stiNear = {
    type: 'way', id: 100, tags: { highway: 'path' },
    geometry: [{ lat: 60.0002, lon: 10.995 }, { lat: 60.0002, lon: 11.005 }],
  }
  const stiFar = {
    type: 'way', id: 101, tags: { highway: 'path' },
    geometry: [{ lat: 60.001, lon: 10.995 }, { lat: 60.001, lon: 11.005 }],
  }
  const node = (id, tags) => ({ type: 'node', id, lat: P_LAT, lon: P_LON, tags: { amenity: 'parking', ...tags } })

  it('node-parkering plukkes med lat/lon og meter-koordinater', () => {
    const spots = extractParkingSpots({ elements: [node(1, {})] })
    expect(spots).toHaveLength(1)
    expect(spots[0]).toMatchObject({ lat: P_LAT, lon: P_LON, utfart: false })
    expect(Number.isFinite(spots[0].p.x)).toBe(true)
    expect(Number.isFinite(spots[0].p.y)).toBe(true)
  })
  it('way-parkering bruker Overpass-center; uten center droppes den', () => {
    const spots = extractParkingSpots({ elements: [
      { type: 'way', id: 2, center: { lat: P_LAT, lon: P_LON }, tags: { amenity: 'parking' } },
      { type: 'way', id: 3, tags: { amenity: 'parking' } },
    ] })
    expect(spots).toHaveLength(1)
    expect(spots[0].lat).toBe(P_LAT)
  })
  it('utfart krever BÅDE offentlig/utfarts-tagging OG sti innen 50 m', () => {
    const offentlig = node(1, { access: 'yes' })
    // (a)+(b) oppfylt → utfart
    expect(extractParkingSpots({ elements: [offentlig, stiNear] })[0].utfart).toBe(true)
    // (a) uten (b): ingen sti nær → vanlig P
    expect(extractParkingSpots({ elements: [offentlig, stiFar] })[0].utfart).toBe(false)
    // (b) uten (a): privat P ved sti → vanlig P
    expect(extractParkingSpots({ elements: [node(1, { access: 'private' }), stiNear] })[0].utfart).toBe(false)
    // Utfarts-navn slår access-default (samme som turkartet)
    expect(extractParkingSpots({ elements: [node(1, { name: 'Utfartsparkering Knivåsen' }), stiNear] })[0].utfart).toBe(true)
  })
  it('sti-nærhet måles i ekte meter (UTFART_STI_MAXDIST_M)', () => {
    expect(UTFART_STI_MAXDIST_M).toBe(50)
  })
  it('grus-track fra hoveddelen av svaret teller som sti (ISOM 504)', () => {
    const track = {
      type: 'way', id: 200, tags: { highway: 'track' },
      geometry: [{ lat: 60.0002, lon: 10.995 }, { lat: 60.0002, lon: 11.005 }],
    }
    expect(extractParkingSpots({ elements: [node(1, { access: 'yes' }), track] })[0].utfart).toBe(true)
  })
  it('tåler tomt/manglende svar', () => {
    expect(extractParkingSpots({})).toEqual([])
    expect(extractParkingSpots(null)).toEqual([])
  })
})

describe('classifyBarrierNode', () => {
  it('bom uten access-tags → stengt (norsk skogsbilvei-stance)', () => {
    expect(classifyBarrierNode({ barrier: 'gate' })).toBe('closed')
    expect(classifyBarrierNode({ barrier: 'lift_gate' })).toBe('closed')
    expect(classifyBarrierNode({ barrier: 'swing_gate' })).toBe('closed')
  })
  it('eksplisitt access på noden vinner, mest spesifikke først', () => {
    expect(classifyBarrierNode({ barrier: 'gate', access: 'yes' })).toBe('open')
    expect(classifyBarrierNode({ barrier: 'gate', motor_vehicle: 'yes' })).toBe('open')
    expect(classifyBarrierNode({ barrier: 'gate', access: 'yes', motor_vehicle: 'no' })).toBe('closed')
    expect(classifyBarrierNode({ barrier: 'gate', motor_vehicle: 'agricultural;forestry' })).toBe('closed')
    expect(classifyBarrierNode({ barrier: 'gate', access: 'private' })).toBe('closed')
  })
  it('destination på noden er lovlig (kjøring til eiendom)', () => {
    expect(classifyBarrierNode({ barrier: 'gate', motor_vehicle: 'destination' })).toBe('open')
  })
  it('locked=yes → stengt uansett bom-type', () => {
    expect(classifyBarrierNode({ barrier: 'gate', locked: 'yes' })).toBe('closed')
  })
  it('fysiske sperringer → stengt; passerbare → null', () => {
    expect(classifyBarrierNode({ barrier: 'bollard' })).toBe('closed')
    expect(classifyBarrierNode({ barrier: 'chain' })).toBe('closed')
    expect(classifyBarrierNode({ barrier: 'log' })).toBe('closed')
    expect(classifyBarrierNode({ barrier: 'cattle_grid' })).toBe(null)
    expect(classifyBarrierNode({ barrier: 'entrance' })).toBe(null)
    expect(classifyBarrierNode({ barrier: 'toll_booth' })).toBe(null)
  })
  it('ukjent barriertype uten tags → null (markeres ikke)', () => {
    expect(classifyBarrierNode({ barrier: 'noe_rart' })).toBe(null)
    expect(classifyBarrierNode({})).toBe(null)
  })
})

describe('extractBarrierNodes', () => {
  it('trekker ut klassifiserte noder med koordinater', () => {
    const json = {
      elements: [
        { type: 'way', id: 1, tags: { highway: 'track' }, geometry: [{ lat: 60, lon: 11 }] },
        { type: 'node', id: 10, lat: 60.1, lon: 11.2, tags: { barrier: 'gate' } },
        { type: 'node', id: 11, lat: 60.2, lon: 11.3, tags: { barrier: 'gate', access: 'yes' } },
        { type: 'node', id: 12, lat: 60.3, lon: 11.4, tags: { barrier: 'cattle_grid' } },
        { type: 'node', id: 13, tags: { barrier: 'gate' } },   // mangler koordinater
      ],
    }
    const nodes = extractBarrierNodes(json)
    expect(nodes.map((n) => n.id)).toEqual([10, 11])
    expect(nodes[0]).toMatchObject({ kind: 'closed', lon: 11.2, lat: 60.1 })
    expect(nodes[1].kind).toBe('open')
  })
  it('tåler tomt svar', () => {
    expect(extractBarrierNodes({})).toEqual([])
    expect(extractBarrierNodes(null)).toEqual([])
  })
})

describe('bbox-primitiver', () => {
  it('bboxContains', () => {
    const outer = padBbox(BBOX, 1.5)
    expect(bboxContains(outer, BBOX)).toBe(true)
    expect(bboxContains(BBOX, outer)).toBe(false)
    expect(bboxContains(null, BBOX)).toBe(false)
  })
  it('padBbox beholder senteret og skalerer utstrekningen', () => {
    const p = padBbox(BBOX, 2)
    expect((p.north + p.south) / 2).toBeCloseTo((BBOX.north + BBOX.south) / 2, 10)
    expect(p.north - p.south).toBeCloseTo((BBOX.north - BBOX.south) * 2, 10)
    expect(p.east - p.west).toBeCloseTo((BBOX.east - BBOX.west) * 2, 10)
  })
})
