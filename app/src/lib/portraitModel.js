// Parametrisk 3D-hodemodell. Tar målte proporsjoner + aksessoirer og returnerer
// en struktur av 3D-vertices og -segmenter som kan projisert ned til SVG fra
// hvilken som helst rotasjon. Designet for senere STL-eksport ved at all
// geometri er definert som 3D-punkter.
//
// Konvensjon: ansiktets origo = mellom øynene. +X høyre, +Y ned, +Z bakover.
// Alle dimensjoner er i enheter av eyeDistance (intra-okulær avstand = 1).

// Mal-vertices for hodet, definert i normalisert ansikts-rom.
// 5 horisontale "skiver" gjennom hodet, 6 punkter pr skive (front, side-front,
// side-bak, bak, side-bak-mirror, side-front-mirror) — tilsvarer en halv ellipsoide.
const HEAD_TEMPLATE = [
  // skive 0: pannetopp (y=-1.4)
  { x: 0.0, y: -1.4, z: -0.85 }, { x: 0.85, y: -1.4, z: -0.25 },
  { x: 0.95, y: -1.4, z: 0.55 }, { x: 0.0, y: -1.4, z: 0.95 },
  { x: -0.95, y: -1.4, z: 0.55 }, { x: -0.85, y: -1.4, z: -0.25 },

  // skive 1: øye-nivå (y=0)
  { x: 0.0, y: 0.0, z: -1.05 },  { x: 1.05, y: 0.0, z: -0.20 },
  { x: 1.10, y: 0.0, z: 0.65 },  { x: 0.0, y: 0.0, z: 1.05 },
  { x: -1.10, y: 0.0, z: 0.65 }, { x: -1.05, y: 0.0, z: -0.20 },

  // skive 2: nese-nivå (y=0.55)
  { x: 0.0, y: 0.55, z: -1.10 }, { x: 0.95, y: 0.55, z: -0.10 },
  { x: 1.00, y: 0.55, z: 0.65 }, { x: 0.0, y: 0.55, z: 1.00 },
  { x: -1.00, y: 0.55, z: 0.65 },{ x: -0.95, y: 0.55, z: -0.10 },

  // skive 3: munn-nivå (y=1.05)
  { x: 0.0, y: 1.05, z: -0.95 }, { x: 0.78, y: 1.05, z: 0.00 },
  { x: 0.82, y: 1.05, z: 0.60 }, { x: 0.0, y: 1.05, z: 0.95 },
  { x: -0.82, y: 1.05, z: 0.60 },{ x: -0.78, y: 1.05, z: 0.00 },

  // skive 4: hake-nivå (y=1.55)
  { x: 0.0, y: 1.55, z: -0.55 }, { x: 0.45, y: 1.55, z: 0.10 },
  { x: 0.55, y: 1.55, z: 0.55 }, { x: 0.0, y: 1.55, z: 0.60 },
  { x: -0.55, y: 1.55, z: 0.55 },{ x: -0.45, y: 1.55, z: 0.10 },
]

// Bygg portrettmodellen fra proporsjonsmål + aksessoirer.
// Returnerer en flat struktur av 3D-elementer som kan rendres lag-på-lag.
export function buildPortraitModel(proportions, accessories) {
  if (!proportions) return null

  const { eyeCenter, landmarks } = proportions
  const useMeasurements = !!landmarks?.leftEye && !!landmarks?.rightEye

  // X-skalering: bruk faktisk eyeDistance · halv-bredde-faktor
  const sx = 1.3 // hvor mye bredere hodet er enn øye-avstanden
  // Y-skalering: forsøk å bruke målt faceHeight, ellers anatomisk gjennomsnitt
  const measuredFaceHeight = (proportions.chinDrop ?? 1.5) - (proportions.foreheadHeight ?? -1.2)
  const sy = Math.max(2.0, measuredFaceHeight) // sikkerhetsbunn
  // Z-skalering: hodets dybde er typisk ~85% av bredden
  const sz = sx * 0.95

  // Skaler malen
  const headVertices = HEAD_TEMPLATE.map(p => ({
    X: p.x * sx,
    Y: p.y * sy * 0.5,  // gjør hodet litt rundere
    Z: p.z * sz,
  }))

  // Inner-features: bruk faktiske landmarks hvis de er tilgjengelige
  // (alle relativt til eyeCenter, normalisert med eyeDistance)
  function landmarkAsLocal(name, fallback) {
    if (useMeasurements && landmarks[name]) {
      const p = landmarks[name]
      return {
        X: (p.X - eyeCenter.X) / proportions.eyeDistance,
        Y: (p.Y - eyeCenter.Y) / proportions.eyeDistance,
        Z: (p.Z - eyeCenter.Z) / proportions.eyeDistance,
      }
    }
    return fallback
  }

  const eyeY = 0
  const eyeZ = -0.95 // omtrent på samme dybde som pannetopp-fronten
  const features = {
    leftEye: landmarkAsLocal('leftEye', { X: -0.5, Y: eyeY, Z: eyeZ }),
    rightEye: landmarkAsLocal('rightEye', { X: 0.5, Y: eyeY, Z: eyeZ }),
    nose: landmarkAsLocal('nose', { X: 0, Y: 0.55, Z: -1.10 }),
    mouth: landmarkAsLocal('mouth', { X: 0, Y: 1.05, Z: -0.85 }),
    chin: landmarkAsLocal('chin', { X: 0, Y: 1.55, Z: -0.55 }),
    forehead: landmarkAsLocal('forehead', { X: 0, Y: -1.4, Z: -0.85 }),
  }

  // Eyebrow-arcs: 5 punkter over hvert øye, lett bue
  function eyebrowArc(eyeP, mirror) {
    const offsetY = -0.30
    const offsetZ = -0.05
    const halfLen = 0.42
    const arch = -0.05
    const arr = []
    for (let i = 0; i < 5; i++) {
      const t = i / 4
      const x = eyeP.X + (mirror ? -1 : 1) * (halfLen * (t * 2 - 1))
      const y = eyeP.Y + offsetY + Math.sin(t * Math.PI) * arch
      const z = eyeP.Z + offsetZ
      arr.push({ X: x, Y: y, Z: z })
    }
    return arr
  }
  const eyebrows = {
    left: eyebrowArc(features.leftEye, true),
    right: eyebrowArc(features.rightEye, false),
  }

  // Nose-path: 4 punkter (mellom øyne → nese-tip → munn-side venstre/høyre)
  const nose = {
    bridge: { X: 0, Y: -0.25, Z: features.nose.Z * 0.7 },
    tip: features.nose,
    base: { X: 0, Y: features.nose.Y + 0.08, Z: features.nose.Z * 0.85 },
    leftFlare: { X: -0.18, Y: features.nose.Y + 0.05, Z: features.nose.Z * 0.85 },
    rightFlare: { X: 0.18, Y: features.nose.Y + 0.05, Z: features.nose.Z * 0.85 },
  }

  // Mouth: 5 punkter (venstre munnvik, øvre senter, høyre munnvik, nedre senter)
  const mouthHalfWidth = 0.4
  const mouth = {
    left: { X: -mouthHalfWidth, Y: features.mouth.Y, Z: features.mouth.Z },
    right: { X: mouthHalfWidth, Y: features.mouth.Y, Z: features.mouth.Z },
    upperCenter: { X: 0, Y: features.mouth.Y - 0.04, Z: features.mouth.Z },
    lowerCenter: { X: 0, Y: features.mouth.Y + 0.06, Z: features.mouth.Z },
  }

  const layers = {
    head: { vertices: headVertices, sx, sy, sz },
    eyebrows,
    eyes: {
      left: { center: features.leftEye },
      right: { center: features.rightEye },
    },
    nose,
    mouth,
  }

  // Aksessoir-lag (valgfrie)
  if (accessories?.hair?.hasHair) {
    layers.hair = buildHairLayer(headVertices, accessories.hair, sx, sy, sz)
  }
  if (accessories?.glasses?.hasGlasses) {
    layers.glasses = buildGlassesLayer(features)
  }
  if (accessories?.beard?.hasBeard) {
    layers.beard = buildBeardLayer(features, accessories.beard, sx)
  }

  return layers
}

// Hår: en blob over panneregionen, formet etter hodets topp-skive med ekstra
// volum oppover proporsjonalt med 'length'.
function buildHairLayer(headVertices, hair, sx, sy, sz) {
  const topSlice = headVertices.slice(0, 6)
  const lift = 0.4 + hair.length * 0.7
  const expand = 1 + hair.length * 0.15
  const vertices = topSlice.map(p => ({
    X: p.X * expand,
    Y: p.Y - lift * sy * 0.15,
    Z: p.Z * expand,
  }))
  return {
    vertices,
    length: hair.length,
  }
}

// Briller: to sirkler sentrert på øynene + bro mellom dem
function buildGlassesLayer(features) {
  const lensRadius = 0.42
  return {
    leftLens: { center: features.leftEye, radius: lensRadius },
    rightLens: { center: features.rightEye, radius: lensRadius },
    bridge: {
      from: { X: features.leftEye.X + lensRadius, Y: features.leftEye.Y, Z: features.leftEye.Z },
      to: { X: features.rightEye.X - lensRadius, Y: features.rightEye.Y, Z: features.rightEye.Z },
    },
  }
}

// Skjegg: en region under munn ned til hake, modellert som 5 punkter rundt nedre ansikt
function buildBeardLayer(features, beard, sx) {
  const halfWidth = sx * 0.55
  const topY = features.mouth.Y + 0.08
  const midY = (features.mouth.Y + features.chin.Y) / 2
  const chinY = features.chin.Y
  return {
    vertices: [
      { X: -halfWidth * 0.75, Y: topY, Z: -0.2 },
      { X: -halfWidth * 0.85, Y: midY, Z: -0.1 },
      { X: -halfWidth * 0.4, Y: chinY, Z: -0.3 },
      { X: 0, Y: chinY + 0.05, Z: -0.4 },
      { X: halfWidth * 0.4, Y: chinY, Z: -0.3 },
      { X: halfWidth * 0.85, Y: midY, Z: -0.1 },
      { X: halfWidth * 0.75, Y: topY, Z: -0.2 },
    ],
    density: beard.density,
  }
}

// Roterer en 3D-vertex rundt Y-aksen (for visning)
export function rotateY(v, angleRad) {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return {
    X: v.X * c - v.Z * s,
    Y: v.Y,
    Z: v.X * s + v.Z * c,
  }
}

// Roter alle vertices i en modell rundt Y-aksen
export function rotateModel(model, angleRad) {
  if (!model) return null
  const rotated = {}
  for (const [key, layer] of Object.entries(model)) {
    rotated[key] = rotateLayer(layer, angleRad)
  }
  return rotated
}

function rotateLayer(layer, angleRad) {
  if (Array.isArray(layer)) return layer.map(v => rotateY(v, angleRad))
  if (!layer || typeof layer !== 'object') return layer
  if ('X' in layer && 'Y' in layer && 'Z' in layer) return rotateY(layer, angleRad)
  const out = {}
  for (const [k, v] of Object.entries(layer)) {
    out[k] = rotateLayer(v, angleRad)
  }
  return out
}
