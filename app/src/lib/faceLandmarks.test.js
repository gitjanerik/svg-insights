import { describe, it, expect } from 'vitest'
import {
  rgbToYCbCr,
  isSkinPixel,
  buildSkinMask,
  connectedComponents,
  detectFaceRegion,
  findLandmarks,
} from './faceLandmarks.js'

// Hjelper: bygg et RGBA-bilde med et hud-farget rektangel på sort bakgrunn
function makeFaceImage(w, h, faceX, faceY, faceW, faceH, skinRGB = [222, 184, 156]) {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const inFace = x >= faceX && x < faceX + faceW && y >= faceY && y < faceY + faceH
      if (inFace) {
        rgba[i] = skinRGB[0]
        rgba[i + 1] = skinRGB[1]
        rgba[i + 2] = skinRGB[2]
      } // else 0,0,0 (svart)
      rgba[i + 3] = 255
    }
  }
  return rgba
}

describe('rgbToYCbCr', () => {
  it('konverterer hvitt til Y=255, Cb=Cr=128', () => {
    const { y, cb, cr } = rgbToYCbCr(255, 255, 255)
    expect(y).toBeCloseTo(255, 4)
    expect(cb).toBeCloseTo(128, 4)
    expect(cr).toBeCloseTo(128, 4)
  })

  it('konverterer svart til Y=0, Cb=Cr=128', () => {
    const { y, cb, cr } = rgbToYCbCr(0, 0, 0)
    expect(y).toBeCloseTo(0, 4)
    expect(cb).toBeCloseTo(128, 4)
    expect(cr).toBeCloseTo(128, 4)
  })
})

describe('isSkinPixel', () => {
  it('detekterer typisk hud-RGB som hud', () => {
    expect(isSkinPixel(222, 184, 156)).toBe(true) // lys hud
    expect(isSkinPixel(180, 130, 100)).toBe(true) // medium
    expect(isSkinPixel(120, 80, 60)).toBe(true)   // mørkere hud
  })

  it('avviser klart ikke-hud farger', () => {
    expect(isSkinPixel(0, 0, 0)).toBe(false)       // svart
    expect(isSkinPixel(0, 0, 255)).toBe(false)     // blå
    expect(isSkinPixel(0, 255, 0)).toBe(false)     // grønn
    expect(isSkinPixel(255, 255, 255)).toBe(false) // hvit
  })
})

describe('buildSkinMask', () => {
  it('returnerer mask av riktig størrelse', () => {
    const rgba = new Uint8ClampedArray(10 * 10 * 4)
    const mask = buildSkinMask(rgba, 10, 10)
    expect(mask.length).toBe(100)
    expect(mask).toBeInstanceOf(Uint8Array)
  })

  it('markerer kun hud-pixler', () => {
    const rgba = makeFaceImage(20, 20, 5, 5, 10, 10)
    const mask = buildSkinMask(rgba, 20, 20)
    expect(mask[0]).toBe(0) // hjørne (svart)
    expect(mask[10 * 20 + 10]).toBe(1) // midt i ansiktet (hud)
  })
})

describe('connectedComponents', () => {
  it('finner én komponent for et sammenhengende rektangel', () => {
    const w = 10, h = 10
    const mask = new Uint8Array(w * h)
    for (let y = 2; y < 8; y++) {
      for (let x = 2; x < 8; x++) {
        mask[y * w + x] = 1
      }
    }
    const { components } = connectedComponents(mask, w, h)
    expect(components.length).toBe(1)
    expect(components[0].area).toBe(36)
    expect(components[0].minX).toBe(2)
    expect(components[0].maxX).toBe(7)
  })

  it('finner to komponenter for to adskilte regioner', () => {
    const w = 20, h = 20
    const mask = new Uint8Array(w * h)
    // Region A
    for (let y = 1; y < 5; y++) {
      for (let x = 1; x < 5; x++) {
        mask[y * w + x] = 1
      }
    }
    // Region B
    for (let y = 10; y < 14; y++) {
      for (let x = 10; x < 14; x++) {
        mask[y * w + x] = 1
      }
    }
    const { components } = connectedComponents(mask, w, h)
    expect(components.length).toBe(2)
  })
})

describe('detectFaceRegion', () => {
  it('returnerer null for et tomt bilde', () => {
    const rgba = new Uint8ClampedArray(40 * 40 * 4)
    const region = detectFaceRegion(rgba, 40, 40)
    expect(region).toBeNull()
  })

  it('finner ansikts-bbox for et hud-rektangel sentralt øvre i bildet', () => {
    const w = 80, h = 100
    const rgba = makeFaceImage(w, h, 25, 15, 30, 40)
    const region = detectFaceRegion(rgba, w, h)
    expect(region).not.toBeNull()
    expect(region.cx).toBeCloseTo(39.5, 1) // midt i x (25..54)
    expect(region.cy).toBeCloseTo(34.5, 1) // midt i y (15..54)
    expect(region.w).toBe(30)
    expect(region.h).toBe(40)
  })

  it('avviser regioner i nedre fjerdedel av bildet', () => {
    const w = 80, h = 100
    // Ansikt nede i bildet (cy = 85, > 75 = h*0.75)
    const rgba = makeFaceImage(w, h, 25, 80, 30, 18)
    const region = detectFaceRegion(rgba, w, h)
    expect(region).toBeNull()
  })

  it('avviser ekstrem-aspect ratios (lange tynne striper)', () => {
    const w = 80, h = 100
    // Svært bred, kort stripe
    const rgba = makeFaceImage(w, h, 5, 30, 70, 10)
    const region = detectFaceRegion(rgba, w, h)
    expect(region).toBeNull()
  })

  it('aksepterer typisk ansikts-aspect ratio', () => {
    const w = 80, h = 100
    // ~4:3 høyde:bredde, sentralt
    const rgba = makeFaceImage(w, h, 25, 15, 30, 40)
    const region = detectFaceRegion(rgba, w, h)
    expect(region).not.toBeNull()
  })
})

// Hjelper: lag et ansiktsbilde med dynamiske features
function makeFaceWithFeatures(opts) {
  const {
    w = 100, h = 120,
    faceX = 30, faceY = 20, faceW = 40, faceH = 60,
    skin = [222, 184, 156],
    leftEye = null,    // {x, y, r}
    rightEye = null,
    nose = null,       // bright spot
    mouth = null,      // {x0, x1, y}
  } = opts

  const rgba = new Uint8ClampedArray(w * h * 4)
  // Bakgrunn = svart, fyll ansiktet med hudfarge
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const inFace = x >= faceX && x < faceX + faceW && y >= faceY && y < faceY + faceH
      if (inFace) {
        rgba[i] = skin[0]
        rgba[i + 1] = skin[1]
        rgba[i + 2] = skin[2]
      }
      rgba[i + 3] = 255
    }
  }
  // Tegn øyne (mørke disker)
  function drawDisk(cx, cy, r, color) {
    for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r); x++) {
        const dx = x - cx, dy = y - cy
        if (dx * dx + dy * dy <= r * r) {
          const i = (y * w + x) * 4
          rgba[i] = color[0]
          rgba[i + 1] = color[1]
          rgba[i + 2] = color[2]
        }
      }
    }
  }
  if (leftEye) drawDisk(leftEye.x, leftEye.y, leftEye.r, [20, 20, 20])
  if (rightEye) drawDisk(rightEye.x, rightEye.y, rightEye.r, [20, 20, 20])
  // Nese: lys disk midt på (lysere enn hud)
  if (nose) drawDisk(nose.x, nose.y, nose.r, [255, 240, 220])
  // Munn: mørk horisontal stripe
  if (mouth) {
    for (let x = mouth.x0; x < mouth.x1; x++) {
      const i = (mouth.y * w + x) * 4
      rgba[i] = 60
      rgba[i + 1] = 30
      rgba[i + 2] = 30
    }
  }
  return rgba
}

describe('findLandmarks', () => {
  it('returnerer null uten faceRegion', () => {
    const rgba = new Uint8ClampedArray(40 * 40 * 4)
    expect(findLandmarks(rgba, 40, 40, null)).toBeNull()
  })

  it('returnerer null for for liten face-bbox', () => {
    const region = { bbox: { x: 10, y: 10, w: 10, h: 10 }, cx: 15, cy: 15, w: 10, h: 10, area: 100 }
    const rgba = new Uint8ClampedArray(40 * 40 * 4)
    expect(findLandmarks(rgba, 40, 40, region)).toBeNull()
  })

  it('finner approksimative landemerker for et syntetisk ansikt', () => {
    const w = 100, h = 120
    const faceX = 30, faceY = 20, faceW = 40, faceH = 60
    const rgba = makeFaceWithFeatures({
      w, h, faceX, faceY, faceW, faceH,
      // Øyne ca y=ansiktets 0.40 = faceY + 24 = 44
      leftEye: { x: faceX + 12, y: faceY + 24, r: 3 },   // x=42, y=44
      rightEye: { x: faceX + 28, y: faceY + 24, r: 3 },  // x=58, y=44
      nose: { x: faceX + 20, y: faceY + 36, r: 4 },      // x=50, y=56 (lys)
      mouth: { x0: faceX + 14, x1: faceX + 26, y: faceY + 47 }, // y=67
    })

    const region = detectFaceRegion(rgba, w, h)
    expect(region).not.toBeNull()

    const landmarks = findLandmarks(rgba, w, h, region)
    expect(landmarks).not.toBeNull()

    // Innenfor noen få pixler — søke-vektingen tillater litt slingringsmonn
    expect(Math.abs(landmarks.leftEye.x - 42)).toBeLessThan(5)
    expect(Math.abs(landmarks.leftEye.y - 44)).toBeLessThan(5)
    expect(Math.abs(landmarks.rightEye.x - 58)).toBeLessThan(5)
    expect(Math.abs(landmarks.rightEye.y - 44)).toBeLessThan(5)
    // Nese skal være lys og sentralt
    expect(Math.abs(landmarks.nose.x - 50)).toBeLessThan(6)
    // Munn-y skal være i nedre del
    expect(landmarks.mouth.y).toBeGreaterThan(faceY + faceH * 0.6)
    expect(landmarks.mouth.y).toBeLessThan(faceY + faceH * 0.9)
  })

  it('returnerer alle 6 landemerker selv ved manglende features', () => {
    // Et helt flatt hud-rektangel uten øyne/nese/munn — vi skal fortsatt få
    // tilbake noe (proporsjonelt plassert) så pipelinen ikke krasjer
    const w = 100, h = 120
    const rgba = makeFaceWithFeatures({ w, h, faceX: 30, faceY: 20, faceW: 40, faceH: 60 })
    const region = detectFaceRegion(rgba, w, h)
    const landmarks = findLandmarks(rgba, w, h, region)
    expect(landmarks).not.toBeNull()
    expect(landmarks.leftEye).toBeDefined()
    expect(landmarks.rightEye).toBeDefined()
    expect(landmarks.nose).toBeDefined()
    expect(landmarks.mouth).toBeDefined()
    expect(landmarks.forehead).toBeDefined()
    expect(landmarks.chin).toBeDefined()
  })
})
