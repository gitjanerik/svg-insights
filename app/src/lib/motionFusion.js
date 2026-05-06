// Konverterer rå IMU-samples (DeviceOrientation/DeviceMotion) til
// per-frame rotasjonsmatriser og en estimert translasjons-retning.
//
// W3C DeviceOrientation-konvensjon (ZXY-euler):
//   alpha = rotasjon rundt Z (kompass / yaw)
//   beta  = rotasjon rundt X' (forover-bakover / pitch)
//   gamma = rotasjon rundt Y'' (sideveis / roll)
// R = Rz(alpha) · Rx(beta) · Ry(gamma)

const DEG = Math.PI / 180

export function rotationMatrixFromEuler(alphaDeg, betaDeg, gammaDeg) {
  const a = alphaDeg * DEG
  const b = betaDeg * DEG
  const g = gammaDeg * DEG
  const ca = Math.cos(a), sa = Math.sin(a)
  const cb = Math.cos(b), sb = Math.sin(b)
  const cg = Math.cos(g), sg = Math.sin(g)

  // R = Rz · Rx · Ry, utskrevet (3x3, row-major)
  return [
    [ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg],
    [sa * cg + ca * sb * sg, ca * cb,  sa * sg - ca * sb * cg],
    [-cb * sg,               sb,        cb * cg],
  ]
}

// 3x3 matrix multiply: A · B
export function matMul3(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0
      for (let k = 0; k < 3; k++) s += A[i][k] * B[k][j]
      C[i][j] = s
    }
  }
  return C
}

// Transpose av 3x3
export function transpose3(M) {
  return [
    [M[0][0], M[1][0], M[2][0]],
    [M[0][1], M[1][1], M[2][1]],
    [M[0][2], M[1][2], M[2][2]],
  ]
}

// Multipliser 3x3 med 3-vektor
export function matVec3(M, v) {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ]
}

// Finn nærmeste sample i tid (samples må være sortert etter t)
export function sampleAtTime(samples, t) {
  if (samples.length === 0) return null
  if (t <= samples[0].t) return samples[0]
  if (t >= samples[samples.length - 1].t) return samples[samples.length - 1]
  // Lineær søk er ok for ~50-200 samples
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].t >= t) {
      const a = samples[i - 1]
      const b = samples[i]
      const u = (t - a.t) / (b.t - a.t)
      // Lerp euler-vinkler (god nok for små intervaller)
      return {
        t,
        alpha: lerpAngle(a.alpha, b.alpha, u),
        beta: lerp(a.beta, b.beta, u),
        gamma: lerp(a.gamma, b.gamma, u),
      }
    }
  }
  return samples[samples.length - 1]
}

function lerp(a, b, u) {
  return a + (b - a) * u
}

// Wrapper rundt 360 grader for alpha
function lerpAngle(a, b, u) {
  let diff = b - a
  if (diff > 180) diff -= 360
  else if (diff < -180) diff += 360
  return a + diff * u
}

// Bygg per-frame rotasjonsmatriser, relative til frame 0.
// Returnerer array { R, alpha, beta, gamma } per frame.
export function buildFramePoses(frames, motionSamples) {
  const orientationSamples = motionSamples.filter(s => s.kind === 'orientation')

  if (orientationSamples.length === 0) {
    // Fallback: identitet for alle (ingen IMU-data tilgjengelig)
    return frames.map(() => ({ R: identityMat3(), alpha: 0, beta: 0, gamma: 0 }))
  }

  // Sample for hver frame-tidspunkt
  const perFrame = frames.map(f => sampleAtTime(orientationSamples, f.timestamp))

  // Bruk frame 0 som referanse
  const R0 = rotationMatrixFromEuler(perFrame[0].alpha, perFrame[0].beta, perFrame[0].gamma)
  const R0T = transpose3(R0)

  return perFrame.map(s => {
    const R = rotationMatrixFromEuler(s.alpha, s.beta, s.gamma)
    return {
      R: matMul3(R0T, R), // Relativ rotasjon: R_0^T · R_i
      alpha: s.alpha,
      beta: s.beta,
      gamma: s.gamma,
    }
  })
}

export function identityMat3() {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
}

// Estimer translasjons-retning fra gjennomsnittlig optical flow.
// Hvis kameraet beveger seg til høyre, vil features se ut som de beveger seg
// til venstre i bildet. Vi tar gjennomsnitts-flowen mellom første og siste
// frame, og inverterer den for å få kameraets bevegelses-retning i bildeplanet.
//
// Returnerer en enhetsvektor i kamera-koordinater (3D) som best matcher.
// Vi antar at flow-y er liten (sidelengs-bevegelse dominerer).
export function estimateTranslationDirection(tracks) {
  let sumDx = 0
  let sumDy = 0
  let n = 0
  for (const t of tracks) {
    if (t.points.length < 2) continue
    const a = t.points[0]
    const b = t.points[t.points.length - 1]
    sumDx += b.x - a.x
    sumDy += b.y - a.y
    n++
  }
  if (n === 0) return { x: 1, y: 0, z: 0, magnitude: 0 }
  const avgDx = sumDx / n
  const avgDy = sumDy / n
  const mag = Math.hypot(avgDx, avgDy)
  if (mag < 0.5) {
    // For lite bevegelse til å estimere — anta sidelengs-pan
    return { x: 1, y: 0, z: 0, magnitude: 0 }
  }
  // Kamera-retning er motsatt av flow-retning, normalisert til enhet.
  // I kamerakoordinater: x = høyre, y = ned, z = fremover.
  // Pixel-bevegelse i x = -translasjon i x; samme for y.
  return {
    x: -avgDx / mag,
    y: -avgDy / mag,
    z: 0,
    magnitude: mag,
  }
}
