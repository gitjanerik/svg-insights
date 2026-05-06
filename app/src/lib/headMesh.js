// 3D-hodemesh: parametrisk genererte trekanter formet som et hode.
// Deformeres av bruker-målte proporsjoner (eyeDistance, faceHeight). Inneholder
// anatomiske features som ekte mesh-deformasjoner: øyehuler indentert,
// nesetipp utstikket, brynkam, kjevelinje.
//
// Output:
//   vertices: [{X, Y, Z}]  — ~178 punkter
//   triangles: [[a, b, c]] — ~352 trekanter
//   features: { leftEye, rightEye, nose, mouth, leftBrow, rightBrow }
//
// Konvensjon: ansiktets origo mellom øynene, +X høyre, +Y ned, +Z fremover
// (mot kameraet).

const SEGMENTS = 16  // antall punkter pr horisontale skive

// Skive-profil: [y-faktor, rx-faktor, rz-faktor]. y er normalisert
// til ±1 av halve hode-høyden. rx/rz multipliseres med headWidth/headDepth.
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

export function buildHeadMesh(proportions = {}, opts = {}) {
  // faceAspect = bbox.bredde / bbox.høyde fra capturen. Default 0.72 = typisk
  // ansikts-ratio. Verdier > 0.85 gir bredere/rundere hode, < 0.65 gir lengre.
  const { faceAspect = 0.72 } = opts

  const measuredHeight = (proportions.faceHeight ?? 4.0) * 0.55
  const headHeight = Math.max(2.0, measuredHeight)
  // Bred basert på faktisk capture-aspect — slik at en bredansiktet bruker
  // får et bredere hode, mens en smal-ansiktet får et smalere hode.
  const headWidth = headHeight * Math.max(0.55, Math.min(1.05, faceAspect))
  const headDepth = headWidth * 0.92

  const vertices = []
  const sliceStart = []

  for (const [yf, rxf, rzf] of SLICES) {
    sliceStart.push(vertices.length)
    for (let i = 0; i < SEGMENTS; i++) {
      // Vinkel starter på +Z (front), går CCW sett ovenfra.
      // i=0: front, i=SEGMENTS/4: høyre, i=SEGMENTS/2: bak, i=3*SEGMENTS/4: venstre
      const angle = (i / SEGMENTS) * Math.PI * 2
      vertices.push({
        X: Math.sin(angle) * rxf * headWidth,
        Y: yf * headHeight,
        Z: Math.cos(angle) * rzf * headDepth,
      })
    }
  }

  // Apex-vertices for top + bunn (kran og hake-tipp)
  const topApex = vertices.length
  vertices.push({ X: 0, Y: -headHeight * 1.08, Z: 0 })
  const bottomApex = vertices.length
  vertices.push({ X: 0, Y: headHeight * 1.08, Z: 0 })

  // 3D-feature-deformasjoner (anvendt etter at slice-vertices er på plass)
  applyDeformations(vertices, sliceStart, headWidth, headHeight, headDepth)

  // Bygg trekanter
  const triangles = []

  // Mellom påfølgende skiver: hver kvadrant deles i to trekanter
  for (let s = 0; s < SLICES.length - 1; s++) {
    const a = sliceStart[s]
    const b = sliceStart[s + 1]
    for (let i = 0; i < SEGMENTS; i++) {
      const ni = (i + 1) % SEGMENTS
      triangles.push([a + i, b + i, b + ni])
      triangles.push([a + i, b + ni, a + ni])
    }
  }

  // Topp-cap (vifte fra topApex til skive 0)
  for (let i = 0; i < SEGMENTS; i++) {
    const ni = (i + 1) % SEGMENTS
    triangles.push([topApex, sliceStart[0] + ni, sliceStart[0] + i])
  }

  // Bunn-cap (vifte fra bottomApex til siste skive)
  const last = sliceStart[SLICES.length - 1]
  for (let i = 0; i < SEGMENTS; i++) {
    const ni = (i + 1) % SEGMENTS
    triangles.push([bottomApex, last + i, last + ni])
  }

  // Features: 3D-posisjoner brukt for overlay (øyne, bryn, munn, evt. briller)
  const eyeY = 0
  const eyeX = headWidth * 0.45
  const eyeZ = headDepth * 0.92
  const features = {
    leftEye: { X: -eyeX, Y: eyeY, Z: eyeZ },
    rightEye: { X: eyeX, Y: eyeY, Z: eyeZ },
    leftBrow: buildBrowArc(-eyeX, eyeY - 0.18, eyeZ, true),
    rightBrow: buildBrowArc(eyeX, eyeY - 0.18, eyeZ, false),
    noseTip: { X: 0, Y: headHeight * 0.25, Z: headDepth * 1.18 },
    noseBridge: { X: 0, Y: -0.18, Z: headDepth * 0.95 },
    mouthLeft: { X: -headWidth * 0.20, Y: headHeight * 0.50, Z: headDepth * 0.78 },
    mouthRight: { X: headWidth * 0.20, Y: headHeight * 0.50, Z: headDepth * 0.78 },
    mouthCenter: { X: 0, Y: headHeight * 0.50, Z: headDepth * 0.82 },
  }

  return {
    vertices,
    triangles,
    features,
    bounds: { headWidth, headHeight, headDepth },
  }
}

// Bygg en bryn-bue som 5 punkter
function buildBrowArc(centerX, y, z, mirror) {
  const arr = []
  const halfLen = 0.32
  for (let i = 0; i < 5; i++) {
    const t = i / 4
    const x = centerX + (mirror ? -1 : 1) * (halfLen * (t * 2 - 1))
    const arch = Math.sin(t * Math.PI) * 0.04
    arr.push({ X: x, Y: y - arch, Z: z * 1.02 })
  }
  return arr
}

// Anvend feature-deformasjoner på spesifikke vertices.
// Front-of-face = vertex i=0 (Z = +rz·headDepth, X=0).
// Right-of-front = lave indekser (i=1, i=2 osv.).
// Left-of-front = høye indekser (i=SEGMENTS-1, i=SEGMENTS-2).
function applyDeformations(vertices, sliceStart, hw, hh, hd) {
  const eyeSlice = 4
  const noseSlices = [5, 6, 7]
  const browSlice = 3

  // Øyehuler: indenter front-side vertices ved øye-nivå
  // Right-eye er omtrent ved i ≈ 2 (mellom front og høyre side)
  // Left-eye er omtrent ved i ≈ SEGMENTS-2 (mellom front og venstre side)
  const rightEyeI = 2
  const leftEyeI = SEGMENTS - 2
  const eyeBase = sliceStart[eyeSlice]
  vertices[eyeBase + rightEyeI].Z *= 0.93
  vertices[eyeBase + leftEyeI].Z *= 0.93

  // Brynkam: liten utstikk over øynene på bryn-skiven
  const browBase = sliceStart[browSlice]
  vertices[browBase + 0].Z *= 1.04
  vertices[browBase + 1].Z *= 1.03
  vertices[browBase + (SEGMENTS - 1)].Z *= 1.03

  // Nese-utstikk: front-vertices ved nese-skivene presses fremover
  const noseFactors = [1.10, 1.32, 1.08]  // toppen, midten, bunnen av nese
  for (let k = 0; k < noseSlices.length; k++) {
    const sliceIdx = noseSlices[k]
    const factor = noseFactors[k]
    const base = sliceStart[sliceIdx]
    vertices[base + 0].Z *= factor
    // Neighbouring vertices litt mindre — gir nese-form fremfor en spike
    vertices[base + 1].Z *= 1 + (factor - 1) * 0.4
    vertices[base + (SEGMENTS - 1)].Z *= 1 + (factor - 1) * 0.4
  }

  // Kjevelinje: smal litt inn på sidene av jaw-skiven
  const jawBase = sliceStart[9]
  vertices[jawBase + 4].X *= 0.95
  vertices[jawBase + (SEGMENTS - 4)].X *= 0.95
}

// Bygg en hår-mesh med volum, bakhåndet og hairline foran.
// Hårets profil:
//   - Stor volum-økning på topp/bak (krans, bakhode)
//   - Liten ekspansjon foran (hairline kommer bare litt frem på pannen)
//   - Sidene strekker seg ned forbi øynene som bakkant
export function buildHairMesh(headMesh, hair) {
  if (!hair?.hasHair) return null
  const length = hair.length ?? 0.3
  const segs = SEGMENTS

  // Tar de 5 øverste skivene fra hodet (topp → bryn) og deformerer dem
  // pr per-vertex basert på vinkel — front (i=0) inflateres mindre enn bak.
  const sliceIndices = [0, 1, 2, 3, 4]
  const sliceCount = sliceIndices.length

  // Volum-profil pr skive: krans har mest volum, bryn-nivå har minst (hairline)
  const liftProfile = [0.55 + length * 0.7, 0.42 + length * 0.55, 0.25 + length * 0.35, 0.10 + length * 0.20, 0.02]
  const baseExpand = [1.18 + length * 0.20, 1.20 + length * 0.22, 1.15 + length * 0.18, 1.08 + length * 0.10, 1.02]

  const verts = []
  for (let s = 0; s < sliceCount; s++) {
    const headSliceBase = sliceIndices[s] * segs
    const lift = liftProfile[s]
    const expandB = baseExpand[s]
    for (let i = 0; i < segs; i++) {
      const v = headMesh.vertices[headSliceBase + i]
      // Vinkel: i=0 er front (+Z), i=segs/2 er bak (-Z)
      const angleNorm = i / segs
      const isBack = Math.abs(angleNorm - 0.5) < 0.25 // bakerste 50%
      // Bak-ekspansjon større for å gi bakhode-volum
      const expand = isBack ? expandB * 1.10 : expandB * 0.92
      // Front (skive 4 = bryn) får ingen utstikk — det er hairline
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
      tris.push([a + i, b + i, b + ni])
      tris.push([a + i, b + ni, a + ni])
    }
  }
  // Topp-cap
  const topApex = verts.length
  verts.push({ X: 0, Y: verts[0].Y - 0.18, Z: 0 })
  for (let i = 0; i < segs; i++) {
    const ni = (i + 1) % segs
    tris.push([topApex, ni, i])
  }

  return { vertices: verts, triangles: tris, length }
}
