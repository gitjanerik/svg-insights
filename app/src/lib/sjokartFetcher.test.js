import { describe, it, expect } from 'vitest'
import { depthToColor, depthToFillVar, sjokartToElements, sjokartTimeoutForBbox, summarizeSjokartStatus } from './sjokartFetcher.js'

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

describe('depthToColor — kystnær dempet dybdeskala (v11.0.50: 3 bånd)', () => {
  it('3 distinkte bånd over kyst-relevante dyp', () => {
    const colors = [depthToColor(2), depthToColor(12), depthToColor(40)]
    expect(new Set(colors).size).toBe(3)   // grunt / middels / dypt
  })

  it('grunnest bånd (0–5 m) er lysest, dypest (20+) er mørkest', () => {
    const lum = (hex) => {
      const n = parseInt(hex.slice(1), 16)
      return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)
    }
    expect(lum(depthToColor(1))).toBeGreaterThan(lum(depthToColor(40)))
  })

  it('grensene treffer riktig bånd', () => {
    expect(depthToColor(0)).toBe(depthToColor(4.9))    // 0–5
    expect(depthToColor(5)).toBe(depthToColor(19.9))   // 5–20
    expect(depthToColor(20)).toBe(depthToColor(200))   // 20+
    // og at nabobånd faktisk skiller seg
    expect(depthToColor(4.9)).not.toBe(depthToColor(5))
    expect(depthToColor(19.9)).not.toBe(depthToColor(20))
  })

  it('ugyldig/manglende dybde faller til grunneste bånd', () => {
    expect(depthToColor(NaN)).toBe(depthToColor(0))
    expect(depthToColor(undefined)).toBe(depthToColor(0))
  })

  it('depthToFillVar pakker hver dybde i tema-variabel med lys-hex som fallback', () => {
    // var(--iso-depth-N, #hex) — N følger båndet (1/3/5), hexen er depthToColor.
    expect(depthToFillVar(2)).toBe(`var(--iso-depth-1, ${depthToColor(2)})`)   // grunt
    expect(depthToFillVar(12)).toBe(`var(--iso-depth-3, ${depthToColor(12)})`) // middels
    expect(depthToFillVar(40)).toBe(`var(--iso-depth-5, ${depthToColor(40)})`) // dypt
    // ugyldig dybde → grunneste bånd (samme som depthToColor)
    expect(depthToFillVar(NaN)).toBe(`var(--iso-depth-1, ${depthToColor(0)})`)
  })

  it('alle bånd er dempede lav-kontrast blåtoner (smalt verdi-spenn)', () => {
    const lum = (hex) => {
      const n = parseInt(hex.slice(1), 16)
      return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3
    }
    const lums = [2, 12, 40].map(d => lum(depthToColor(d)))
    // Lav kontrast: spennet mellom lysest og mørkest skal være moderat
    // (ikke fra nesten-hvit til mørk marineblå). Holdes < 90 av 255.
    expect(Math.max(...lums) - Math.min(...lums)).toBeLessThan(90)
    // ...men ikke flatt (det MÅ være lesbar forskjell)
    expect(Math.max(...lums) - Math.min(...lums)).toBeGreaterThan(20)
  })
})

describe('sjokartTimeoutForBbox — areal-skalert klient-tak', () => {
  it('lite kart (~1 km²) bruker baseline 8 s', () => {
    expect(sjokartTimeoutForBbox({ south: 59, north: 59.01, west: 10, east: 10.01 })).toBe(8000)
  })
  it('4 km-kart (~16 km²) holder seg på baseline', () => {
    const b = { south: 59.782, north: 59.818, west: 10.465, east: 10.535 }
    expect(sjokartTimeoutForBbox(b)).toBeLessThanOrEqual(10000)
  })
  it('12 km-standardkart (~144 km²) klatrer mot 40 s', () => {
    // 12 km bredt kvadrat rundt 59.8°N (Nesøya-klassen)
    const b = { south: 59.746, north: 59.854, west: 10.394, east: 10.606 }
    const t = sjokartTimeoutForBbox(b)
    expect(t).toBeGreaterThan(30000)
    expect(t).toBeLessThanOrEqual(45000)
  })
  it('klamper aldri over 45 s-taket', () => {
    expect(sjokartTimeoutForBbox({ south: 59, north: 60, west: 10, east: 12 })).toBe(45000)
  })
  it('tåler manglende bbox', () => {
    expect(sjokartTimeoutForBbox(null)).toBe(8000)
  })
})

describe('summarizeSjokartStatus — utfall til kart-meta', () => {
  it('features levert → ok med kilde', () => {
    const s = summarizeSjokartStatus({ source: 'https://wfs.geonorge.no/skwms1/wfs.dybdedata', fetchErrors: [] }, 312)
    expect(s.state).toBe('ok')
    expect(s.features).toBe(312)
    expect(s.source).toContain('wfs.dybdedata')
  })
  it('timeout-flagg vinner over feature-telling', () => {
    const s = summarizeSjokartStatus({ timedOut: true, timeoutMs: 40000 }, 0)
    expect(s.state).toBe('timeout')
    expect(s.timeoutMs).toBe(40000)
  })
  it('innlands-skip rapporteres som innlands', () => {
    expect(summarizeSjokartStatus({ skipped: true }, 0).state).toBe('innlands')
  })
  it('exception underveis → feil', () => {
    expect(summarizeSjokartStatus({ failed: true }, 0).state).toBe('feil')
  })
  it('0 features uten flagg → tom', () => {
    expect(summarizeSjokartStatus({ fetchErrors: [] }, 0).state).toBe('tom')
  })
  it('feil trimmes: maks 4 stk, kort endpoint og maks 120 tegn melding', () => {
    const errs = Array.from({ length: 7 }, (_, i) => ({
      endpoint: 'https://wfs.geonorge.no/skwms1/wfs.dybdedata',
      typeName: `app:Type${i}`,
      kind: 'network-or-cors',
      message: 'x'.repeat(300),
    }))
    const s = summarizeSjokartStatus({ fetchErrors: errs }, 0)
    expect(s.errors).toHaveLength(4)
    expect(s.errors[0].endpoint).toBe('wfs.dybdedata')
    expect(s.errors[0].message.length).toBeLessThanOrEqual(120)
  })
})
