import { describe, it, expect } from 'vitest'
import { meshToSvg, rotateY } from './meshToSvg.js'
import { buildHeadMesh } from './headMesh.js'
import { defaultPalette } from './portraitPalettes.js'

describe('rotateY', () => {
  it('lar Y-koordinaten være urørt', () => {
    const v = { X: 1, Y: 5, Z: 1 }
    const r = rotateY(v, 1.2)
    expect(r.Y).toBe(5)
  })

  it('roterer 90° korrekt', () => {
    const v = { X: 1, Y: 0, Z: 0 }
    const r = rotateY(v, Math.PI / 2)
    expect(r.X).toBeCloseTo(0, 5)
    expect(r.Z).toBeCloseTo(1, 5)
  })
})

describe('meshToSvg', () => {
  it('returnerer null for null mesh', () => {
    expect(meshToSvg({ mesh: null, palette: defaultPalette() })).toBeNull()
  })

  it('genererer SVG med polygoner', () => {
    const mesh = buildHeadMesh()
    const svg = meshToSvg({ mesh, palette: defaultPalette() })
    expect(svg).toContain('<svg')
    expect(svg).toContain('<polygon')
    expect(svg).toContain('viewBox=')
  })

  it('wireframe-modus tegner kun stroke', () => {
    const mesh = buildHeadMesh()
    const svg = meshToSvg({ mesh, palette: defaultPalette(), mode: 'wireframe' })
    // Skal ha stroke men ingen fyll på trekantene
    expect(svg).toContain('fill="none"')
    expect(svg).toContain('stroke=')
  })

  it('shaded-modus tegner kun fyll', () => {
    const mesh = buildHeadMesh()
    const svg = meshToSvg({ mesh, palette: defaultPalette(), mode: 'shaded' })
    // Skal ikke ha noen polygoner uten fyll
    expect(svg.match(/<polygon[^>]*fill="none"/)).toBeNull()
  })

  it('både fyll og kant i both-modus', () => {
    const mesh = buildHeadMesh()
    const svg = meshToSvg({ mesh, palette: defaultPalette(), mode: 'both' })
    expect(svg).toContain('stroke=')
    // Minst én polygon skal ha en konkret farge (ikke 'none')
    expect(svg).toMatch(/fill="#[0-9A-Fa-f]{6}"/)
  })

  it('rotasjon endrer SVG-output', () => {
    const mesh = buildHeadMesh()
    const a = meshToSvg({ mesh, palette: defaultPalette(), rotY: 0 })
    const b = meshToSvg({ mesh, palette: defaultPalette(), rotY: Math.PI / 4 })
    expect(a).not.toBe(b)
  })

  it('inkluderer briller når detektert', () => {
    const mesh = buildHeadMesh()
    const svg = meshToSvg({
      mesh,
      palette: defaultPalette(),
      glasses: { hasGlasses: true, darkness: 0.5 },
    })
    expect(svg).toContain('<circle')
  })
})
