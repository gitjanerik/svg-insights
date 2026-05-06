// Mimikk-deteksjon: estimerer mouthOpen, eyesOpen og smile fra et RGBA-bilde
// pluss en allerede detektert face bbox + landemerker.
//
// Output:
//   mouthOpen: 0 (lukket) → 1 (vidåpen)
//   eyesOpen:  0 (lukket) → 1 (vidåpne)
//   smile:    -1 (sur) → 0 (nøytral) → +1 (smilende)
//
// Disse drives senere inn i meshen som deformasjoner — leppe-åpning,
// øyehule-dybde, leppe-krumning.

// MUNN-ÅPNING: mål andelen mørke piksler under munn-landemerket.
// Åpen munn har stor mørk region (tannkavitet), lukket har bare en tynn linje.
export function detectMouthOpenness(rgba, w, h, faceRegion, landmarks) {
  if (!landmarks?.mouth || !faceRegion) return 0
  const cx = landmarks.mouth.x
  const cy = landmarks.mouth.y
  const halfW = faceRegion.bbox.w * 0.16
  const halfH = faceRegion.bbox.h * 0.10

  let darkRows = 0
  let totalRows = 0
  for (let y = Math.floor(cy - halfH); y < Math.floor(cy + halfH); y++) {
    if (y < 0 || y >= h) continue
    let darkInRow = 0
    let totalInRow = 0
    for (let x = Math.floor(cx - halfW); x < Math.floor(cx + halfW); x++) {
      if (x < 0 || x >= w) continue
      const i = (y * w + x) * 4
      const luma = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
      totalInRow++
      if (luma < 75) darkInRow++
    }
    if (totalInRow === 0) continue
    totalRows++
    if (darkInRow / totalInRow > 0.25) darkRows++
  }
  if (totalRows === 0) return 0
  // Lukket munn = ca 1-2 mørke rader (selve linja). Åpen = mange mørke rader.
  // Skalér slik at 5+ mørke rader ≈ vidåpen
  return Math.min(1, Math.max(0, (darkRows - 1) / 5))
}

// ØYE-ÅPNING: bruker luma-variansen rundt øye-landemerker.
// Åpne øyne har høy varians (hvitt + mørk pupill kontrast), lukkede har
// lav varians (jevn hud-tone over hele området).
export function detectEyeOpenness(rgba, w, h, landmarks) {
  if (!landmarks?.leftEye || !landmarks?.rightEye) return 0.6

  function eyeOpennessAt(eye) {
    const r = 9
    const lumas = []
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(eye.x + dx)
        const y = Math.round(eye.y + dy)
        if (x < 0 || x >= w || y < 0 || y >= h) continue
        const i = (y * w + x) * 4
        lumas.push(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2])
      }
    }
    if (lumas.length === 0) return 0.6
    const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length
    let variance = 0
    for (const l of lumas) variance += (l - mean) ** 2
    const std = Math.sqrt(variance / lumas.length)
    // Std ~ 50+ for åpne øyne (kontrast hvit/pupill), ~ 10-20 for lukkede
    return Math.min(1, Math.max(0, (std - 12) / 40))
  }

  return (eyeOpennessAt(landmarks.leftEye) + eyeOpennessAt(landmarks.rightEye)) / 2
}

// SMIL: sammenlign Y-koordinaten av mørkeste piksel ved munnvikene
// vs senter. Smil = munnviker høyere (lavere Y) enn senter. Sur = motsatt.
export function detectSmile(rgba, w, h, faceRegion, landmarks) {
  if (!landmarks?.mouth || !faceRegion) return 0
  const cx = landmarks.mouth.x
  const cy = landmarks.mouth.y
  const halfW = faceRegion.bbox.w * 0.18

  function darkestYAtX(x) {
    let bestY = cy
    let bestL = 999
    const range = 10
    for (let y = Math.floor(cy - range); y < Math.floor(cy + range); y++) {
      if (y < 0 || y >= h) continue
      const xi = Math.round(x)
      if (xi < 0 || xi >= w) continue
      const i = (y * w + xi) * 4
      const luma = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
      if (luma < bestL) {
        bestL = luma
        bestY = y
      }
    }
    return bestY
  }

  const leftY = darkestYAtX(cx - halfW * 0.7)
  const centerY = darkestYAtX(cx)
  const rightY = darkestYAtX(cx + halfW * 0.7)
  const cornerAvg = (leftY + rightY) / 2
  // Positiv diff (centerY > cornerAvg) = munnviker over senter = smil
  const diff = centerY - cornerAvg
  return Math.max(-1, Math.min(1, diff / 5))
}

// Oppsummerings-detector
export function detectExpression(rgba, w, h, faceRegion, landmarks) {
  return {
    mouthOpen: detectMouthOpenness(rgba, w, h, faceRegion, landmarks),
    eyesOpen: detectEyeOpenness(rgba, w, h, landmarks),
    smile: detectSmile(rgba, w, h, faceRegion, landmarks),
  }
}
