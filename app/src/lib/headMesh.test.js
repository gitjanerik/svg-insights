import { describe, it, expect } from 'vitest'
import { buildHeadMesh, buildHairMesh } from './headMesh.js'

describe('buildHeadMesh', () => {
  it('genererer rimelig antall vertices og trekanter', () => {
    const mesh = buildHeadMesh()
    expect(mesh.vertices.length).toBeGreaterThan(150)
    expect(mesh.vertices.length).toBeLessThan(220)
    // 11 skiver à 16 punkter = 176 + 2 apex = 178 forventet
    expect(mesh.triangles.length).toBeGreaterThan(300)
    expect(mesh.triangles.length).toBeLessThan(400)
  })

  it('alle trekant-indekser er innenfor vertices.length', () => {
    const mesh = buildHeadMesh()
    for (const [a, b, c] of mesh.triangles) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(mesh.vertices.length)
      expect(b).toBeLessThan(mesh.vertices.length)
      expect(c).toBeLessThan(mesh.vertices.length)
      expect(a).not.toBe(b)
      expect(b).not.toBe(c)
    }
  })

  it('inneholder feature-posisjoner for øyne, bryn, nese, munn', () => {
    const mesh = buildHeadMesh()
    expect(mesh.features.leftEye).toBeDefined()
    expect(mesh.features.rightEye).toBeDefined()
    expect(mesh.features.leftBrow.length).toBe(5)
    expect(mesh.features.rightBrow.length).toBe(5)
    expect(mesh.features.noseTip).toBeDefined()
    expect(mesh.features.mouthLeft).toBeDefined()
    expect(mesh.features.mouthRight).toBeDefined()
  })

  it('skalerer headHeight med proporsjonene', () => {
    const small = buildHeadMesh({ faceHeight: 3 })
    const big = buildHeadMesh({ faceHeight: 6 })
    expect(big.bounds.headHeight).toBeGreaterThan(small.bounds.headHeight)
  })

  it('nesa stikker fram (Z større ved nese-tipp enn hode-bredde)', () => {
    const mesh = buildHeadMesh()
    expect(mesh.features.noseTip.Z).toBeGreaterThan(mesh.bounds.headDepth)
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
