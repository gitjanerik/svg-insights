import { describe, it, expect } from 'vitest'
import { buildRouteSvg } from './routeSvgExport.js'
import { buildRouteProfile } from './routeElevation.js'

const baseRoute = {
  navn: 'Hokksund – Mjøndalen',
  points: [
    [9.87, 59.71, 20],
    [9.90, 59.72, 80],
    [9.94, 59.71, 45],
    [9.96, 59.72, 30],
  ],
  segments: [
    { fromIdx: 0, toIdx: 2, distM: 3000, surface: 'gravel', gravel: true },
    { fromIdx: 2, toIdx: 3, distM: 1500, surface: 'paved', gravel: false },
  ],
  lengthM: 4500,
  gravelShare: 0.67,
  estimatedTimeS: 540,
}

describe('buildRouteSvg', () => {
  it('bygger en selvstendig SVG med rute, markører og nøkkeltall', () => {
    const svg = buildRouteSvg(baseRoute, { now: 0 })
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('Hokksund – Mjøndalen')
    // Underlagsfargede segmenter + A/B-markører
    expect(svg).toContain('stroke="#e8802b"')
    expect(svg).toContain('stroke="#94a3b8"')
    expect(svg).toContain('>A</text>')
    expect(svg).toContain('>B</text>')
    expect(svg).toContain('4.5 km')
    expect(svg).toContain('67 %')
    expect(svg).toContain('9 min')
    expect(svg).toContain('© OpenStreetMap-bidragsytere · Ruting: BRouter (brouter.de)')
  })
  it('escaper rutenavn (XML-utrygge tegn)', () => {
    const svg = buildRouteSvg({ ...baseRoute, navn: 'A <&> B' }, { now: 0 })
    expect(svg).toContain('A &lt;&amp;&gt; B')
    expect(svg).not.toContain('A <&> B')
  })
  it('tegner uniform grus-path uten segmentdata og dropper grus-baren uten andel', () => {
    const svg = buildRouteSvg({ ...baseRoute, segments: null, gravelShare: null }, { now: 0 })
    expect(svg).toContain('stroke="#e8802b"')
    expect(svg).not.toContain('Asfalt')
    expect(svg).not.toContain('HØYDEPROFIL')
  })
  it('inkluderer høydeprofil-seksjonen når profil er med', () => {
    const profile = buildRouteProfile(baseRoute.points, { segments: baseRoute.segments })
    const svg = buildRouteSvg(baseRoute, { profile, now: 0 })
    expect(svg).toContain('HØYDEPROFIL')
    expect(svg).toContain('moh')
    expect(svg).toContain('↗')
  })
  it('returnerer tom streng uten geometri', () => {
    expect(buildRouteSvg(null)).toBe('')
    expect(buildRouteSvg({ points: [] })).toBe('')
  })
})
