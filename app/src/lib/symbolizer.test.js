import { describe, it, expect } from 'vitest'
import { buildPointSymbolDef, isOsmWaterSalty, isFlowingWaterArea, classifyToIsom, isTrailheadParking } from './symbolizer.js'

describe('isTrailheadParking — offentlig utfartsparkering vs. privat', () => {
  it('utfart-/tur-/friluft-navn markeres som utfartsparkering uansett access', () => {
    expect(isTrailheadParking({ amenity: 'parking', name: 'Utfartsparkering Vardåsen' })).toBe(true)
    expect(isTrailheadParking({ amenity: 'parking', name: 'Turparkering' })).toBe(true)
    expect(isTrailheadParking({ amenity: 'parking', operator: 'Friluftsetaten' })).toBe(true)
    expect(isTrailheadParking({ amenity: 'parking', 'name:no': 'Badeplass-parkering' })).toBe(true)
  })

  it('eksplisitt offentlig access markeres som utfartsparkering', () => {
    for (const access of ['yes', 'public', 'permissive', 'destination']) {
      expect(isTrailheadParking({ amenity: 'parking', access })).toBe(true)
    }
  })

  it('privat/kunde-access er ALDRI utfartsparkering — selv med utfart-navn taper access ikke (navn vinner)', () => {
    for (const access of ['private', 'customers', 'no', 'permit', 'residents']) {
      expect(isTrailheadParking({ amenity: 'parking', access })).toBe(false)
    }
  })

  it('navn vinner over privat access (en navngitt utfartsparkering er offentlig selv om access feil-tagget)', () => {
    expect(isTrailheadParking({ amenity: 'parking', access: 'private', name: 'Utfartsparkering' })).toBe(true)
  })

  it('parkering uten access-tag regnes konservativt som vanlig (ikke utfart)', () => {
    expect(isTrailheadParking({ amenity: 'parking' })).toBe(false)
    expect(isTrailheadParking({ amenity: 'parking', name: 'Parkeringshus' })).toBe(false)
  })

  it('ikke-parkering returnerer false', () => {
    expect(isTrailheadParking({ amenity: 'toilets', access: 'yes' })).toBe(false)
    expect(isTrailheadParking({})).toBe(false)
    expect(isTrailheadParking(null)).toBe(false)
  })
})

describe('isOsmWaterSalty — kun autoritative tagger, aldri navn', () => {
  // Prinsipp: salinitet avgjøres KUN av tagger, ALDRI av navnet.
  it('ferskvanns-innsjøer med «fjord»-navn er IKKE salt (Tyrifjorden m.fl.)', () => {
    for (const name of ['Tyrifjorden', 'Randsfjorden', 'Steinsfjorden', 'Hestesund', 'Mjøsa']) {
      expect(isOsmWaterSalty({ natural: 'water', name })).toBe(false)
      expect(isOsmWaterSalty({ natural: 'water', 'name:no': name })).toBe(false)
    }
  })

  it('water=fjord-taggen alene gjør IKKE vannet salt (valg B — ofte feil-tagget innlands)', () => {
    expect(isOsmWaterSalty({ natural: 'water', water: 'fjord' })).toBe(false)
    expect(isOsmWaterSalty({ natural: 'water', water: 'lake' })).toBe(false)
  })

  it('autoritative tagger gjør vannet salt', () => {
    expect(isOsmWaterSalty({ natural: 'water', salt: 'yes' })).toBe(true)
    expect(isOsmWaterSalty({ tidal: 'yes' })).toBe(true)
    expect(isOsmWaterSalty({ place: 'sea' })).toBe(true)
    expect(isOsmWaterSalty({ place: 'ocean' })).toBe(true)
    expect(isOsmWaterSalty({ natural: 'bay' })).toBe(true)
    expect(isOsmWaterSalty({ natural: 'strait' })).toBe(true)
    expect(isOsmWaterSalty({ water: 'sea' })).toBe(true)
  })

  it('Tyrifjorden (natural=water + fjord-navn) klassifiseres som ferskvann 301, ikke sjø 303', () => {
    const res = classifyToIsom({ type: 'way', tags: { natural: 'water', name: 'Tyrifjorden' } })
    expect(res).toEqual({ code: '301', cat: 'water' })
  })
})

describe('isFlowingWaterArea — elveløp-flater som NVE/N50 aldri leverer', () => {
  it('water=river/canal/stream/ditch er flytende flate', () => {
    for (const water of ['river', 'canal', 'stream', 'ditch', 'lock', 'moat', 'rapids', 'fish_pass']) {
      expect(isFlowingWaterArea({ natural: 'water', water })).toBe(true)
    }
  })

  it('waterway-areal (riverbank/dock/river/canal) er flytende flate', () => {
    expect(isFlowingWaterArea({ waterway: 'riverbank' })).toBe(true)
    expect(isFlowingWaterArea({ waterway: 'dock' })).toBe(true)
    expect(isFlowingWaterArea({ waterway: 'river' })).toBe(true)
    expect(isFlowingWaterArea({ waterway: 'canal' })).toBe(true)
  })

  it('innsjø/tjern/magasin er IKKE flytende (NVE/N50 er autoritativ for dem)', () => {
    expect(isFlowingWaterArea({ natural: 'water' })).toBe(false)
    expect(isFlowingWaterArea({ natural: 'water', water: 'lake' })).toBe(false)
    expect(isFlowingWaterArea({ natural: 'water', water: 'pond' })).toBe(false)
    expect(isFlowingWaterArea({ natural: 'water', water: 'reservoir' })).toBe(false)
    expect(isFlowingWaterArea({})).toBe(false)
    expect(isFlowingWaterArea(undefined)).toBe(false)
  })
})

describe('classifyToIsom — idrettsanlegg (ISOM 513)', () => {
  it('stadion/idrettspark/idrettsbane/travbane/recreation_ground → 513', () => {
    const cases = [
      { leisure: 'stadium' },
      { leisure: 'sports_centre' },
      { leisure: 'pitch' },
      { leisure: 'track' },
      { leisure: 'horse_racing' },
      { landuse: 'recreation_ground' },
      { building: 'stadium' },
    ]
    for (const tags of cases) {
      expect(classifyToIsom({ type: 'way', tags })).toEqual({ code: '513', cat: 'manmade' })
    }
  })

  it('hoppbakke (sport=ski_jumping) → 513 uansett base-tag og element-type', () => {
    expect(classifyToIsom({ type: 'way', tags: { sport: 'ski_jumping' } })).toEqual({ code: '513', cat: 'manmade' })
    expect(classifyToIsom({ type: 'node', tags: { sport: 'ski_jumping', name: 'Midtstubakken' } })).toEqual({ code: '513', cat: 'manmade' })
    expect(classifyToIsom({ type: 'way', tags: { leisure: 'pitch', sport: 'ski_jumping' } })).toEqual({ code: '513', cat: 'manmade' })
  })

  it('lysløype (leisure=track + sport=skiing) forblir 510, ikke idrettsanlegg', () => {
    expect(classifyToIsom({ type: 'way', tags: { leisure: 'track', sport: 'skiing' } })).toEqual({ code: '510', cat: 'manmade' })
  })

  it('leisure=park forblir åpen mark (401), ikke idrettsanlegg', () => {
    expect(classifyToIsom({ type: 'way', tags: { leisure: 'park' } })).toEqual({ code: '401', cat: 'terrain' })
  })
})

describe('buildPointSymbolDef', () => {
  it('renders rect-elementer (ISOM 540 stake-port)', () => {
    const spec = {
      viewBox: '-1 -1 2 2',
      elements: [
        { type: 'rect', x: -0.4, y: -0.6, width: 0.8, height: 1.2, fill: '#cc1f1f' },
      ],
    }
    const def = buildPointSymbolDef('test-rect', spec)
    expect(def).toContain('<rect')
    expect(def).toContain('x="-0.4"')
    expect(def).toContain('y="-0.6"')
    expect(def).toContain('width="0.8"')
    expect(def).toContain('height="1.2"')
    expect(def).toContain('fill="#cc1f1f"')
  })

  it('renders flere rect-elementer (ISOM 542 stake-cardinal)', () => {
    const spec = {
      viewBox: '-1 -1 2 2',
      elements: [
        { type: 'rect', x: -0.4, y: -0.7, width: 0.8, height: 0.5, fill: '#000' },
        { type: 'rect', x: -0.4, y: -0.2, width: 0.8, height: 0.5, fill: '#f5d33a' },
        { type: 'rect', x: -0.4, y: 0.3, width: 0.8, height: 0.4, fill: '#000' },
      ],
    }
    const def = buildPointSymbolDef('test-cardinal', spec)
    const rectMatches = def.match(/<rect/g)
    expect(rectMatches).toHaveLength(3)
    expect(def).toContain('fill="#f5d33a"')
  })

  it('forblir bakoverkompatibel for circle/polygon/path/line', () => {
    const def = buildPointSymbolDef('test-mix', {
      viewBox: '-1 -1 2 2',
      elements: [
        { type: 'circle', cx: 0, cy: 0, r: 0.5, fill: '#000' },
        { type: 'polygon', points: '0,-1 1,1 -1,1', fill: '#0f0' },
      ],
    })
    expect(def).toContain('<circle')
    expect(def).toContain('<polygon')
  })
})
