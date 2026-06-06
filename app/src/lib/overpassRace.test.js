import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchOverpass } from './mapBuilder.js'

const bbox = { south: 59, north: 59.01, west: 10, east: 10.01 }
const okRes = (payload) => ({ ok: true, json: async () => payload })
const errRes = (status) => ({ ok: false, status, text: async () => 'feil' })

afterEach(() => { vi.unstubAllGlobals() })

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

  it('kaster samlet feil når ALLE speil feiler', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(errRes(504))))
    await expect(fetchOverpass(bbox)).rejects.toThrow(/Alle Overpass-speil feilet/)
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
