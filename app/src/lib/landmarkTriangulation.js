// Triangulering av ansikts-landemerker fra to-frame-observasjoner under en
// sveip-bue. Kameraet beveger seg på en sirkel rundt ansiktet (armlengdes
// avstand), så vi kan konstruere kameraposer direkte fra IMU-rotasjonen.
//
// Konvensjon:
//   - Ansikts-senter i verden = origo
//   - Kamera ved vinkel θ rundt Y-aksen, distanse d, ser mot origo
//   - Kamerakonvensjon: +Z fremover (inn i scene), +Y ned, +X høyre

import { defaultIntrinsics, projectionMatrix, triangulatePoint } from './triangulation.js'

// Bygg kamera-pose for sveip ved gitt vinkel.
// distance er i samme enhet som de resulterende 3D-koordinatene (dimensjonsløs).
export function buildSweepPose(angleRad, distance = 1.0) {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  // Rotasjon: world → camera. Kamera ved (-sinθ·d, 0, -cosθ·d) i verden,
  // ser mot origo. R_wc roterer verdens-akser inn i kameraets:
  return {
    R: [
      [c, 0, -s],
      [0, 1, 0],
      [s, 0, c],
    ],
    t: [0, 0, distance],
  }
}

// Triangulerer alle 6 landemerker. Tar observasjoner fra første og siste frame
// og IMU-sveip-vinkelen i radianer. Returnerer { name: { X, Y, Z } } for hvert
// landemerke som ble triangulert.
export function triangulateLandmarks(landmarksFirst, landmarksLast, sweepAngleRad, frameWidth, frameHeight) {
  const halfAngle = sweepAngleRad / 2
  const pose0 = buildSweepPose(-halfAngle)
  const pose1 = buildSweepPose(+halfAngle)
  const K = defaultIntrinsics(frameWidth, frameHeight)
  const P0 = projectionMatrix(K, pose0.R, pose0.t)
  const P1 = projectionMatrix(K, pose1.R, pose1.t)

  const names = ['leftEye', 'rightEye', 'nose', 'mouth', 'forehead', 'chin']
  const out = {}
  for (const name of names) {
    const a = landmarksFirst?.[name]
    const b = landmarksLast?.[name]
    if (!a || !b) continue
    const X = triangulatePoint([
      { P: P0, u: a.x, v: a.y },
      { P: P1, u: b.x, v: b.y },
    ])
    if (X && isFinite(X.X) && isFinite(X.Y) && isFinite(X.Z)) {
      out[name] = X
    }
  }
  return out
}

// Avled portrettparametre fra 2D-landemerker uten triangulering.
// Bruker mal-Z-verdier for dybde — tilstrekkelig når output stiliseres
// uansett (Simpsons-stil bryr seg ikke om eksakt nese-utstikk).
//
// Z-malverdier representerer en typisk ansikts-anatomi der øyne er på
// referanse-planet (Z=0) og andre features stikker frem mot kameraet.
const TEMPLATE_Z = {
  leftEye: 0,
  rightEye: 0,
  nose: -0.30,
  mouth: -0.10,
  forehead: -0.05,
  chin: -0.05,
}

export function proportionsFrom2D(landmarks2D) {
  if (!landmarks2D?.leftEye || !landmarks2D?.rightEye) return null

  const eyeCx = (landmarks2D.leftEye.x + landmarks2D.rightEye.x) / 2
  const eyeCy = (landmarks2D.leftEye.y + landmarks2D.rightEye.y) / 2
  const eyeDist2D = Math.hypot(
    landmarks2D.rightEye.x - landmarks2D.leftEye.x,
    landmarks2D.rightEye.y - landmarks2D.leftEye.y
  )
  if (eyeDist2D < 5) return null

  // Konverter 2D-landemerker til normaliserte 3D-punkter med mal-Z
  function lift(name) {
    const p = landmarks2D[name]
    if (!p) return null
    return {
      X: (p.x - eyeCx) / eyeDist2D,
      Y: (p.y - eyeCy) / eyeDist2D,
      Z: TEMPLATE_Z[name] ?? 0,
    }
  }

  const landmarks3D = {
    leftEye: lift('leftEye'),
    rightEye: lift('rightEye'),
    nose: lift('nose'),
    mouth: lift('mouth'),
    forehead: lift('forehead'),
    chin: lift('chin'),
  }

  return deriveProportions(landmarks3D)
}

// Tar median av landemerke-posisjoner over flere frames for å redusere
// støy fra én-frames mis-deteksjon. Returnerer landmarks-objekt med median
// pr koordinat, eller null hvis ingen valide finnes.
export function medianLandmarks(landmarksArray) {
  const valid = landmarksArray.filter(l => l !== null && l !== undefined)
  if (valid.length === 0) return null

  function median(arr) {
    if (arr.length === 0) return null
    const sorted = [...arr].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }

  const out = {}
  const names = ['leftEye', 'rightEye', 'nose', 'mouth', 'forehead', 'chin']
  for (const name of names) {
    const xs = []
    const ys = []
    for (const lm of valid) {
      if (lm[name]) {
        xs.push(lm[name].x)
        ys.push(lm[name].y)
      }
    }
    if (xs.length > 0) {
      out[name] = { x: median(xs), y: median(ys) }
    }
  }

  // Returner null hvis vi ikke har minimum øyne (alt annet kan være valgfritt)
  if (!out.leftEye || !out.rightEye) return null
  return out
}

// Avled portrettparametre fra trianguliderte 3D-landemerker.
// Alle dimensjoner er relative til intra-okulær avstand (eyeWidth = 1 enhet),
// så modellen blir skala-invariant. Dette gjør parametrene direkte sammenlignbare
// på tvers av brukere uavhengig av hvor stort ansiktet var i bildet.
export function deriveProportions(landmarks3D) {
  const { leftEye, rightEye, nose, mouth, forehead, chin } = landmarks3D
  if (!leftEye || !rightEye) return null

  const eyeDx = rightEye.X - leftEye.X
  const eyeDy = rightEye.Y - leftEye.Y
  const eyeDz = rightEye.Z - leftEye.Z
  const eyeDistance = Math.hypot(eyeDx, eyeDy, eyeDz)
  if (eyeDistance < 1e-6) return null

  // Senter mellom øynene (referansepunkt for andre mål)
  const eyeCenter = {
    X: (leftEye.X + rightEye.X) / 2,
    Y: (leftEye.Y + rightEye.Y) / 2,
    Z: (leftEye.Z + rightEye.Z) / 2,
  }

  function distToEyeCenter(p) {
    if (!p) return null
    return Math.hypot(p.X - eyeCenter.X, p.Y - eyeCenter.Y, p.Z - eyeCenter.Z) / eyeDistance
  }

  function vertical(p) {
    if (!p) return null
    return (p.Y - eyeCenter.Y) / eyeDistance
  }

  function depth(p) {
    if (!p) return null
    return (p.Z - eyeCenter.Z) / eyeDistance
  }

  return {
    eyeDistance,                              // brukt som skala-referanse
    noseLength: vertical(nose),               // nese-tipp under øye-linja
    noseProjection: depth(nose),              // hvor langt nesa stikker frem
    mouthDrop: vertical(mouth),               // munn under øye-linja
    foreheadHeight: vertical(forehead),       // panne over øye-linja (negativ Y)
    chinDrop: vertical(chin),                 // hake under øye-linja
    faceHeight: vertical(chin) - vertical(forehead),
    eyeCenter,
    landmarks: landmarks3D,
  }
}
