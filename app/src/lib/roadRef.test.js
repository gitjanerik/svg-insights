import { describe, it, expect } from 'vitest'
import { buildSvg } from './mapBuilder.js'

// v12.0.15: veinummer-skilt (E-vei grønt / fylkesvei hvit boks) + sti-casing.

const bbox = { south: 59.0, west: 10.0, north: 59.05, east: 10.1 }
const way = (id, tags, geometry) => ({ type: 'way', id, tags, geometry })
// ~3,4 km øst-vest-linje midt i bbox-en — lang nok for skilt-plassering (>60 m).
const lineGeom = (lat = 59.02) => [
  { lat, lon: 10.02 }, { lat, lon: 10.05 }, { lat, lon: 10.08 },
]

describe('buildSvg — veinummer-skilt', () => {
  it('motorway med ref E18 gir grønt skilt (data-rank="e") i veinummer-laget', () => {
    const { svg } = buildSvg([way(1, { highway: 'motorway', ref: 'E 18' }, lineGeom())], bbox, {})
    expect(svg).toContain('data-layer="veinummer"')
    expect(svg).toContain('data-rank="e"')
    expect(svg).toContain('>E18</text>')
    expect(svg).toContain('fill="#157a3d"')
  })

  it('fylkesvei (tertiary, ref Fv 164) gir hvit boks (data-rank="fylke") med bare tallet', () => {
    const { svg } = buildSvg([way(2, { highway: 'tertiary', ref: 'Fv 164' }, lineGeom())], bbox, {})
    expect(svg).toContain('data-rank="fylke"')
    expect(svg).toContain('>164</text>')
    expect(svg).not.toContain('Fv')
    // LOD: fylkesvei-skilt holdes igjen til .zoomed-in
    expect(svg).toContain(':not(.zoomed-in) [data-label="veinummer"][data-rank="fylke"]')
  })

  it('samme ref på nærliggende ways kollapses til ett skilt (~1,5 km-avstand)', () => {
    const els = [
      way(3, { highway: 'primary', ref: '164' }, lineGeom(59.02)),
      way(4, { highway: 'primary', ref: '164' }, lineGeom(59.021)),
    ]
    const { svg } = buildSvg(els, bbox, {})
    const badges = svg.match(/<text data-label="veinummer"[^>]*data-rank="fylke"/g) ?? []
    expect(badges.length).toBe(1)
  })

  it('vei uten ref gir ikke veinummer-lag', () => {
    const { svg } = buildSvg([way(5, { highway: 'tertiary' }, lineGeom())], bbox, {})
    expect(svg).not.toContain('data-layer="veinummer"')
  })
})

describe('buildSvg — sti-casing (505)', () => {
  it('sti emitterer casing-tvilling under den stiplede streken + .casing-CSS', () => {
    const { svg } = buildSvg([way(6, { highway: 'path' }, lineGeom())], bbox, {})
    const group = svg.match(/<g data-layer="sti" data-iso="505">([\s\S]*?)<\/g>/)?.[1] ?? ''
    const casingIdx = group.indexOf('class="casing"')
    const plainIdx = group.indexOf('<path d=', casingIdx + 1)
    expect(casingIdx).toBeGreaterThan(-1)
    // casing-pathen ligger FØRST så stiplingen tegnes oppå
    expect(plainIdx).toBeGreaterThan(casingIdx)
    // CSS: casing faller tilbake på var(--bg) og stiplingen bruker butt-caps
    expect(svg).toContain('path.casing')
    expect(svg).toContain('var(--iso-505-casing-stroke, var(--bg, #fbf7ec))')
    expect(svg).toMatch(/data-iso="505"\][^}]*stroke-linecap: butt/)
  })
})
