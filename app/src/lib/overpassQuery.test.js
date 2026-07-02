// v12.0.17: server-timeout skalert til klient-taket, bygninger i egen
// parallell spørring for store kart, og synlig progresjon under retries.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchOverpass, buildOverpassQuery, buildBuildingsQuery, bboxAreaKm2 } from './mapBuilder.js'

// ~3,3 km-kart rundt 59.8°N (< 16 km² → baseline-timeout, ingen bygnings-splitt)
const smallBbox = { south: 59.785, north: 59.815, west: 10.37, east: 10.43 }
// ~12×22 km (> 100 km² → bygnings-splitt)
const bigBbox = { south: 59.7, north: 59.9, west: 10.2, east: 10.42 }

const okRes = (payload) => ({ ok: true, json: async () => payload })
const errRes = (status) => ({ ok: false, status, text: async () => 'feil' })
const bodyOf = (call) => decodeURIComponent(call[1].body)

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('buildOverpassQuery — skalert server-timeout + bygnings-flagg', () => {
  it('embedder gitt timeoutS i spørringen', () => {
    expect(buildOverpassQuery(smallBbox, { timeoutS: 30 })).toContain('[out:json][timeout:30]')
    expect(buildOverpassQuery(smallBbox)).toContain('[timeout:90]')
  })
  it('includeBuildings=false dropper way["building"] men beholder kirker/stadion', () => {
    const q = buildOverpassQuery(smallBbox, { includeBuildings: false })
    expect(q).not.toContain('way["building"];')
    expect(q).toContain('way["building"="stadium"];')
    expect(q).toContain('way["building"~"^(church|chapel)$"];')
  })
})

describe('buildBuildingsQuery', () => {
  it('henter kun bygninger, med gitt timeout', () => {
    const q = buildBuildingsQuery(bigBbox, { timeoutS: 45 })
    expect(q).toContain('[timeout:45]')
    expect(q).toContain('way["building"];')
    expect(q).toContain('out geom;')
  })
})

describe('fetchOverpass — server-timeout følger klient-taket', () => {
  it('lite kart sender [timeout:30] og beholder bygninger i hovedspørringen', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(okRes({ elements: [] })))
    vi.stubGlobal('fetch', fetchSpy)
    await fetchOverpass(smallBbox)
    const body = bodyOf(fetchSpy.mock.calls[0])
    expect(body).toContain('[timeout:30]')
    expect(body).toContain('way["building"];')
  })
})

describe('fetchOverpass — bygnings-splitt for store kart', () => {
  it('arealet er faktisk over splitt-terskelen', () => {
    expect(bboxAreaKm2(bigBbox)).toBeGreaterThan(100)
    expect(bboxAreaKm2(smallBbox)).toBeLessThan(100)
  })

  it('kjører to spørringer og merger elementer med dedupe på type+id', async () => {
    const fetchSpy = vi.fn((url, { body }) => {
      const q = decodeURIComponent(body)
      const isBuildings = q.includes('way["building"];') && !q.includes('way["highway"')
      return Promise.resolve(okRes({
        elements: isBuildings
          ? [{ type: 'way', id: 1 }, { type: 'way', id: 2, tags: { building: 'yes' } }]
          : [{ type: 'way', id: 1 }, { type: 'node', id: 9 }],
      }))
    })
    vi.stubGlobal('fetch', fetchSpy)
    const data = await fetchOverpass(bigBbox)
    const keys = data.elements.map(el => `${el.type}/${el.id}`)
    expect(keys).toEqual(['way/1', 'node/9', 'way/2'])
    // hovedspørringen skal IKKE inneholde generisk way["building"];
    const mainBody = bodyOf(fetchSpy.mock.calls.find(c => bodyOf(c).includes('way["highway"')))
    expect(mainBody).not.toContain('way["building"];\n')
  })

  it('feilet bygnings-spørring gir kart uten bygninger, ikke feilet kart', async () => {
    vi.useFakeTimers()
    const fetchSpy = vi.fn((url, { body }) => {
      const q = decodeURIComponent(body)
      const isBuildings = q.includes('way["building"];') && !q.includes('way["highway"')
      return isBuildings
        ? Promise.resolve(errRes(504))
        : Promise.resolve(okRes({ elements: [{ type: 'node', id: 9 }] }))
    })
    vi.stubGlobal('fetch', fetchSpy)
    const p = fetchOverpass(bigBbox)
    await vi.advanceTimersByTimeAsync(20000)   // dekk bygnings-spørringens retries/backoff
    const data = await p
    expect(data.elements).toEqual([{ type: 'node', id: 9 }])
  })
})

describe('fetchOverpass — synlig progresjon under retries', () => {
  it('onProgress meldes før hvert nye forsøk', async () => {
    vi.useFakeTimers()
    let fail = true
    vi.stubGlobal('fetch', vi.fn(() => fail
      ? Promise.resolve(errRes(504))
      : Promise.resolve(okRes({ elements: [] }))))
    const onProgress = vi.fn()
    const p = fetchOverpass(smallBbox, { onProgress })
    await vi.advanceTimersByTimeAsync(100)
    fail = false
    await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(onProgress).toHaveBeenCalledWith(expect.stringMatching(/forsøk 2 av 3/))
    // Må ikke starte med Bygger/Lagrer (MapPickerView-state-heuristikken)
    for (const [msg] of onProgress.mock.calls) {
      expect(msg).not.toMatch(/^(Bygger|Lagrer)/)
    }
  })
})
