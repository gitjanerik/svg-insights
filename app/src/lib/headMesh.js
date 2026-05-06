// 3D-hodemesh: parametrisk genererte trekanter formet som et hode.
// Deformeres av bruker-målte proporsjoner. Inneholder anatomiske features
// som ekte mesh-geometri:
//   - Hode-flater (region 'skin')
//   - Konkave øyehuler (region 'eyeSocket', mørkere farge)
//   - Konveks nese-kile (region 'nose', samme farge som hud)
//   - Konvekse lepper, øvre og nedre (region 'lips', rød palett-farge)
//
// Hver trekant har { indices: [a,b,c], region: 'skin'|'eyeSocket'|'nose'|'lips'|'hair' }.

const SEGMENTS = 16

const SLICES = [
  [-1.00, 0.20, 0.32],  // 0: crown apex
  [-0.82, 0.80, 0.88],  // 1: upper crown
  [-0.55, 0.96, 1.00],  // 2: forehead
  [-0.25, 1.00, 1.00],  // 3: brow level
  [ 0.00, 0.98, 0.95],  // 4: eyes
  [ 0.18, 0.94, 0.92],  // 5: upper cheek
  [ 0.36, 0.88, 0.85],  // 6: nose tip
  [ 0.54, 0.80, 0.78],  // 7: mouth
  [ 0.70, 0.62, 0.68],  // 8: upper jaw
  [ 0.86, 0.42, 0.52],  // 9: lower jaw
  [ 1.00, 0.10, 0.18],  // 10: chin
]

function tri(indices, region = 'skin') {
  return { indices, region }
}

export function buildHeadMesh(proportions = {}, opts = {}) {
  const { faceAspect = 0.72 } = opts

  const measuredHeight = (proportions.faceHeight ?? 4.0) * 0.55
  const headHeight = Math.max(2.0, measuredHeight)
  const headWidth = headHeight * Math.max(0.55, Math.min(1.05, faceAspect))
  const headDepth = headWidth * 0.92

  const vertices = []
  const sliceStart = []

  for (const [yf, rxf, rzf] of SLICES) {
    sliceStart.push(vertices.length)
    for (let i = 0; i < SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2
      vertices.push({
        X: Math.sin(angle) * rxf * headWidth,
        Y: yf * headHeight,
        Z: Math.cos(angle) * rzf * headDepth,
      })
    }
  }

  const topApex = vertices.length
  vertices.push({ X: 0, Y: -headHeight * 1.08, Z: 0 })
  const bottomApex = vertices.length
  vertices.push({ X: 0, Y: headHeight * 1.08, Z: 0 })

  applyDeformations(vertices, sliceStart, headWidth, headHeight, headDepth)

  const triangles = []

  // Skin-trekanter mellom skiver
  for (let s = 0; s < SLICES.length - 1; s++) {
    const a = sliceStart[s]
    const b = sliceStart[s + 1]
    for (let i = 0; i < SEGMENTS; i++) {
      const ni = (i + 1) % SEGMENTS
      triangles.push(tri([a + i, b + i, b + ni]))
      triangles.push(tri([a + i, b + ni, a + ni]))
    }
  }

  // Topp-cap
  for (let i = 0; i < SEGMENTS; i++) {
    const ni = (i + 1) % SEGMENTS
    triangles.push(tri([topApex, sliceStart[0] + ni, sliceStart[0] + i]))
  }

  // Bunn-cap
  const last = sliceStart[SLICES.length - 1]
  for (let i = 0; i < SEGMENTS; i++) {
    const ni = (i + 1) % SEGMENTS
    triangles.push(tri([bottomApex, last + i, last + ni]))
  }

  // Anatomiske mesh-features
  addEyeSockets(vertices, triangles, headWidth, headHeight, headDepth)
  addNose(vertices, triangles, headWidth, headHeight, headDepth)
  addLips(vertices, triangles, headWidth, headHeight, headDepth)

  // 2D-features for evt. overlay (øyenbryn beholdes som vektorer per nå)
  const eyeY = 0
  const eyeX = headWidth * 0.40
  const eyeZ = headDepth * 0.95
  const features = {
    leftBrow: buildBrowArc(-eyeX, eyeY - 0.20, eyeZ, true),
    rightBrow: buildBrowArc(eyeX, eyeY - 0.20, eyeZ, false),
  }

  return {
    vertices,
    triangles,
    features,
    bounds: { headWidth, headHeight, headDepth },
  }
}

function buildBrowArc(centerX, y, z, mirror) {
  const arr = []
  const halfLen = 0.32
  for (let i = 0; i < 5; i++) {
    const t = i / 4
    const x = centerX + (mirror ? -1 : 1) * (halfLen * (t * 2 - 1))
    const arch = Math.sin(t * Math.PI) * 0.04
    arr.push({ X: x, Y: y - arch, Z: z * 1.04 })
  }
  return arr
}

function applyDeformations(vertices, sliceStart, hw, hh, hd) {
  // Brynkam — liten utstikk
  const browBase = sliceStart[3]
  vertices[browBase + 0].Z *= 1.04
  vertices[browBase + 1].Z *= 1.03
  vertices[browBase + (SEGMENTS - 1)].Z *= 1.03

  // Kjevelinje
  const jawBase = sliceStart[9]
  vertices[jawBase + 4].X *= 0.95
  vertices[jawBase + (SEGMENTS - 4)].X *= 0.95
}

// EYE SOCKETS: konkave groper. Ring av punkter på/foran hode-overflaten,
// og et senter-punkt presset BAKOVER → Lambertian-shading gir mørk dybde-følelse.
function addEyeSockets(verts, tris, hw, hh, hd) {
  const eyeY = -0.05
  const eyeXOffset = hw * 0.42
  const sockRingR = 0.22
  const sockRingRY = 0.16
  const segs = 10

  // Beregn approksimativ overflate-Z ved øye-X (ellipsoidisk)
  const xRel = (eyeXOffset / hw)
  const surfaceZ = hd * Math.sqrt(Math.max(0.0, 1 - xRel * xRel))
  const ringForward = 0.06   // litt foran hode-overflaten
  const centerBack = 0.10    // senter er ringForward - 0.10 (relativt konkav)

  for (const sign of [-1, 1]) {
    const cx = sign * eyeXOffset
    const ringStart = verts.length
    for (let i = 0; i < segs; i++) {
      const angle = (i / segs) * Math.PI * 2
      verts.push({
        X: cx + Math.cos(angle) * sockRingR * 0.95,
        Y: eyeY + Math.sin(angle) * sockRingRY,
        Z: surfaceZ + ringForward,
      })
    }
    const centerIdx = verts.length
    verts.push({
      X: cx,
      Y: eyeY,
      Z: surfaceZ + ringForward - centerBack,
    })
    for (let i = 0; i < segs; i++) {
      const ni = (i + 1) % segs
      tris.push(tri([centerIdx, ringStart + ni, ringStart + i], 'eyeSocket'))
    }
  }
}

// NESE: konveks 4-sidig kile som stikker ut fra ansiktet
function addNose(verts, tris, hw, hh, hd) {
  const tipY = hh * 0.20
  const topY = -0.08
  const baseY = hh * 0.34
  const tipZ = hd * 1.30
  const halfW = hw * 0.10

  const tip = verts.length
  verts.push({ X: 0, Y: tipY, Z: tipZ })
  const topL = verts.length
  verts.push({ X: -halfW * 0.7, Y: topY, Z: hd * 0.95 })
  const topR = verts.length
  verts.push({ X: halfW * 0.7, Y: topY, Z: hd * 0.95 })
  const baseL = verts.length
  verts.push({ X: -halfW, Y: baseY, Z: hd * 0.92 })
  const baseR = verts.length
  verts.push({ X: halfW, Y: baseY, Z: hd * 0.92 })

  // 4 trekanter forming en pyramide
  tris.push(tri([tip, topL, topR], 'nose'))
  tris.push(tri([tip, topR, baseR], 'nose'))
  tris.push(tri([tip, baseR, baseL], 'nose'))
  tris.push(tri([tip, baseL, topL], 'nose'))
}

// LEPPER: to konvekse "patches", øvre og nedre, i palettens munn-farge
function addLips(verts, tris, hw, hh, hd) {
  const mouthY = hh * 0.50
  const mouthZ = hd * 0.86
  const halfW = hw * 0.20
  const lipH = 0.08

  // Øvre leppe (litt smalere, høyere)
  buildLipFan(verts, tris, 0, mouthY - lipH * 0.7, mouthZ, halfW * 0.95, lipH * 0.9)
  // Nedre leppe (litt bredere, lavere)
  buildLipFan(verts, tris, 0, mouthY + lipH * 0.7, mouthZ, halfW * 1.0, lipH * 1.0)
}

function buildLipFan(verts, tris, cx, cy, cz, halfW, halfH) {
  const segs = 10
  const centerIdx = verts.length
  // Center pushed forward → konveks bump
  verts.push({ X: cx, Y: cy, Z: cz + 0.07 })
  const ringStart = verts.length
  for (let i = 0; i < segs; i++) {
    const angle = (i / segs) * Math.PI * 2
    verts.push({
      X: cx + Math.cos(angle) * halfW,
      Y: cy + Math.sin(angle) * halfH,
      Z: cz,
    })
  }
  for (let i = 0; i < segs; i++) {
    const ni = (i + 1) % segs
    tris.push(tri([centerIdx, ringStart + i, ringStart + ni], 'lips'))
  }
}

// HÅR-mesh — også med region-tag for konsistent rendering
export function buildHairMesh(headMesh, hair) {
  if (!hair?.hasHair) return null
  const length = hair.length ?? 0.3
  const segs = SEGMENTS

  const sliceIndices = [0, 1, 2, 3, 4]
  const sliceCount = sliceIndices.length

  const liftProfile = [0.55 + length * 0.7, 0.42 + length * 0.55, 0.25 + length * 0.35, 0.10 + length * 0.20, 0.02]
  const baseExpand = [1.18 + length * 0.20, 1.20 + length * 0.22, 1.15 + length * 0.18, 1.08 + length * 0.10, 1.02]

  const verts = []
  for (let s = 0; s < sliceCount; s++) {
    const headSliceBase = sliceIndices[s] * segs
    const lift = liftProfile[s]
    const expandB = baseExpand[s]
    for (let i = 0; i < segs; i++) {
      const v = headMesh.vertices[headSliceBase + i]
      const angleNorm = i / segs
      const isBack = Math.abs(angleNorm - 0.5) < 0.25
      const expand = isBack ? expandB * 1.10 : expandB * 0.92
      const isFrontSlice = s === sliceCount - 1
      const isFrontVertex = i === 0 || i === segs - 1 || i === 1 || i === segs - 2
      const finalLift = (isFrontSlice && isFrontVertex) ? lift * 0.4 : lift
      const finalExpand = (isFrontSlice && isFrontVertex) ? Math.min(expand, 1.05) : expand

      verts.push({
        X: v.X * finalExpand,
        Y: v.Y - finalLift,
        Z: v.Z * finalExpand,
      })
    }
  }

  const tris = []
  for (let s = 0; s < sliceCount - 1; s++) {
    const a = s * segs
    const b = (s + 1) * segs
    for (let i = 0; i < segs; i++) {
      const ni = (i + 1) % segs
      tris.push(tri([a + i, b + i, b + ni], 'hair'))
      tris.push(tri([a + i, b + ni, a + ni], 'hair'))
    }
  }
  const topApex = verts.length
  verts.push({ X: 0, Y: verts[0].Y - 0.18, Z: 0 })
  for (let i = 0; i < segs; i++) {
    const ni = (i + 1) % segs
    tris.push(tri([topApex, ni, i], 'hair'))
  }

  return { vertices: verts, triangles: tris, length }
}
