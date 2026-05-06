import { describe, it, expect } from 'vitest'
import { buildPortraitModel, rotateY, rotateModel } from './portraitModel.js'

const sampleProportions = {
  eyeDistance: 0.6,
  noseLength: 0.83,
  noseProjection: -0.33,
  mouthDrop: 1.5,
  foreheadHeight: -2.0,
  chinDrop: 2.5,
  faceHeight: 4.5,
  eyeCenter: { X: 0, Y: -0.5, Z: 0 },
  landmarks: {
    leftEye: { X: -0.3, Y: -0.5, Z: 0 },
    rightEye: { X: 0.3, Y: -0.5, Z: 0 },
    nose: { X: 0, Y: 0, Z: -0.2 },
    mouth: { X: 0, Y: 0.4, Z: -0.05 },
    forehead: { X: 0, Y: -1.7, Z: 0 },
    chin: { X: 0, Y: 1.0, Z: 0 },
  },
}

describe('buildPortraitModel', () => {
  it('returnerer null uten proporsjoner', () => {
    expect(buildPortraitModel(null, null)).toBeNull()
  })

  it('bygger en modell med head + features', () => {
    const model = buildPortraitModel(sampleProportions, {})
    expect(model.head).toBeDefined()
    expect(model.head.vertices.length).toBe(30) // 5 skiver × 6 punkter
    expect(model.eyes.left.center).toBeDefined()
    expect(model.eyes.right.center).toBeDefined()
    expect(model.nose.tip).toBeDefined()
    expect(model.mouth.left).toBeDefined()
    expect(model.eyebrows.left.length).toBe(5)
    expect(model.eyebrows.right.length).toBe(5)
  })

  it('inkluderer hår-lag når detektert', () => {
    const model = buildPortraitModel(sampleProportions, {
      hair: { hasHair: true, length: 0.5 },
    })
    expect(model.hair).toBeDefined()
    expect(model.hair.vertices.length).toBe(6)
    expect(model.hair.length).toBe(0.5)
    // Ingen color — vi bruker palett-farger i renderen
    expect(model.hair.color).toBeUndefined()
  })

  it('inkluderer briller når detektert', () => {
    const model = buildPortraitModel(sampleProportions, {
      glasses: { hasGlasses: true, darkness: 0.5 },
    })
    expect(model.glasses).toBeDefined()
    expect(model.glasses.leftLens).toBeDefined()
    expect(model.glasses.bridge).toBeDefined()
  })

  it('inkluderer skjegg når detektert', () => {
    const model = buildPortraitModel(sampleProportions, {
      beard: { hasBeard: true, density: 0.4 },
    })
    expect(model.beard).toBeDefined()
    expect(model.beard.vertices.length).toBeGreaterThan(3)
    expect(model.beard.color).toBeUndefined()
  })
})

describe('rotateY', () => {
  it('roterer en vertex rundt Y-aksen', () => {
    const v = { X: 1, Y: 2, Z: 0 }
    const r = rotateY(v, Math.PI / 2)
    expect(r.X).toBeCloseTo(0, 5)
    expect(r.Y).toBe(2)
    expect(r.Z).toBeCloseTo(1, 5)
  })

  it('lar Y-koordinaten være urørt', () => {
    const v = { X: 1, Y: 5, Z: 1 }
    const r = rotateY(v, 1.0)
    expect(r.Y).toBe(5)
  })
})

describe('rotateModel', () => {
  it('roterer alle vertices i modellen', () => {
    const model = buildPortraitModel(sampleProportions, {})
    const rotated = rotateModel(model, Math.PI / 4)
    expect(rotated.head.vertices.length).toBe(30)
    // Y bør være uendret
    for (let i = 0; i < model.head.vertices.length; i++) {
      expect(rotated.head.vertices[i].Y).toBe(model.head.vertices[i].Y)
    }
  })
})
