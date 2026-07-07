import { describe, it, expect } from 'vitest'
import { useStifinner } from './useStifinner.js'

// Minimal fake-DOM (jsdom er ikke installert): dekker akkurat API-et
// featuresFromSvg/confirmStart bruker — querySelectorAll('[data-iso]'/'path'),
// getAttribute, tagName og parentNode-kjeden for nested-svg-offset.
function fakeEl(tagName, attrs = {}, children = []) {
  const node = {
    tagName,
    parentNode: null,
    children,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    querySelectorAll(sel) {
      const out = []
      const walk = (n) => {
        for (const c of n.children) {
          if (sel === '[data-iso]' && c.getAttribute('data-iso') != null) out.push(c)
          if (sel === 'path' && c.tagName === 'path') out.push(c)
          walk(c)
        }
      }
      walk(node)
      return out
    },
  }
  for (const c of children) c.parentNode = node
  return node
}

// Aktiv flis: sti (0,500)→(400,500). Spøkelses-flis plassert på x=400 med
// flis-LOKAL sti (0,500)→(400,500) — globalt (400,500)→(800,500).
function mosaicSvg() {
  const activeSti = fakeEl('g', { 'data-iso': '505' }, [
    fakeEl('path', { d: 'M0,500L400,500' }),
  ])
  const ghostSti = fakeEl('g', { 'data-iso': '505' }, [
    fakeEl('path', { d: 'M0,500L400,500' }),
  ])
  const ghostSvg = fakeEl('svg', { x: '400', y: '0' }, [ghostSti])
  const ghostContainer = fakeEl('g', { id: 'ghost-tiles' }, [ghostSvg])
  return fakeEl('svg', {}, [activeSti, ghostContainer])
}

describe('useStifinner – vann-guard for startpunkt', () => {
  it('startOnWater → ingen rute, ingen start-markør, feilmelding', () => {
    const sti = useStifinner()
    sti.begin({ svgX: 100, svgY: 100 })
    expect(sti.mode.value).toBe('pickingStart')

    sti.confirmStart({ x: 50, y: 50 }, null, { startOnWater: true })

    expect(sti.mode.value).toBe('showing')
    expect(sti.start.value).toBe(null)           // ingen villedende prikk i vann
    expect(sti.routes.value).toEqual([])
    expect(sti.error.value).toMatch(/vann/i)
  })

  it('uten vann-treff og uten kartdata → vanlig feilbane (start beholdes)', () => {
    const sti = useStifinner()
    sti.begin({ svgX: 100, svgY: 100 })

    sti.confirmStart({ x: 50, y: 50 }, null, { startOnWater: false })

    expect(sti.mode.value).toBe('showing')
    expect(sti.start.value).toEqual({ svgX: 50, svgY: 50 })
    expect(sti.error.value).toBe('Mangler kartdata')
  })
})

describe('useStifinner – estWalkMinutes (Naismith)', () => {
  it('flatt (uten høydeprofil): ren distanse ved 4 km/t', () => {
    const sti = useStifinner()
    expect(sti.estWalkMinutes(1000)).toBe(15)
    expect(sti.estWalkMinutes(4000)).toBe(60)
  })

  it('stigning gir Naismith-tillegg: +1 min per 10 m opp', () => {
    const sti = useStifinner()
    // Ulriken-tilfellet: 1,48 km med 443 m opp / 1 m ned var 22 min flatt —
    // med tillegg: 22,2 + 44,3 + 0,03 ≈ 67 min.
    expect(sti.estWalkMinutes(1480, { ascent: 443, descent: 1 })).toBe(67)
  })

  it('nedstigning gir mildt tillegg: +1 min per 30 m ned', () => {
    const sti = useStifinner()
    // Samme rute motsatt vei: 22,2 + 0,1 + 14,8 ≈ 37 min.
    expect(sti.estWalkMinutes(1480, { ascent: 1, descent: 443 })).toBe(37)
  })

  it('null/tom profil er lik flat-estimatet (kart uten DEM)', () => {
    const sti = useStifinner()
    expect(sti.estWalkMinutes(1480, null)).toBe(sti.estWalkMinutes(1480))
    expect(sti.estWalkMinutes(1480, { ascent: 0, descent: 0 })).toBe(sti.estWalkMinutes(1480))
  })

  it('aldri under 1 min', () => {
    const sti = useStifinner()
    expect(sti.estWalkMinutes(10)).toBe(1)
  })
})

describe('useStifinner – mosaikk (spøkelsesfliser)', () => {
  it('ruter på tvers av flisegrensen: ghost-paths løftes med nested-svg-offset', () => {
    const sti = useStifinner()
    sti.begin({ svgX: 790, svgY: 500 })          // B inne i spøkelsesflisa
    sti.confirmStart({ x: 10, y: 500 }, mosaicSvg(), {})

    expect(sti.error.value).toBe('')
    expect(sti.routes.value.length).toBeGreaterThan(0)
    const r = sti.routes.value[0]
    // Aktiv sti (0→400) + ghost-sti (400→800) syes sammen i skjøten.
    expect(r.lengthM).toBeCloseTo(800, 0)
    const xs = r.coordinates.map((c) => c[0])
    expect(Math.max(...xs)).toBeCloseTo(800, 0)
  })

  it('regresjon: ghost-paths tolkes IKKE i flis-lokale koordinater', () => {
    // Uten offset ville ghost-stien ligget duplisert oppå aktiv sti (0→400),
    // og B (790,500) hatt nærmeste node 390 m unna → over MAX_SNAP_M.
    const sti = useStifinner()
    sti.begin({ svgX: 790, svgY: 500 })
    sti.confirmStart({ x: 10, y: 500 }, mosaicSvg(), {})
    expect(sti.destSnap.value).toEqual({ x: 800, y: 500 })
  })
})
