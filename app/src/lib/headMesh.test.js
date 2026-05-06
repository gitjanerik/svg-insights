import { describe, it, expect } from 'vitest'
import { buildHeadMesh, buildHairMesh } from './headMesh.js'

describe('buildHeadMesh', () => {
  it('genererer rimelig antall vertices og trekanter (inkl. features)', () => {
    const mesh = buildHeadMesh()
    expect(mesh.vertices.length).toBeGreaterThan(180) // 178 hode + features
    expect(mesh.triangles.length).toBeGreaterThan(350)
  })

  it('alle trekant-indekser er innenfor vertices.length', () => {
    const mesh = buildHeadMesh()
    for (const t of mesh.triangles) {
      const [a, b, c] = t.indices
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(mesh.vertices.length)
      expect(b).toBeLessThan(mesh.vertices.length)
      expect(c).toBeLessThan(mesh.vertices.length)
      expect(a).not.toBe(b)
      expect(b).not.toBe(c)
    }
  })

  it('inneholder alle region-tags', () => {
    const mesh = buildHeadMesh()
    const regions = new Set(mesh.triangles.map(t => t.region))
    expect(regions.has('skin')).toBe(true)
    expect(regions.has('eyeSocket')).toBe(true)
    expect(regions.has('nose')).toBe(true)
    expect(regions.has('lips')).toBe(true)
  })

  it('har øyenbryn-buer for 2D-overlay', () => {
    const mesh = buildHeadMesh()
    expect(mesh.features.leftBrow.length).toBe(5)
    expect(mesh.features.rightBrow.length).toBe(5)
  })

  it('skalerer headHeight med proporsjonene', () => {
    const small = buildHeadMesh({ faceHeight: 3 })
    const big = buildHeadMesh({ faceHeight: 6 })
    expect(big.bounds.headHeight).toBeGreaterThan(small.bounds.headHeight)
  })

  it('headWidth følger faceAspect', () => {
    const narrow = buildHeadMesh({ faceHeight: 4 }, { faceAspect: 0.6 })
    const wide = buildHeadMesh({ faceHeight: 4 }, { faceAspect: 0.95 })
    expect(wide.bounds.headWidth).toBeGreaterThan(narrow.bounds.headWidth)
  })
})

describe('buildHairMesh', () => {
  it('returnerer null uten hår', () => {
    const head = buildHeadMesh()
    expect(buildHairMesh(head, { hasHair: false })).toBeNull()
    expect(buildHairMesh(head, null)).toBeNull()
  })

  it('genererer mesh med vertices og trekanter når hår er detektert', () => {
    const head = buildHeadMesh()
    const hair = buildHairMesh(head, { hasHair: true, length: 0.4 })
    expect(hair).not.toBeNull()
    expect(hair.vertices.length).toBeGreaterThan(40)
    expect(hair.triangles.length).toBeGreaterThan(60)
  })

  it('mer hår = større volum', () => {
    const head = buildHeadMesh()
    const short = buildHairMesh(head, { hasHair: true, length: 0.2 })
    const long = buildHairMesh(head, { hasHair: true, length: 0.9 })
    // Sjekk Y-bounds: lengre hår skal ha lavere (= høyere på skjermen) min-Y
    const shortMinY = Math.min(...short.vertices.map(v => v.Y))
    const longMinY = Math.min(...long.vertices.map(v => v.Y))
    expect(longMinY).toBeLessThan(shortMinY)
  })
})
