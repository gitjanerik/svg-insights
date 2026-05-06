import { describe, it, expect } from 'vitest'
import {
  buildSweepPose,
  triangulateLandmarks,
  deriveProportions,
  proportionsFrom2D,
  medianLandmarks,
} from './landmarkTriangulation.js'
import { defaultIntrinsics, projectionMatrix } from './triangulation.js'

describe('buildSweepPose', () => {
  it('returnerer identitet-rotasjon ved 0°', () => {
    const pose = buildSweepPose(0)
    expect(pose.R[0][0]).toBeCloseTo(1, 5)
    expect(pose.R[1][1]).toBe(1)
    expect(pose.R[2][2]).toBeCloseTo(1, 5)
    expect(pose.R[0][2]).toBeCloseTo(0, 5)
    expect(pose.t).toEqual([0, 0, 1])
  })

  it('roterer rundt Y-aksen ved gitt vinkel', () => {
    const pose = buildSweepPose(Math.PI / 6) // 30°
    expect(pose.R[0][0]).toBeCloseTo(Math.cos(Math.PI / 6), 5)
    expect(pose.R[1][1]).toBe(1) // Y-akse uendret
  })
})

describe('triangulateLandmarks', () => {
  it('rekonstruerer kjente 3D-landemerker fra to syntetiske observasjoner', () => {
    const w = 320, h = 240
    const sweepAngle = Math.PI / 6 // 30°

    // Sannhets-3D-landemerker rundt origo
    const truth = {
      leftEye: { X: -0.3, Y: -0.5, Z: 0 },
      rightEye: { X: 0.3, Y: -0.5, Z: 0 },
      nose: { X: 0, Y: 0, Z: -0.2 }, // litt utstikkende
      mouth: { X: 0, Y: 0.3, Z: 0 },
      forehead: { X: 0, Y: -1.2, Z: 0 },
      chin: { X: 0, Y: 1.0, Z: 0 },
    }

    // Projiser truth via begge sweep-poses
    const halfAngle = sweepAngle / 2
    const K = defaultIntrinsics(w, h)
    const P0 = projectionMatrix(K, buildSweepPose(-halfAngle).R, buildSweepPose(-halfAngle).t)
    const P1 = projectionMatrix(K, buildSweepPose(+halfAngle).R, buildSweepPose(+halfAngle).t)

    function project(P, X) {
      const wEx = P[2][0] * X.X + P[2][1] * X.Y + P[2][2] * X.Z + P[2][3]
      return {
        x: (P[0][0] * X.X + P[0][1] * X.Y + P[0][2] * X.Z + P[0][3]) / wEx,
        y: (P[1][0] * X.X + P[1][1] * X.Y + P[1][2] * X.Z + P[1][3]) / wEx,
      }
    }

    const obs0 = {}, obs1 = {}
    for (const name of Object.keys(truth)) {
      obs0[name] = project(P0, truth[name])
      obs1[name] = project(P1, truth[name])
    }

    const recovered = triangulateLandmarks(obs0, obs1, sweepAngle, w, h)
    expect(Object.keys(recovered).length).toBe(6)
    for (const name of Object.keys(truth)) {
      expect(recovered[name].X).toBeCloseTo(truth[name].X, 1)
      expect(recovered[name].Y).toBeCloseTo(truth[name].Y, 1)
      expect(recovered[name].Z).toBeCloseTo(truth[name].Z, 1)
    }
  })

  it('hopper over manglende landemerker', () => {
    const obs0 = { leftEye: { x: 100, y: 100 } }
    const obs1 = { rightEye: { x: 200, y: 100 } } // forskjellig liste
    const result = triangulateLandmarks(obs0, obs1, Math.PI / 6, 320, 240)
    expect(Object.keys(result).length).toBe(0)
  })
})

describe('deriveProportions', () => {
  it('returnerer null uten øyne', () => {
    expect(deriveProportions({})).toBeNull()
  })

  it('beregner skala-invariante proporsjoner', () => {
    const landmarks = {
      leftEye: { X: -0.3, Y: -0.5, Z: 0 },
      rightEye: { X: 0.3, Y: -0.5, Z: 0 },
      nose: { X: 0, Y: 0, Z: -0.2 },
      mouth: { X: 0, Y: 0.3, Z: 0 },
      forehead: { X: 0, Y: -1.2, Z: 0 },
      chin: { X: 0, Y: 1.0, Z: 0 },
    }
    const props = deriveProportions(landmarks)
    expect(props.eyeDistance).toBeCloseTo(0.6, 5) // |0.3 - (-0.3)|
    // noseLength: nese y = 0, øye-senter y = -0.5, normalisert med eyeDistance=0.6
    expect(props.noseLength).toBeCloseTo(0.5 / 0.6, 4)
    // noseProjection: nese Z = -0.2, øye-senter Z = 0, normalisert
    expect(props.noseProjection).toBeCloseTo(-0.2 / 0.6, 4)
  })

  it('skala-invariant: dobbelt så stort ansikt gir samme proporsjoner', () => {
    const small = {
      leftEye: { X: -0.3, Y: -0.5, Z: 0 },
      rightEye: { X: 0.3, Y: -0.5, Z: 0 },
      nose: { X: 0, Y: 0, Z: -0.2 },
    }
    const big = {
      leftEye: { X: -0.6, Y: -1.0, Z: 0 },
      rightEye: { X: 0.6, Y: -1.0, Z: 0 },
      nose: { X: 0, Y: 0, Z: -0.4 },
    }
    const ps = deriveProportions(small)
    const pb = deriveProportions(big)
    expect(ps.noseLength).toBeCloseTo(pb.noseLength, 5)
    expect(ps.noseProjection).toBeCloseTo(pb.noseProjection, 5)
    expect(pb.eyeDistance).toBeCloseTo(2 * ps.eyeDistance, 5)
  })
})

describe('proportionsFrom2D', () => {
  it('returnerer null uten øyne', () => {
    expect(proportionsFrom2D({})).toBeNull()
    expect(proportionsFrom2D({ leftEye: { x: 100, y: 100 } })).toBeNull()
  })

  it('returnerer null når øynene er for nær hverandre', () => {
    const lm = {
      leftEye: { x: 100, y: 100 },
      rightEye: { x: 102, y: 100 },
      nose: { x: 101, y: 110 },
    }
    expect(proportionsFrom2D(lm)).toBeNull()
  })

  it('beregner skala-invariante proporsjoner fra 2D-piksler', () => {
    const lm = {
      leftEye: { x: 100, y: 100 },
      rightEye: { x: 140, y: 100 },
      nose: { x: 120, y: 130 },
      mouth: { x: 120, y: 150 },
      forehead: { x: 120, y: 60 },
      chin: { x: 120, y: 170 },
    }
    const props = proportionsFrom2D(lm)
    expect(props).not.toBeNull()
    // Landemerkene normaliseres mot eyeDistance internt, så eyeDistance i
    // output-proporsjonene er alltid 1.0 (vi har ikke piksel-til-meter-mapping)
    expect(props.eyeDistance).toBeCloseTo(1, 5)
    // noseLength: nese er 30 piksel under øye-senter, normalisert med eyeDist=40
    expect(props.noseLength).toBeCloseTo(0.75, 4)
  })
})

describe('medianLandmarks', () => {
  it('returnerer null for tom input', () => {
    expect(medianLandmarks([])).toBeNull()
    expect(medianLandmarks([null, null])).toBeNull()
  })

  it('beregner median pr koordinat over flere frames', () => {
    const frames = [
      {
        leftEye: { x: 100, y: 100 },
        rightEye: { x: 140, y: 100 },
        nose: { x: 120, y: 130 },
      },
      {
        leftEye: { x: 102, y: 101 },
        rightEye: { x: 142, y: 99 },
        nose: { x: 121, y: 131 },
      },
      {
        leftEye: { x: 101, y: 99 },
        rightEye: { x: 141, y: 101 },
        nose: { x: 122, y: 132 },
      },
    ]
    const med = medianLandmarks(frames)
    expect(med.leftEye.x).toBe(101) // median av [100, 102, 101]
    expect(med.leftEye.y).toBe(100)
    expect(med.nose.x).toBe(121)
  })

  it('returnerer null hvis øyne mangler i alle frames', () => {
    const frames = [
      { nose: { x: 120, y: 130 } },
      { nose: { x: 121, y: 131 } },
    ]
    expect(medianLandmarks(frames)).toBeNull()
  })

  it('hopper over null-frames', () => {
    const frames = [
      null,
      {
        leftEye: { x: 100, y: 100 },
        rightEye: { x: 140, y: 100 },
      },
      null,
    ]
    const med = medianLandmarks(frames)
    expect(med).not.toBeNull()
    expect(med.leftEye.x).toBe(100)
  })
})
