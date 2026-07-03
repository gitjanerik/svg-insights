import { describe, it, expect, vi } from 'vitest'
import {
  uploadProfile, ensureProfileId, fetchRoute, parseRoute, classifyWayTags,
  ProfileExpiredError, PROFILE_VERSION, BROUTER_BASE,
} from './brouterClient.js'
import fixture from './brouterFixture.json'

const jsonResponse = (data, ok = true, status = 200) => ({
  ok, status,
  json: async () => data,
  text: async () => JSON.stringify(data),
})

const memStorage = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }
}

describe('uploadProfile', () => {
  it('POSTer profilteksten og parser profileid', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ profileid: 'custom_1729' }))
    const id = await uploadProfile('---context:global\n', { fetchFn })
    expect(id).toBe('custom_1729')
    expect(fetchFn).toHaveBeenCalledWith(`${BROUTER_BASE}/profile`, { method: 'POST', body: '---context:global\n' })
  })
  it('kaster ved HTTP-feil og ved manglende profileid', async () => {
    await expect(uploadProfile('x', { fetchFn: async () => jsonResponse({}, false, 500) })).rejects.toThrow('500')
    await expect(uploadProfile('x', { fetchFn: async () => jsonResponse({ feil: 1 }) })).rejects.toThrow('uventet svar')
  })
})

describe('ensureProfileId', () => {
  it('cacher profileid — andre kall gjør null fetch', async () => {
    const storage = memStorage()
    const fetchFn = vi.fn(async () => jsonResponse({ profileid: 'custom_a' }))
    const load = vi.fn(async () => 'profiltekst')
    expect(await ensureProfileId(load, { fetchFn, storage })).toBe('custom_a')
    expect(await ensureProfileId(load, { fetchFn, storage })).toBe('custom_a')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('re-laster ved versjons-mismatch i cachen', async () => {
    const storage = memStorage()
    storage.setItem('grus-brouter-profile:grus', JSON.stringify({ id: 'custom_gammel', v: PROFILE_VERSION - 1 }))
    const fetchFn = vi.fn(async () => jsonResponse({ profileid: 'custom_ny' }))
    expect(await ensureProfileId(async () => 'p', { fetchFn, storage })).toBe('custom_ny')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('separate profiler cacher under egne nøkler', async () => {
    const storage = memStorage()
    let n = 0
    const fetchFn = vi.fn(async () => jsonResponse({ profileid: `custom_${++n}` }))
    expect(await ensureProfileId(async () => 'p1', { fetchFn, storage, key: 'grus' })).toBe('custom_1')
    expect(await ensureProfileId(async () => 'p2', { fetchFn, storage, key: 'balansert' })).toBe('custom_2')
    expect(await ensureProfileId(async () => 'p1', { fetchFn, storage, key: 'grus' })).toBe('custom_1')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe('fetchRoute', () => {
  it('bygger lonlats med LON først, |-separert, med via-punkter', async () => {
    let calledUrl = ''
    const fetchFn = vi.fn(async (url) => { calledUrl = url; return jsonResponse(fixture) })
    await fetchRoute(
      [{ lat: 60.1, lon: 11.2 }, { lat: 60.5, lon: 11.9 }, { lat: 61.0, lon: 12.3 }],
      'custom_1', { fetchFn },
    )
    const u = decodeURIComponent(calledUrl)
    expect(u).toContain('lonlats=11.200000,60.100000|11.900000,60.500000|12.300000,61.000000')
    expect(u).toContain('profile=custom_1')
    expect(u).toContain('format=geojson')
    expect(u).toContain('alternativeidx=0')
  })
  it('kaster ProfileExpiredError ved 4xx med profil-feiltekst', async () => {
    const fetchFn = async () => ({ ok: false, status: 400, text: async () => 'profile custom_1 does not exist' })
    await expect(fetchRoute([{ lat: 60, lon: 11 }, { lat: 61, lon: 12 }], 'custom_1', { fetchFn }))
      .rejects.toBeInstanceOf(ProfileExpiredError)
  })
  it('kaster vanlig Error ved andre feil', async () => {
    const fetchFn = async () => ({ ok: false, status: 503, text: async () => 'overloaded' })
    await expect(fetchRoute([{ lat: 60, lon: 11 }, { lat: 61, lon: 12 }], 'custom_1', { fetchFn }))
      .rejects.toThrow('503')
  })
})

describe('classifyWayTags', () => {
  it('grus-familien → gravel, fast dekke → paved, ellers unknown', () => {
    expect(classifyWayTags('highway=track surface=gravel')).toBe('gravel')
    expect(classifyWayTags('highway=unclassified surface=compacted')).toBe('gravel')
    expect(classifyWayTags('highway=primary surface=asphalt')).toBe('paved')
    expect(classifyWayTags('highway=unclassified')).toBe('unknown')
    expect(classifyWayTags('highway=track')).toBe('gravel')   // track uten surface = antatt grus
    expect(classifyWayTags('')).toBe('unknown')
  })
})

describe('parseRoute', () => {
  it('parser fixture: punkter, lengde, segmenter, grusandel', () => {
    const r = parseRoute(fixture)
    expect(r.points).toHaveLength(7)
    expect(r.points[0]).toEqual([11.2, 60.1, 175.0])
    expect(r.lengthM).toBe(5200)
    expect(r.totalTimeS).toBe(780)
    // Rader: 1200 m asfalt + 1800 m gravel + 1400 m track (antatt grus) + 800 m compacted
    expect(r.gravelM).toBe(4000)
    expect(r.gravelShare).toBeCloseTo(4000 / 5200, 5)
    expect(r.segments).not.toBe(null)
    expect(r.segments[0]).toMatchObject({ fromIdx: 0, surface: 'paved', gravel: false })
    expect(r.segments.at(-1).toIdx).toBe(6)
    expect(r.segments.filter((s) => s.gravel).map((s) => s.distM)).toEqual([1800, 1400, 800])
  })
  it('strekker siste segment til rutas ende når siste rad ikke matcher siste punkt', () => {
    const f = JSON.parse(JSON.stringify(fixture))
    const rows = f.features[0].properties.messages
    // Siste rad peker på nest siste punkt (11.25, 60.14) i stedet for enden.
    rows[rows.length - 1][0] = '11250000'
    rows[rows.length - 1][1] = '60140000'
    const r = parseRoute(f)
    expect(r.segments).not.toBe(null)
    expect(r.segments.at(-1).toIdx).toBe(6)   // halen mot B mangler ikke
  })

  it('mangler messages → null-fallback, geometri beholdes', () => {
    const noMsg = JSON.parse(JSON.stringify(fixture))
    delete noMsg.features[0].properties.messages
    const r = parseRoute(noMsg)
    expect(r.points).toHaveLength(7)
    expect(r.segments).toBe(null)
    expect(r.gravelShare).toBe(null)
  })
  it('messages-koordinater som ikke matcher geometrien → segments null, men andel beholdes når distansene stemmer', () => {
    const off = JSON.parse(JSON.stringify(fixture))
    for (const row of off.features[0].properties.messages.slice(1)) { row[0] = '99000000' }
    const r = parseRoute(off)
    expect(r.segments).toBe(null)
    expect(r.gravelShare).toBeCloseTo(4000 / 5200, 5)
  })
  it('kaster ved manglende geometri', () => {
    expect(() => parseRoute({ features: [] })).toThrow('rutegeometri')
    expect(() => parseRoute(null)).toThrow('rutegeometri')
  })
})
