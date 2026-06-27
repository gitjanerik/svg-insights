import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchOverpass, overpassTimeoutForBbox } from './mapBuilder.js'

const bbox = { south: 59, north: 59.01, west: 10, east: 10.01 }
const okRes = (payload) => ({ ok: true, json: async () => payload })
const errRes = (status) => ({ ok: false, status, text: async () => 'feil' })

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('overpassTimeoutForBbox — areal-skalert klient-tak', () => {
  it('lite kart (~1 km²) bruker baseline 30 s', () => {
    expect(overpassTimeoutForBbox(bbox)).toBe(30000)
  })
  it('stort kyst-/by-kart (~14 km, ~190 km²) klatrer mot 90 s', () => {
    // 14 km bredt kvadrat rundt 59.8°N
    const big = { south: 59.74, north: 59.866, west: 10.3, east: 10.54 }
    const t = overpassTimeoutForBbox(big)
    expect(t).toBeGreaterThan(60000)
    expect(t).toBeLessThanOrEqual(90000)
  })
  it('klamper aldri over serverens 90 s-grense', () => {
    const huge = { south: 59, north: 60, west: 10, east: 12 }
    expect(overpassTimeoutForBbox(huge)).toBe(90000)
  })
  it('tåler manglende bbox', () => {
    expect(overpassTimeoutForBbox(null)).toBe(30000)
  })
})

describe('fetchOverpass speil-kappløp', () => {
  it('returnerer det første speilet som svarer (det raske vinner)', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('kumi')) return Promise.resolve(okRes({ elements: ['rask'] }))
      // de: treg — løser etter en makro-task, så kumi vinner kappløpet
      return new Promise(resolve => setTimeout(() => resolve(okRes({ elements: ['treg'] })), 50))
    }))
    const data = await fetchOverpass(bbox)
    expect(data.elements).toEqual(['rask'])
  })

  it('faller over til et annet speil når ett feiler', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('kumi')) return Promise.reject(new Error('nett-feil'))
      return Promise.resolve(okRes({ elements: ['de-ok'] }))
    }))
    const data = await fetchOverpass(bbox)
    expect(data.elements).toEqual(['de-ok'])
  })

  it('prøver på nytt og lykkes etter et forbigående kappløp-feil', async () => {
    vi.useFakeTimers()
    let fail = true   // første kappløp feiler, neste lykkes
    vi.stubGlobal('fetch', vi.fn(() => fail
      ? Promise.resolve(errRes(504))
      : Promise.resolve(okRes({ elements: ['ok'] }))))
    const p = fetchOverpass(bbox)
    await vi.advanceTimersByTimeAsync(100)    // la første kappløp feile
    fail = false
    await vi.advanceTimersByTimeAsync(3000)   // dekk backoff → forsøk 2 lykkes
    await expect(p).resolves.toEqual({ elements: ['ok'] })
  })

  it('kaster når alle forsøk er brukt opp og alle speil feiler', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(errRes(504))))
    const p = fetchOverpass(bbox)
    const assertion = expect(p).rejects.toThrow(/forsøk/)
    await vi.advanceTimersByTimeAsync(20000)   // dekk all backoff mellom forsøk
    await assertion
  })

  it('avbryter umiddelbart hvis signal allerede er aborted', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(okRes({ elements: [] })))
    vi.stubGlobal('fetch', fetchSpy)
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(fetchOverpass(bbox, { signal: ctrl.signal })).rejects.toThrow(/Avbrutt/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
