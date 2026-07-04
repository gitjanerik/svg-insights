import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  uploadProfile, ensureProfileId, fetchRoute, parseRoute, classifyWayTags,
  snapDistances, routesLookIdentical, routeOverlapShare, decorateProposals, MAX_SNAP_DIST_M,
  snapHardLimitM, SNAP_HARD_MIN_M, fmtAvstandM, estimateMcTimeS, MC_SPEED_KMH,
  ProfileExpiredError, PROFILE_VERSION, BROUTER_BASE, applyProfileFlags,
} from './brouterClient.js'
import fixture from './brouterFixture.json'

const profileText = (f) =>
  readFileSync(fileURLToPath(new URL(`../../public/brouter/${f}`, import.meta.url)), 'utf8')

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
  it('kaster når BRouter svarer 200 med error-felt (syntaksfeil i profilen)', async () => {
    const fetchFn = async () => jsonResponse({ profileid: 'custom_1', error: 'unknown expression: foo' })
    await expect(uploadProfile('x', { fetchFn })).rejects.toThrow('avviste profilen')
  })
})

describe('applyProfileFlags + profil-filene (v7)', () => {
  it('bytter inkluder_antatt_grus-flagget begge veier', () => {
    const t = 'assign x = 1\nassign inkluder_antatt_grus = true\nassign y = 2'
    expect(applyProfileFlags(t, { inkluderAntattGrus: false })).toContain('assign inkluder_antatt_grus = false')
    expect(applyProfileFlags(applyProfileFlags(t, { inkluderAntattGrus: false }), { inkluderAntattGrus: true }))
      .toContain('assign inkluder_antatt_grus = true')
  })
  it('kaster når markøren mangler (stille miss ville gitt feil regelverk)', () => {
    expect(() => applyProfileFlags('assign x = 1', { inkluderAntattGrus: false })).toThrow('inkluder_antatt_grus')
  })
  it.each(['grusprofil.brf', 'grusprofil-balansert.brf'])('%s har flagg-markør + lysløype-sperre', (f) => {
    const t = profileText(f)
    // Templating-markøren applyProfileFlags leter etter.
    expect(t).toMatch(/^assign inkluder_antatt_grus = true\b/m)
    expect(applyProfileFlags(t, { inkluderAntattGrus: false })).toContain('assign inkluder_antatt_grus = false')
    // Lysløype-sperren (piste:type=nordic med lys) er med i onlyroads.
    expect(t).toContain('piste:type=nordic')
    expect(t).toContain('switch islysloype false')
    // Antatt grus-gaten i track-kostnaden.
    expect(t).toContain('switch not inkluder_antatt_grus 100000')
    // Versjons-kommentar i synk med PROFILE_VERSION.
    expect(t).toContain(`versjon ${PROFILE_VERSION},`)
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
    // 4000 m grus i grus-fart + 1200 m asfalt i asfalt-fart — IKKE BRouters
    // total-time (som blandet sykkel- og bilmodell på tvers av forslag).
    expect(r.estimatedTimeS).toBe(Math.round(4000 / (MC_SPEED_KMH.gravel / 3.6) + 1200 / (MC_SPEED_KMH.paved / 3.6)))
  })
  it('mangler messages → null-fallback, geometri beholdes', () => {
    const noMsg = JSON.parse(JSON.stringify(fixture))
    delete noMsg.features[0].properties.messages
    const r = parseRoute(noMsg)
    expect(r.points).toHaveLength(7)
    expect(r.segments).toBe(null)
    expect(r.gravelShare).toBe(null)
    expect(r.estimatedTimeS).toBe(Math.round(5200 / (MC_SPEED_KMH.unknown / 3.6)))
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

describe('estimateMcTimeS', () => {
  it('uten underlagsdata → hele lengden i ukjent-fart', () => {
    expect(estimateMcTimeS(10000)).toBe(Math.round(10000 / (MC_SPEED_KMH.unknown / 3.6)))
    expect(estimateMcTimeS(0)).toBe(null)
    expect(estimateMcTimeS(null)).toBe(null)
  })
  it('ren grus går i grus-fart', () => {
    expect(estimateMcTimeS(6200, { gravelM: 6200 })).toBe(Math.round(6200 / (MC_SPEED_KMH.gravel / 3.6)))
  })
  it('miks: grus + ukjent + resten som fast dekke', () => {
    const s = estimateMcTimeS(5200, { gravelM: 4000, unknownM: 0 })
    expect(s).toBe(Math.round(4000 / (MC_SPEED_KMH.gravel / 3.6) + 1200 / (MC_SPEED_KMH.paved / 3.6)))
  })
  it('tidsestimatet er MONOTONT rimelig: 6,3 km blir aldri timer (skjermbilde-buggen)', () => {
    const s = estimateMcTimeS(6300, { gravelM: 6300 * 0.97 })
    expect(s).toBeLessThan(15 * 60)
    expect(s).toBeGreaterThan(5 * 60)
  })
})

describe('snapHardLimitM / fmtAvstandM', () => {
  it('gulv på korte turer, 25 % av luftlinja på lange', () => {
    expect(snapHardLimitM(1000)).toBe(SNAP_HARD_MIN_M)
    expect(snapHardLimitM(0)).toBe(SNAP_HARD_MIN_M)
    expect(snapHardLimitM(null)).toBe(SNAP_HARD_MIN_M)
    expect(snapHardLimitM(13200)).toBe(3300)
  })
  it('skjermbilde-tilfellet: A snappet ~7 km unna på 13,2 km luftlinje → over grensen', () => {
    expect(7000 > snapHardLimitM(13200)).toBe(true)
  })
  it('formaterer meter og km', () => {
    expect(fmtAvstandM(312)).toBe('312 m')
    expect(fmtAvstandM(3200)).toBe('3.2 km')
  })
})

describe('snapDistances', () => {
  // Rute som starter i (61.0, 8.0) og slutter i (61.01, 8.02).
  const parsed = { points: [[8.0, 61.0], [8.01, 61.005], [8.02, 61.01]] }
  it('~0 når waypoints ligger på rutas endepunkter', () => {
    const d = snapDistances(parsed, [{ lat: 61.0, lon: 8.0 }, { lat: 61.01, lon: 8.02 }])
    expect(d.start).toBeLessThan(1)
    expect(d.end).toBeLessThan(1)
  })
  it('måler avstanden når BRouter snappet langt unna', () => {
    // 0.01° lat ≈ 1113 m — godt over MAX_SNAP_DIST_M.
    const d = snapDistances(parsed, [{ lat: 61.01, lon: 8.0 }, { lat: 61.01, lon: 8.02 }])
    expect(d.start).toBeGreaterThan(MAX_SNAP_DIST_M)
    expect(d.end).toBeLessThan(1)
  })
})

describe('routeOverlapShare / routesLookIdentical', () => {
  // Syntetiske ruter langs en sør–nord-linje ved 61°N (1° lat ≈ 111,32 km).
  // line(fromKm, toKm, {lonShiftM, shiftFromKm, shiftToKm}) gir punkter hver
  // 250 m; punkter i shift-vinduet forskyves lonShiftM meter østover (en
  // «omvei» på parallell vei).
  const M_PER_LAT = 111320
  const M_PER_LON = 111320 * Math.cos(61 * Math.PI / 180)
  const line = (fromKm, toKm, { lonShiftM = 0, shiftFromKm = Infinity, shiftToKm = -Infinity } = {}) => {
    const pts = []
    for (let km = fromKm; km <= toKm + 1e-9; km += 0.25) {
      const shifted = km >= shiftFromKm && km <= shiftToKm
      pts.push([8.0 + (shifted ? lonShiftM / M_PER_LON : 0), 61.0 + (km * 1000) / M_PER_LAT])
    }
    return pts
  }
  const straight = { lengthM: 10000, points: line(0, 10) }

  it('identisk geometri → overlapp 1 og identiske', () => {
    expect(routeOverlapShare(straight, { points: line(0, 10) })).toBe(1)
    expect(routesLookIdentical(straight, { ...straight, lengthM: 10180 })).toBe(true)
  })
  it('liten omvei midtveis (~3 % av distansen) → fortsatt identiske', () => {
    const detour = { lengthM: 10050, points: line(0, 10, { lonShiftM: 120, shiftFromKm: 4.85, shiftToKm: 5.15 }) }
    expect(routesLookIdentical(straight, detour)).toBe(true)
  })
  it('parallell vei 500 m unna hele veien → forskjellige', () => {
    const parallel = { lengthM: 10000, points: line(0, 10, { lonShiftM: 500, shiftFromKm: -1, shiftToKm: 11 }) }
    expect(routeOverlapShare(straight, parallel)).toBe(0)
    expect(routesLookIdentical(straight, parallel)).toBe(false)
  })
  it('stor omvei på halve ruta → forskjellige', () => {
    const half = { lengthM: 10600, points: line(0, 10, { lonShiftM: 400, shiftFromKm: 2, shiftToKm: 7 }) }
    expect(routesLookIdentical(straight, half)).toBe(false)
  })
  it('lengde-hurtigsjekk: >25 % lengdeforskjell → forskjellige uten geometrisammenlikning', () => {
    expect(routesLookIdentical(straight, { points: line(0, 10), lengthM: 14000 })).toBe(false)
  })
})

describe('decorateProposals', () => {
  const p = (id, lengthM, gravelShare, estimatedTimeS) => ({ id, lengthM, gravelShare, estimatedTimeS })

  it('gir nøytrale navn i listerekkefølge', () => {
    const out = decorateProposals([p('mest-grus', 7400, 0.95, 660), p('kortest', 22100, 0.25, 1440)])
    expect(out.map((x) => x.label)).toEqual(['Rute 1', 'Rute 2'])
  })
  it('ett forslag → ingen badges (ingenting å sammenlikne med)', () => {
    const out = decorateProposals([p('mest-grus', 7400, 0.95, 660)])
    expect(out[0].label).toBe('Rute 1')
    expect(out[0].badges).toEqual([])
  })
  it('setter MEST GRUS, KORTEST og RASKEST data-drevet', () => {
    const out = decorateProposals([
      p('mest-grus', 22000, 0.95, 2100),
      p('balansert', 15000, 0.60, 1100),
      p('kortest', 16000, 0.10, 1200),
    ])
    expect(out[0].badges).toEqual([{ text: 'MEST GRUS', tone: 'sky' }])
    expect(out[1].badges).toEqual([
      { text: 'KORTEST', tone: 'sky' },
      { text: 'RASKEST', tone: 'green' },
    ])
    expect(out[2].badges).toEqual([])
  })
  it('KORTEST følger lengden uavhengig av underlag, og ett forslag kan ha flere badges', () => {
    const out = decorateProposals([
      p('mest-grus', 7400, 0.95, 660),
      p('kortest', 22100, 0.25, 1440),
    ])
    expect(out[0].badges.map((b) => b.text)).toEqual(['MEST GRUS', 'KORTEST', 'RASKEST'])
    expect(out[1].badges).toEqual([])
  })
  it('hopper over MEST GRUS når ingen har kjent grusandel > 0', () => {
    const out = decorateProposals([p('a', 10000, null, 900), p('b', 12000, 0, 1000)])
    expect(out.flatMap((x) => x.badges.map((b) => b.text))).toEqual(['KORTEST', 'RASKEST'])
  })
  it('muterer ikke input-lista', () => {
    const input = [p('a', 10000, 0.5, 900), p('b', 12000, 0.4, 1000)]
    decorateProposals(input)
    expect(input[0].badges).toBeUndefined()
    expect(input[0].label).toBeUndefined()
  })
})
