import { describe, it, expect } from 'vitest'
import { buildSvg, thinParkering, PARKERING_MIN_SEP_M } from './mapBuilder.js'

// ISOM-derivert 534: parkering. Uttynning av tett plasserte P-symboler (samme
// behov som holdeplass-klyngingen) — men utfartsparkering (534u) vises ALLTID.

const bbox = { south: 59.0, west: 10.0, north: 59.05, east: 10.1 }
const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags })

describe('thinParkering — vanlige P-plasser tynnes til min-avstand', () => {
  const ord = (x, y) => ({ p: { x, y }, utfart: false })
  const utf = (x, y) => ({ p: { x, y }, utfart: true })

  it('to vanlige P < 50 m fra hverandre → kun én beholdes', () => {
    const kept = thinParkering([ord(0, 0), ord(30, 0)])
    expect(kept).toHaveLength(1)
  })

  it('to vanlige P ≥ 50 m fra hverandre → begge beholdes', () => {
    const kept = thinParkering([ord(0, 0), ord(60, 0)])
    expect(kept).toHaveLength(2)
  })

  it('tett rekke vanlige P (10 m mellomrom) → kun de som ligger ≥ 50 m unna en beholdt', () => {
    // Greedy fra første: 0 beholdes, 10/20/30/40 droppes, 50 beholdes, ...
    const items = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(m => ord(m, 0))
    const kept = thinParkering(items)
    expect(kept.map(k => k.p.x)).toEqual([0, 50, 100])
  })

  it('utfartsparkering beholdes ALLTID, uansett nærhet til andre utfart', () => {
    const kept = thinParkering([utf(0, 0), utf(5, 0), utf(10, 0)])
    expect(kept).toHaveLength(3)
  })

  it('vanlig P tett på en utfart droppes (utfart vinner)', () => {
    const kept = thinParkering([utf(0, 0), ord(20, 0)])
    expect(kept).toHaveLength(1)
    expect(kept[0].utfart).toBe(true)
  })

  it('opprinnelig rekkefølge bevares', () => {
    const a = ord(0, 0), b = ord(200, 0), c = ord(400, 0)
    const kept = thinParkering([a, b, c])
    expect(kept).toEqual([a, b, c])
  })

  it('tom/ugyldig input håndteres', () => {
    expect(thinParkering([])).toEqual([])
    expect(thinParkering(null)).toEqual([])
    expect(thinParkering([{ p: { x: NaN, y: 0 }, utfart: false }])).toEqual([])
  })

  it('terskelen er 50 m', () => {
    expect(PARKERING_MIN_SEP_M).toBe(50)
  })
})

describe('buildSvg — parkering tynnes', () => {
  const lat0 = 59.025
  const m2dLon = (m) => m / (111195 * Math.cos(lat0 * Math.PI / 180))

  it('klynge av private P < 50 m → færre P-symboler enn input', () => {
    const ps = [0, 12, 24, 36, 48].map((m, i) =>
      node(i + 1, lat0, 10.05 + m2dLon(m), { amenity: 'parking' })
    )
    const { svg, counts } = buildSvg(ps, bbox, {})
    expect(counts.parkering).toBe(5) // alle telles ved klassifisering
    const uses = (svg.match(/href="#iso-sym-parkering"/g) || []).length
    expect(uses).toBe(1) // men bare én rendres (alle innen 50 m av første)
  })

  it('private P ≥ 50 m fra hverandre → alle rendres', () => {
    const ps = [0, 60, 120].map((m, i) =>
      node(i + 1, lat0, 10.05 + m2dLon(m), { amenity: 'parking' })
    )
    const { svg } = buildSvg(ps, bbox, {})
    const uses = (svg.match(/href="#iso-sym-parkering"/g) || []).length
    expect(uses).toBe(3)
  })
})
