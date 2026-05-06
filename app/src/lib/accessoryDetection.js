// Aksessoir-deteksjon: kun PRESENS, ikke farger.
//
// Vi sampler ikke hudtoner eller hårfarger; output er Simpsons/Warhol-stilisert
// med palett uansett. Det gjør pipelinen mer robust på tvers av belysning og
// kameraets fargeprofil — failure-modes er tydeligere ("vi fant skjegg /
// vi fant ikke skjegg") enn fargesampling som "skjegg-fargen ble #5a4030".

import { isSkinPixel } from './faceLandmarks.js'

// HÅR: undersøk regionen rett over panne-landemerket.
// Krever MØRKE ikke-hud-piksler — utelukker lyse vegger og himmel som
// ofte ble klassifisert som hår i tidligere versjoner.
export function detectHair(rgba, w, h, faceRegion, landmarks) {
  if (!faceRegion || !landmarks) return { hasHair: false, length: 0, fillRatio: 0 }

  const { bbox } = faceRegion
  const searchY0 = Math.max(0, bbox.y - bbox.h * 0.5)
  const searchY1 = landmarks.forehead.y
  const searchX0 = Math.max(0, bbox.x - bbox.w * 0.1)
  const searchX1 = Math.min(w, bbox.x + bbox.w * 1.1)

  let hairCount = 0
  let totalCount = 0
  for (let y = Math.floor(searchY0); y < Math.floor(searchY1); y++) {
    for (let x = Math.floor(searchX0); x < Math.floor(searchX1); x++) {
      const i = (y * w + x) * 4
      const cr = rgba[i], cg = rgba[i + 1], cb = rgba[i + 2]
      totalCount++
      if (!isSkinPixel(cr, cg, cb)) {
        const luma = 0.299 * cr + 0.587 * cg + 0.114 * cb
        // Strammere terskel: hår må være tydelig mørkere enn typisk vegg/lys
        if (luma > 8 && luma < 140) hairCount++
      }
    }
  }

  const fillRatio = totalCount > 0 ? hairCount / totalCount : 0
  // Krever 18% fill for å unngå falske positive
  if (fillRatio < 0.18 || hairCount < 60) {
    return { hasHair: false, length: 0, fillRatio }
  }
  return {
    hasHair: true,
    length: Math.min(1, fillRatio * 1.4),
    fillRatio,
  }
}

// BRILLER: detekter mørkt horisontalt bånd på øye-høyde.
export function detectGlasses(rgba, w, h, landmarks) {
  if (!landmarks?.leftEye || !landmarks?.rightEye) return { hasGlasses: false, darkness: 0 }
  const { leftEye, rightEye } = landmarks
  const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y)
  if (eyeDist < 5) return { hasGlasses: false, darkness: 0 }

  const cy = (leftEye.y + rightEye.y) / 2
  const cx = (leftEye.x + rightEye.x) / 2
  const bandHalfH = eyeDist * 0.4
  const bandX0 = cx - eyeDist * 0.9
  const bandX1 = cx + eyeDist * 0.9
  const bandY0 = cy - bandHalfH
  const bandY1 = cy + bandHalfH

  let bandCount = 0
  let darkPixels = 0
  for (let y = Math.floor(bandY0); y < Math.floor(bandY1); y++) {
    for (let x = Math.floor(bandX0); x < Math.floor(bandX1); x++) {
      if (x < 0 || x >= w || y < 0 || y >= h) continue
      const i = (y * w + x) * 4
      const luma = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
      bandCount++
      if (luma < 60) darkPixels++
    }
  }
  if (bandCount === 0) return { hasGlasses: false, darkness: 0 }
  const darkRatio = darkPixels / bandCount
  return {
    hasGlasses: darkRatio > 0.25,
    darkness: darkRatio,
  }
}

// SKJEGG: undersøk nedre del av ansiktet (under munn, over hake).
export function detectBeard(rgba, w, h, faceRegion, landmarks) {
  if (!faceRegion || !landmarks?.mouth || !landmarks?.chin) {
    return { hasBeard: false, density: 0 }
  }
  const x0 = faceRegion.bbox.x + faceRegion.bbox.w * 0.20
  const x1 = faceRegion.bbox.x + faceRegion.bbox.w * 0.80
  const y0 = landmarks.mouth.y + 2
  const y1 = landmarks.chin.y
  if (y1 - y0 < 4) return { hasBeard: false, density: 0 }

  let nonSkinDark = 0
  let total = 0
  for (let y = Math.floor(y0); y < Math.floor(y1); y++) {
    for (let x = Math.floor(x0); x < Math.floor(x1); x++) {
      if (x < 0 || x >= w || y < 0 || y >= h) continue
      const i = (y * w + x) * 4
      const cr = rgba[i], cg = rgba[i + 1], cb = rgba[i + 2]
      total++
      if (!isSkinPixel(cr, cg, cb)) {
        const luma = 0.299 * cr + 0.587 * cg + 0.114 * cb
        if (luma < 130) nonSkinDark++
      }
    }
  }
  if (total === 0) return { hasBeard: false, density: 0 }
  const density = nonSkinDark / total
  // Strammere terskel — krever klart skjegg-mønster, ikke bare skygger
  if (density < 0.30 || nonSkinDark < 60) {
    return { hasBeard: false, density }
  }
  return { hasBeard: true, density }
}

// Oppsummerings-detector
export function detectAccessories(rgba, w, h, faceRegion, landmarks) {
  return {
    hair: detectHair(rgba, w, h, faceRegion, landmarks),
    glasses: detectGlasses(rgba, w, h, landmarks),
    beard: detectBeard(rgba, w, h, faceRegion, landmarks),
  }
}
