import { describe, it, expect } from 'vitest'
import {
  detectMouthOpenness,
  detectEyeOpenness,
  detectSmile,
  detectExpression,
} from './expressionDetection.js'

function makeImage(w, h, fill = [200, 200, 200]) {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = fill[0]
    rgba[i + 1] = fill[1]
    rgba[i + 2] = fill[2]
    rgba[i + 3] = 255
  }
  return rgba
}

function fillRect(rgba, w, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4
      rgba[i] = color[0]
      rgba[i + 1] = color[1]
      rgba[i + 2] = color[2]
    }
  }
}

describe('detectMouthOpenness', () => {
  it('returnerer 0 uten landmarks eller faceRegion', () => {
    expect(detectMouthOpenness(new Uint8ClampedArray(40), 10, 10, null, null)).toBe(0)
  })

  it('detekterer åpen munn (stort mørkt område)', () => {
    const w = 100, h = 100
    const rgba = makeImage(w, h, [200, 180, 160]) // hud-aktig
    // Åpen munn: stort sort rektangel på (40-60, 60-80)
    fillRect(rgba, w, 40, 60, 60, 80, [10, 10, 10])
    const region = { bbox: { x: 30, y: 30, w: 40, h: 60 } }
    const landmarks = { mouth: { x: 50, y: 70 } }
    const v = detectMouthOpenness(rgba, w, h, region, landmarks)
    expect(v).toBeGreaterThan(0.5)
  })

  it('returnerer lav verdi for lukket munn (ingen mørkt område)', () => {
    const w = 100, h = 100
    const rgba = makeImage(w, h, [200, 180, 160])
    const region = { bbox: { x: 30, y: 30, w: 40, h: 60 } }
    const landmarks = { mouth: { x: 50, y: 70 } }
    const v = detectMouthOpenness(rgba, w, h, region, landmarks)
    expect(v).toBeLessThan(0.2)
  })
})

describe('detectEyeOpenness', () => {
  it('returnerer høy verdi for åpne øyne (høy kontrast)', () => {
    const w = 100, h = 100
    const rgba = makeImage(w, h, [50, 50, 50]) // mørk bakgrunn
    // Hvitt øye-område med svart pupill
    fillRect(rgba, w, 30, 35, 50, 50, [240, 240, 240])
    fillRect(rgba, w, 38, 40, 42, 45, [10, 10, 10])
    fillRect(rgba, w, 60, 35, 80, 50, [240, 240, 240])
    fillRect(rgba, w, 68, 40, 72, 45, [10, 10, 10])
    const landmarks = {
      leftEye: { x: 40, y: 42 },
      rightEye: { x: 70, y: 42 },
    }
    const v = detectEyeOpenness(rgba, w, h, landmarks)
    expect(v).toBeGreaterThan(0.5)
  })

  it('returnerer lav verdi for lukkede øyne (jevn hud)', () => {
    const w = 100, h = 100
    const rgba = makeImage(w, h, [200, 180, 160])
    const landmarks = {
      leftEye: { x: 40, y: 42 },
      rightEye: { x: 70, y: 42 },
    }
    const v = detectEyeOpenness(rgba, w, h, landmarks)
    expect(v).toBeLessThan(0.3)
  })
})

describe('detectSmile', () => {
  // Detektoren ser ved x = cx ± bbox.w · 0.18 · 0.7. For bbox.w=100, cx=50:
  // venstre x ≈ 50 - 12.6 = 37, høyre x ≈ 50 + 12.6 = 62
  it('returnerer positiv verdi for smil (munnviker høyere enn senter)', () => {
    const w = 100, h = 100
    const rgba = makeImage(w, h, [200, 180, 160])
    fillRect(rgba, w, 35, 64, 40, 66, [20, 20, 20]) // venstre munnvik (høy)
    fillRect(rgba, w, 48, 70, 52, 72, [20, 20, 20]) // senter (lav)
    fillRect(rgba, w, 60, 64, 65, 66, [20, 20, 20]) // høyre munnvik (høy)
    const region = { bbox: { x: 0, y: 30, w: 100, h: 60 } }
    const landmarks = { mouth: { x: 50, y: 70 } }
    const v = detectSmile(rgba, w, h, region, landmarks)
    expect(v).toBeGreaterThan(0)
  })

  it('returnerer negativ verdi for sur (munnviker lavere)', () => {
    const w = 100, h = 100
    const rgba = makeImage(w, h, [200, 180, 160])
    fillRect(rgba, w, 35, 72, 40, 74, [20, 20, 20]) // venstre (lav)
    fillRect(rgba, w, 48, 64, 52, 66, [20, 20, 20]) // senter (høy)
    fillRect(rgba, w, 60, 72, 65, 74, [20, 20, 20]) // høyre (lav)
    const region = { bbox: { x: 0, y: 30, w: 100, h: 60 } }
    const landmarks = { mouth: { x: 50, y: 68 } }
    const v = detectSmile(rgba, w, h, region, landmarks)
    expect(v).toBeLessThan(0)
  })
})

describe('detectExpression', () => {
  it('kjører alle og returnerer kombinert objekt', () => {
    const w = 100, h = 100
    const rgba = makeImage(w, h)
    const region = { bbox: { x: 25, y: 30, w: 50, h: 60 } }
    const landmarks = {
      mouth: { x: 50, y: 70 },
      leftEye: { x: 40, y: 42 },
      rightEye: { x: 60, y: 42 },
    }
    const result = detectExpression(rgba, w, h, region, landmarks)
    expect(result).toHaveProperty('mouthOpen')
    expect(result).toHaveProperty('eyesOpen')
    expect(result).toHaveProperty('smile')
  })
})
