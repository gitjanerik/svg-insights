// v12.0.17: mini-kystlinje-proben lar kyst-DEM-oppgraderingen og Sjøkart
// starte uten å vente på hele Overpass-svaret. Selektorene i proben MÅ
// speile saltvanns-predikatet (natural=coastline + isOsmWaterSalty) —
// pariteten låses her så en fremtidig endring i predikatet ikke stille
// gjør proben og hovedspørringen uenige.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildCoastProbeQuery, probeCoastline } from './mapBuilder.js'
import { isOsmWaterSalty } from './symbolizer.js'
import { coastalTargetResFor } from './createMapFlow.js'

const bbox = { south: 59, north: 59.05, west: 10, east: 10.05 }

afterEach(() => { vi.unstubAllGlobals() })

describe('buildCoastProbeQuery — paritet med saltvanns-predikatet', () => {
  const q = buildCoastProbeQuery(bbox)

  it('er en bitteliten ids-spørring med stram timeout', () => {
    expect(q).toContain('[timeout:10]')
    expect(q).toContain('out ids qt 1;')
  })

  it('dekker kystlinja (det definitive sjø-signalet)', () => {
    expect(q).toContain('way["natural"="coastline"]')
  })

  it('dekker hver gren i isOsmWaterSalty', () => {
    // Grenene i symbolizer.js#isOsmWaterSalty — verifiser først at predikatet
    // faktisk sier «salt» for hver, så at proben har en matchende selektor.
    expect(isOsmWaterSalty({ salt: 'yes' })).toBe(true)
    expect(q).toContain('nwr["salt"="yes"]')

    expect(isOsmWaterSalty({ tidal: 'yes' })).toBe(true)
    expect(q).toContain('nwr["tidal"="yes"]')

    expect(isOsmWaterSalty({ place: 'sea' })).toBe(true)
    expect(isOsmWaterSalty({ place: 'ocean' })).toBe(true)
    expect(q).toContain('nwr["place"~"^(sea|ocean)$"]')

    expect(isOsmWaterSalty({ natural: 'bay' })).toBe(true)
    expect(isOsmWaterSalty({ natural: 'strait' })).toBe(true)
    expect(q).toContain('["natural"~"^(bay|strait)$"]')

    for (const water of ['sea', 'bay', 'strait', 'lagoon', 'cove']) {
      expect(isOsmWaterSalty({ water })).toBe(true)
    }
    expect(q).toContain('nwr["water"~"^(sea|bay|strait|lagoon|cove)$"]')
  })

  it('vanlige ferskvanns-tagger er IKKE salte (proben skal ikke dekke dem)', () => {
    expect(isOsmWaterSalty({ natural: 'water', water: 'lake' })).toBe(false)
    expect(isOsmWaterSalty({ natural: 'water', water: 'fjord' })).toBe(false)
    expect(q).not.toContain('"lake"')
    expect(q).not.toContain('"fjord"')
  })
})

describe('probeCoastline', () => {
  const okRes = (payload) => ({ ok: true, json: async () => payload })

  it('true når proben finner elementer', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okRes({ elements: [{ type: 'way', id: 1 }] }))))
    await expect(probeCoastline(bbox)).resolves.toBe(true)
  })

  it('false ved tomt svar', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okRes({ elements: [] }))))
    await expect(probeCoastline(bbox)).resolves.toBe(false)
  })

  it('kaster ved nettverksfeil (kalleren faller tilbake til fullt Overpass-svar)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('nett-feil'))))
    await expect(probeCoastline(bbox)).rejects.toThrow()
  })
})

describe('coastalTargetResFor — celletak i stedet for bredde-trapp', () => {
  const box = (widthKm, heightKm) => ({ minE: 0, minN: 0, maxE: widthKm * 1000, maxN: heightKm * 1000 })

  it('8×8 km kvadrat holder seg innenfor taket → 5 m', () => {
    expect(coastalTargetResFor(box(8, 8))).toBe(5)
  })
  it('8 km portrett (aspekt 2,2) er for stort for 5 m → 10 m', () => {
    expect(coastalTargetResFor(box(8, 17.6))).toBe(10)
  })
  it('lite kart → 5 m', () => {
    expect(coastalTargetResFor(box(4, 6))).toBe(5)
  })
  it('gigantisk areal → null (behold probe-oppløsning)', () => {
    expect(coastalTargetResFor(box(20, 30))).toBe(null)
  })
  it('tåler manglende/degenerert bbox', () => {
    expect(coastalTargetResFor(null)).toBe(null)
    expect(coastalTargetResFor(box(0, 0))).toBe(null)
  })
})
