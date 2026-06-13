import { describe, it, expect } from 'vitest'
import { depthToColor, sjokartToElements } from './sjokartFetcher.js'

describe('sjokartToElements — dybdeareal bevarer øy-hull', () => {
  // Et dybdeareal med en øy (Holmen-tilfellet): GML-polygon med outer + ett
  // hull. Hullet MÅ bevares, ellers males dybde over øya.
  const outer = [[10.0, 59.0], [10.1, 59.0], [10.1, 59.1], [10.0, 59.1], [10.0, 59.0]]
  const hole = [[10.04, 59.04], [10.06, 59.04], [10.06, 59.06], [10.04, 59.06], [10.04, 59.04]]

  it('polygon med hull → relation med outer + inner members', () => {
    const els = sjokartToElements({
      dybdeareal: [{ geometry: { type: 'Polygon', coordinates: [outer, hole] },
                     properties: { minimumsdybde: 2, maksimumsdybde: 5 } }],
    })
    const rel = els.find(e => e.type === 'relation')
    expect(rel).toBeTruthy()
    expect(rel.tags.sjokart).toBe('dybdeareal')
    expect(rel.members.filter(m => m.role === 'outer')).toHaveLength(1)
    expect(rel.members.filter(m => m.role === 'inner')).toHaveLength(1)
    expect(rel.members[1].geometry).toHaveLength(hole.length)
  })

  it('polygon UTEN hull → way (uendret)', () => {
    const els = sjokartToElements({
      dybdeareal: [{ geometry: { type: 'Polygon', coordinates: [outer] }, properties: {} }],
    })
    const way = els.find(e => e.type === 'way')
    expect(way).toBeTruthy()
    expect(els.some(e => e.type === 'relation')).toBe(false)
  })
})

describe('depthToColor — Fase 2 kystnær dempet dybdeskala', () => {
  it('5 distinkte bånd over kyst-relevante dyp', () => {
    const colors = [depthToColor(1), depthToColor(3), depthToColor(7),
                    depthToColor(15), depthToColor(40)]
    expect(new Set(colors).size).toBe(5)   // alle fem ulike
  })

  it('grunnest bånd (0–2 m) er lysest, dypest (20+) er mørkest', () => {
    const lum = (hex) => {
      const n = parseInt(hex.slice(1), 16)
      return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)
    }
    expect(lum(depthToColor(1))).toBeGreaterThan(lum(depthToColor(40)))
  })

  it('grensene treffer riktig bånd', () => {
    expect(depthToColor(0)).toBe(depthToColor(1.9))    // < 2
    expect(depthToColor(2)).toBe(depthToColor(4.9))    // 2–5
    expect(depthToColor(5)).toBe(depthToColor(9.9))    // 5–10
    expect(depthToColor(10)).toBe(depthToColor(19.9))  // 10–20
    expect(depthToColor(20)).toBe(depthToColor(200))   // 20+
    // og at nabobånd faktisk skiller seg
    expect(depthToColor(1.9)).not.toBe(depthToColor(2))
    expect(depthToColor(9.9)).not.toBe(depthToColor(10))
  })

  it('ugyldig/manglende dybde faller til grunneste bånd', () => {
    expect(depthToColor(NaN)).toBe(depthToColor(0))
    expect(depthToColor(undefined)).toBe(depthToColor(0))
  })

  it('alle bånd er dempede lav-kontrast blåtoner (smalt verdi-spenn)', () => {
    const lum = (hex) => {
      const n = parseInt(hex.slice(1), 16)
      return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3
    }
    const lums = [1, 3, 7, 15, 40].map(d => lum(depthToColor(d)))
    // Lav kontrast: spennet mellom lysest og mørkest skal være moderat
    // (ikke fra nesten-hvit til mørk marineblå). Holdes < 90 av 255.
    expect(Math.max(...lums) - Math.min(...lums)).toBeLessThan(90)
    // ...men ikke flatt (det MÅ være lesbar forskjell)
    expect(Math.max(...lums) - Math.min(...lums)).toBeGreaterThan(20)
  })
})
