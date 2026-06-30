import { describe, it, expect } from 'vitest'
import { declutter, makeMinZoomOf } from './labelDeclutter.js'

// Hjelper: kandidat med fornuftige defaults.
const cand = (o) => ({
  id: o.id, score: o.score ?? 50, sx: o.sx ?? 0, sy: o.sy ?? 0,
  halfW: o.halfW ?? 20, halfH: o.halfH ?? 6, group: o.group ?? 'quota',
  forced: o.forced ?? false,
})

const allVisibleZoom = { minZoomOf: () => 0, scale: 1 }

describe('declutter — kollisjon', () => {
  it('skjuler lavere-score navn som overlapper et høyere-score navn', () => {
    const a = cand({ id: 'Høy', score: 90, sx: 100, sy: 100 })
    const b = cand({ id: 'Lav', score: 10, sx: 110, sy: 100 }) // overlapper a
    const vis = declutter([a, b], { ...allVisibleZoom, cellPx: 9999, K: 99 })
    expect(vis.has('Høy')).toBe(true)
    expect(vis.has('Lav')).toBe(false)
  })

  it('beholder begge når de ikke overlapper', () => {
    const a = cand({ id: 'A', score: 90, sx: 0, sy: 0 })
    const b = cand({ id: 'B', score: 10, sx: 1000, sy: 1000 })
    const vis = declutter([a, b], { ...allVisibleZoom, cellPx: 9999, K: 99 })
    expect(vis.has('A')).toBe(true)
    expect(vis.has('B')).toBe(true)
  })
})

describe('declutter — rutenett-kvote', () => {
  it('slipper kun K navn per celle for quota-gruppen', () => {
    // Tre ikke-overlappende quota-navn i samme 240px-celle.
    const cs = [
      cand({ id: 'a', score: 60, sx: 10, sy: 10 }),
      cand({ id: 'b', score: 50, sx: 10, sy: 60 }),
      cand({ id: 'c', score: 40, sx: 10, sy: 110 }),
    ]
    const vis = declutter(cs, { ...allVisibleZoom, cellPx: 240, K: 2 })
    expect(vis.size).toBe(2)
    expect(vis.has('a')).toBe(true)   // høyest score vinner kvote-plassene
    expect(vis.has('b')).toBe(true)
    expect(vis.has('c')).toBe(false)
  })

  it('priority-gruppen går utenom kvoten (men kollisjonssjekkes)', () => {
    const cs = [
      cand({ id: 'p1', score: 60, sx: 10, sy: 10, group: 'priority' }),
      cand({ id: 'p2', score: 55, sx: 10, sy: 60, group: 'priority' }),
      cand({ id: 'p3', score: 50, sx: 10, sy: 110, group: 'priority' }),
    ]
    const vis = declutter(cs, { ...allVisibleZoom, cellPx: 240, K: 1 })
    expect(vis.size).toBe(3)   // alle tre tross K=1, fordi de er priority + ikke-overlappende
  })
})

describe('declutter — maxVisible (globalt tak)', () => {
  it('plasserer aldri flere enn maxVisible (høyest score vinner)', () => {
    const cs = [
      cand({ id: 'a', score: 90, sx: 0, sy: 0 }),
      cand({ id: 'b', score: 70, sx: 0, sy: 1000 }),
      cand({ id: 'c', score: 50, sx: 1000, sy: 0 }),
    ]
    const vis = declutter(cs, { ...allVisibleZoom, cellPx: 9999, K: 99, maxVisible: 2 })
    expect(vis.size).toBe(2)
    expect(vis.has('a')).toBe(true)
    expect(vis.has('b')).toBe(true)
    expect(vis.has('c')).toBe(false)
  })

  it('forced teller ikke mot maxVisible', () => {
    const cs = [
      cand({ id: 'pin', score: 5, sx: 500, sy: 500, forced: true }),
      cand({ id: 'a', score: 90, sx: 0, sy: 0 }),
    ]
    const vis = declutter(cs, { ...allVisibleZoom, cellPx: 9999, K: 99, maxVisible: 1 })
    expect(vis.has('pin')).toBe(true)
    expect(vis.has('a')).toBe(true)
  })
})

describe('declutter — LOD + hysterese', () => {
  it('dropper navn under sin minZoom-terskel', () => {
    const minZoomOf = makeMinZoomOf(2.5)
    const lowScore = cand({ id: 'liten', score: 10 }) // minZoom 4
    const visFar = declutter([lowScore], { minZoomOf, scale: 1, cellPx: 9999, K: 99 })
    expect(visFar.has('liten')).toBe(false)
    const visNear = declutter([lowScore], { minZoomOf, scale: 4, cellPx: 9999, K: 99 })
    expect(visNear.has('liten')).toBe(true)
  })

  it('hysterese: et allerede-vist navn overlever litt under terskelen', () => {
    const minZoomOf = () => 2.0
    const c = cand({ id: 'sticky', score: 50 })
    // scale 1.8 < 2.0, men >= 2.0*0.85=1.7 ⇒ beholdes når den var vist før
    const visSticky = declutter([c], { minZoomOf, scale: 1.8, prevShown: new Set(['sticky']), cellPx: 9999, K: 99 })
    expect(visSticky.has('sticky')).toBe(true)
    // uten prevShown faller den ut ved samme zoom
    const visFresh = declutter([c], { minZoomOf, scale: 1.8, cellPx: 9999, K: 99 })
    expect(visFresh.has('sticky')).toBe(false)
  })
})

describe('declutter — søke-pin (forced)', () => {
  it('forced vises alltid, uavhengig av LOD og kvote', () => {
    const minZoomOf = () => 99   // ingen vanlig kandidat kvalifiserer
    const pin = cand({ id: 'søkt', score: 5, forced: true })
    const vis = declutter([pin], { minZoomOf, scale: 1, cellPx: 1, K: 0 })
    expect(vis.has('søkt')).toBe(true)
  })

  it('forced suppresser IKKE en overlappende nabo (tegnes over)', () => {
    const pin = cand({ id: 'søkt', score: 5, sx: 100, sy: 100, forced: true })
    const neighbor = cand({ id: 'nabo', score: 90, sx: 105, sy: 100 })
    const vis = declutter([pin, neighbor], { ...allVisibleZoom, cellPx: 9999, K: 99 })
    expect(vis.has('søkt')).toBe(true)
    expect(vis.has('nabo')).toBe(true)   // naboen beholdes — pinnen har ikke kollisjons-fotavtrykk
  })
})

describe('declutter — determinisme', () => {
  it('gir identisk resultat ved gjentatte kjøringer (stabil tie-break)', () => {
    const cs = [
      cand({ id: 'b', score: 50, sx: 10, sy: 10 }),
      cand({ id: 'a', score: 50, sx: 12, sy: 10 }), // lik score, overlapper b
    ]
    const r1 = [...declutter(cs, { ...allVisibleZoom, cellPx: 9999, K: 99 })]
    const r2 = [...declutter(cs, { ...allVisibleZoom, cellPx: 9999, K: 99 })]
    expect(r1).toEqual(r2)
    expect(r1).toEqual(['a'])   // 'a' < 'b' alfabetisk vinner ved lik score
  })
})

describe('makeMinZoomOf', () => {
  it('høyere score ⇒ synlig ved lavere zoom (løs LOD)', () => {
    const f = makeMinZoomOf(2.5)
    expect(f(95)).toBe(0)
    expect(f(70)).toBe(0)
    expect(f(50)).toBe(0.9)
    expect(f(25)).toBe(1.3)
    expect(f(5)).toBe(1.8)
    // monotont ikke-økende med score
    expect(f(60)).toBeLessThanOrEqual(f(40))
    expect(f(40)).toBeLessThanOrEqual(f(10))
  })
})

describe('declutter — stickiness (ingen «kommer og går»)', () => {
  it('et allerede-vist navn beholder plassen foran et nytt høyere-score navn som overlapper', () => {
    const sticky = cand({ id: 'gammel', score: 20, sx: 100, sy: 100 })
    const fresh = cand({ id: 'ny', score: 95, sx: 108, sy: 100 }) // overlapper
    const vis = declutter([sticky, fresh], {
      ...allVisibleZoom, cellPx: 9999, K: 99, prevShown: new Set(['gammel']),
    })
    expect(vis.has('gammel')).toBe(true)   // blir værende — ingen blinking
    expect(vis.has('ny')).toBe(false)
  })

  it('sticky bypasser rutenett-kvoten (vokser ikke vekk det som alt vises)', () => {
    const cs = [
      cand({ id: 'a', score: 60, sx: 10, sy: 10 }),
      cand({ id: 'b', score: 50, sx: 10, sy: 60 }),
      cand({ id: 'c', score: 40, sx: 10, sy: 110 }),
    ]
    const prevShown = new Set(['a', 'b', 'c'])
    const vis = declutter(cs, { ...allVisibleZoom, cellPx: 240, K: 1, prevShown })
    expect(vis.size).toBe(3)   // alle tre beholdes tross K=1, fordi de var vist
  })

  it('et nytt navn dukker IKKE opp i en celle som alt er full av sticky', () => {
    const cs = [
      cand({ id: 's1', score: 60, sx: 10, sy: 10 }),
      cand({ id: 'ny', score: 90, sx: 10, sy: 90 }),  // samme 240px-celle, ikke overlapp
    ]
    const vis = declutter(cs, { ...allVisibleZoom, cellPx: 240, K: 1, prevShown: new Set(['s1']) })
    expect(vis.has('s1')).toBe(true)
    expect(vis.has('ny')).toBe(false)   // cellen er allerede «brukt opp» av sticky
  })
})
