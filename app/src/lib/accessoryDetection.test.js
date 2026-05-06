import { describe, it, expect } from 'vitest'
import {
  detectHair,
  detectGlasses,
  detectBeard,
  detectAccessories,
} from './accessoryDetection.js'

// Hjelper: bygg et bilde med ansikt + valgfrie aksessoirer
function makeImage({ w, h, face, hair, glasses, beard }) {
  const rgba = new Uint8ClampedArray(w * h * 4).fill(0)
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255

  function setPixel(x, y, [r, g, b]) {
    if (x < 0 || x >= w || y < 0 || y >= h) return
    const i = (y * w + x) * 4
    rgba[i] = r
    rgba[i + 1] = g
    rgba[i + 2] = b
  }

  const skin = [222, 184, 156]
  for (let y = face.y; y < face.y + face.h; y++) {
    for (let x = face.x; x < face.x + face.w; x++) {
      setPixel(x, y, skin)
    }
  }
  if (hair) {
    const hairY0 = Math.max(0, face.y - hair.length)
    for (let y = hairY0; y < face.y; y++) {
      for (let x = face.x; x < face.x + face.w; x++) {
        setPixel(x, y, hair.color)
      }
    }
  }
  if (glasses) {
    const eyeY = face.y + face.h * 0.4
    const bandH = 6
    for (let y = Math.floor(eyeY - bandH / 2); y < Math.floor(eyeY + bandH / 2); y++) {
      for (let x = face.x; x < face.x + face.w; x++) {
        setPixel(x, y, [20, 20, 20])
      }
    }
  }
  if (beard) {
    const beardY0 = face.y + Math.floor(face.h * 0.7)
    const beardY1 = face.y + face.h
    for (let y = beardY0; y < beardY1; y++) {
      for (let x = face.x + Math.floor(face.w * 0.2); x < face.x + Math.floor(face.w * 0.8); x++) {
        setPixel(x, y, beard.color)
      }
    }
  }
  return rgba
}

describe('detectHair', () => {
  it('returnerer hasHair=false uten faceRegion eller landmarks', () => {
    const rgba = new Uint8ClampedArray(40 * 40 * 4)
    expect(detectHair(rgba, 40, 40, null, null).hasHair).toBe(false)
  })

  it('detekterer hår over panne', () => {
    const w = 100, h = 120
    const face = { x: 30, y: 30, w: 40, h: 60 }
    const rgba = makeImage({
      w, h, face,
      hair: { color: [50, 30, 20], length: 20 },
    })
    const region = { bbox: face, cx: 50, cy: 60, w: 40, h: 60, area: 2400 }
    const landmarks = { forehead: { x: 50, y: 36 } }
    const result = detectHair(rgba, w, h, region, landmarks)
    expect(result.hasHair).toBe(true)
    expect(result.length).toBeGreaterThan(0)
    // Ingen color-property — vi har droppet fargesampling
    expect(result.color).toBeUndefined()
  })

  it('returnerer hasHair=false når søkeregionen er tom (skallet)', () => {
    const w = 100, h = 120
    const face = { x: 30, y: 30, w: 40, h: 60 }
    const rgba = makeImage({ w, h, face })
    const region = { bbox: face, cx: 50, cy: 60, w: 40, h: 60, area: 2400 }
    const landmarks = { forehead: { x: 50, y: 36 } }
    expect(detectHair(rgba, w, h, region, landmarks).hasHair).toBe(false)
  })
})

describe('detectGlasses', () => {
  it('detekterer mørkt bånd på øye-høyde', () => {
    const w = 100, h = 120
    const face = { x: 30, y: 30, w: 40, h: 60 }
    const rgba = makeImage({ w, h, face, glasses: true })
    const eyeY = face.y + face.h * 0.4
    const landmarks = {
      leftEye: { x: face.x + face.w * 0.3, y: eyeY },
      rightEye: { x: face.x + face.w * 0.7, y: eyeY },
    }
    const result = detectGlasses(rgba, w, h, landmarks)
    expect(result.hasGlasses).toBe(true)
    expect(result.darkness).toBeGreaterThan(0.25)
  })

  it('returnerer hasGlasses=false uten mørkt bånd', () => {
    const w = 100, h = 120
    const face = { x: 30, y: 30, w: 40, h: 60 }
    const rgba = makeImage({ w, h, face })
    const landmarks = {
      leftEye: { x: 42, y: 54 },
      rightEye: { x: 58, y: 54 },
    }
    expect(detectGlasses(rgba, w, h, landmarks).hasGlasses).toBe(false)
  })

  it('returnerer hasGlasses=false uten landmarks', () => {
    const rgba = new Uint8ClampedArray(40 * 40 * 4)
    expect(detectGlasses(rgba, 40, 40, null).hasGlasses).toBe(false)
  })
})

describe('detectBeard', () => {
  it('detekterer skjegg under munn', () => {
    const w = 100, h = 120
    const face = { x: 30, y: 30, w: 40, h: 60 }
    const rgba = makeImage({
      w, h, face,
      beard: { color: [60, 40, 30] },
    })
    const region = { bbox: face, cx: 50, cy: 60, w: 40, h: 60, area: 2400 }
    const landmarks = {
      mouth: { x: 50, y: face.y + Math.floor(face.h * 0.65) },
      chin: { x: 50, y: face.y + face.h - 1 },
    }
    const result = detectBeard(rgba, w, h, region, landmarks)
    expect(result.hasBeard).toBe(true)
    // Ingen color-property — vi har droppet fargesampling
    expect(result.color).toBeUndefined()
  })

  it('returnerer hasBeard=false uten skjegg', () => {
    const w = 100, h = 120
    const face = { x: 30, y: 30, w: 40, h: 60 }
    const rgba = makeImage({ w, h, face })
    const region = { bbox: face, cx: 50, cy: 60, w: 40, h: 60, area: 2400 }
    const landmarks = {
      mouth: { x: 50, y: face.y + Math.floor(face.h * 0.65) },
      chin: { x: 50, y: face.y + face.h - 1 },
    }
    expect(detectBeard(rgba, w, h, region, landmarks).hasBeard).toBe(false)
  })
})

describe('detectAccessories', () => {
  it('kjører alle og returnerer kombinert objekt', () => {
    const w = 100, h = 120
    const face = { x: 30, y: 30, w: 40, h: 60 }
    const rgba = makeImage({ w, h, face })
    const region = { bbox: face, cx: 50, cy: 60, w: 40, h: 60, area: 2400 }
    const landmarks = {
      leftEye: { x: 42, y: 54 },
      rightEye: { x: 58, y: 54 },
      forehead: { x: 50, y: 36 },
      mouth: { x: 50, y: 70 },
      chin: { x: 50, y: 88 },
    }
    const result = detectAccessories(rgba, w, h, region, landmarks)
    expect(result).toHaveProperty('hair')
    expect(result).toHaveProperty('glasses')
    expect(result).toHaveProperty('beard')
    // Ingen eyeColor — vi har droppet fargesampling
    expect(result).not.toHaveProperty('eyeColor')
  })
})
