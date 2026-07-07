import { describe, it, expect } from 'vitest'
import { buildRouteOverlaySvg, injectOverlay, ROUTE_COLORS } from './routeOverlay.js'

const route = (coords, shortest = false) => ({ coordinates: coords, shortest })

describe('buildRouteOverlaySvg', () => {
  it('tegner en rute med hvit halo + farget linje', () => {
    const g = buildRouteOverlaySvg({ routes: [route([[0, 0], [100, 50]])] })
    expect(g).toContain('data-layer="stiforslag"')
    expect(g).toContain('rgba(255,255,255,0.95)')          // halo
    expect(g).toContain(ROUTE_COLORS[0])                    // farget linje
    expect(g).toContain('M0,0L100,50')                      // path fra polylineToPath
  })

  it('tegner start (grønn) og mål (rød) prikker', () => {
    const g = buildRouteOverlaySvg({ start: [10, 20], dest: [30, 40] })
    expect(g).toContain('#16a34a') // grønn start
    expect(g).toContain('#dc2626') // rød mål
    expect(g).toContain('cx="10.0"')
    expect(g).toContain('cx="30.0"')
  })

  it('tegner stiplet connector', () => {
    const g = buildRouteOverlaySvg({ connectors: [{ from: [0, 0], to: [5, 5] }] })
    expect(g).toContain('stroke-dasharray')
    expect(g).toContain('#64748b')
  })

  it('tegner markør med etikett og escaper tekst', () => {
    const g = buildRouteOverlaySvg({ markers: [{ x: 1, y: 2, label: 'A & B', color: '#f59e0b' }] })
    expect(g).toContain('#f59e0b')
    expect(g).toContain('A &amp; B')
  })

  it('gir valgt rute litt tykkere strek enn ikke-valgt, begge semitransparente', () => {
    const g = buildRouteOverlaySvg({
      routes: [route([[0, 0], [10, 0]]), route([[0, 5], [10, 5]])],
      selectedIndex: 0,
    })
    // Valgt halo = 18, ikke-valgt = 16 (ingen 100 %-opak, tykk blokk lenger)
    expect(g).toContain('stroke-width="18"')
    expect(g).toContain('stroke-width="16"')
    // Ingen strek er 100 % opak — alle rute-streker er semitransparente.
    expect(g).not.toMatch(/stroke="#dc2626"[^/]*opacity="1"/)
    expect(g).toContain('opacity="0.72"') // valgt rute-opasitet
  })

  it('tåler tom input', () => {
    expect(buildRouteOverlaySvg()).toBe('<g data-layer="stiforslag" pointer-events="none"></g>')
  })
})

describe('injectOverlay', () => {
  it('setter overlay rett før </svg>', () => {
    const svg = '<svg viewBox="0 0 10 10"><rect/></svg>'
    const out = injectOverlay(svg, '<g id="x"/>')
    expect(out).toBe('<svg viewBox="0 0 10 10"><rect/><g id="x"/>\n</svg>')
  })

  it('appender når </svg> mangler', () => {
    expect(injectOverlay('<svg>', '<g/>')).toBe('<svg><g/>')
  })
})
