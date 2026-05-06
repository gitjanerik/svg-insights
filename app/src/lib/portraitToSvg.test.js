import { describe, it, expect } from 'vitest'
import { portraitToSvg, convexHull } from './portraitToSvg.js'
import { buildPortraitModel } from './portraitModel.js'

const sampleProportions = {
  eyeDistance: 0.6,
  eyeCenter: { X: 0, Y: -0.5, Z: 0 },
  landmarks: {
    leftEye: { X: -0.3, Y: -0.5, Z: 0 },
    rightEye: { X: 0.3, Y: -0.5, Z: 0 },
    nose: { X: 0, Y: 0, Z: -0.2 },
    mouth: { X: 0, Y: 0.4, Z: -0.05 },
    forehead: { X: 0, Y: -1.7, Z: 0 },
    chin: { X: 0, Y: 1.0, Z: 0 },
  },
  foreheadHeight: -2.0,
  chinDrop: 2.5,
}

describe('convexHull', () => {
  it('håndterer < 3 punkter ved å returnere kopi', () => {
    expect(convexHull([])).toEqual([])
    expect(convexHull([{ x: 1, y: 1 }]).length).toBe(1)
  })

  it('returnerer kun ekstrempunkter for et kvadrat med interiørpunkter', () => {
    const points = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
      { x: 5, y: 5 }, // interiør
      { x: 3, y: 7 }, // interiør
    ]
    const hull = convexHull(points)
    expect(hull.length).toBe(4)
  })
})

describe('portraitToSvg', () => {
  it('returnerer null for null model', () => {
    expect(portraitToSvg({ model: null })).toBeNull()
  })

  it('genererer SVG med viewBox men uten width/height på <svg>-elementet', () => {
    const model = buildPortraitModel(sampleProportions, {})
    const svg = portraitToSvg({ model })
    expect(svg).toContain('viewBox=')
    // Sjekk kun selve <svg>-åpningen — bakgrunns-rect har naturligvis width/height
    const svgOpenTag = svg.match(/<svg[^>]*>/)[0]
    expect(svgOpenTag).not.toMatch(/\swidth="/)
    expect(svgOpenTag).not.toMatch(/\sheight="/)
  })

  it('inkluderer hode-bane og øyne', () => {
    const model = buildPortraitModel(sampleProportions, {})
    const svg = portraitToSvg({ model })
    expect(svg).toContain('<path') // hode
    expect(svg).toContain('<ellipse') // øyne
  })

  it('bruker palett-farger', () => {
    const model = buildPortraitModel(sampleProportions, {})
    const palette = {
      name: 'Test', skin: '#ABCDEF', hair: '#000', beard: '#000',
      eyeWhite: '#FFF', pupil: '#000', mouth: '#FF0000', glasses: '#000',
      outline: '#000', bg: '#123456',
    }
    const svg = portraitToSvg({ model, palette })
    expect(svg).toContain('#ABCDEF') // skin
    expect(svg).toContain('#123456') // bg
  })

  it('inkluderer briller når modellen har dem', () => {
    const model = buildPortraitModel(sampleProportions, {
      glasses: { hasGlasses: true, darkness: 0.5 },
    })
    const svg = portraitToSvg({ model })
    expect(svg).toContain('<circle') // briller
  })

  it('forskjellig rotasjon gir forskjellig SVG', () => {
    const model = buildPortraitModel(sampleProportions, {})
    const svg0 = portraitToSvg({ model, rotY: 0 })
    const svg30 = portraitToSvg({ model, rotY: Math.PI / 6 })
    expect(svg0).not.toBe(svg30)
  })
})
