import { describe, it, expect } from 'vitest'
import {
  defaultIntrinsics,
  projectionMatrix,
  triangulatePoint,
  triangulateTracks,
  jacobiEigen4,
} from './triangulation.js'
import { identityMat3 } from './motionFusion.js'

describe('defaultIntrinsics', () => {
  it('beregner sentrert principal point', () => {
    const K = defaultIntrinsics(320, 240)
    expect(K.cx).toBe(160)
    expect(K.cy).toBe(120)
    expect(K.fx).toBe(K.fy)
    expect(K.fx).toBeGreaterThan(0)
  })
})

describe('jacobiEigen4', () => {
  it('finner egenverdier for diagonal matrise', () => {
    const M = [[3, 0, 0, 0], [0, 1, 0, 0], [0, 0, 4, 0], [0, 0, 0, 1.5]]
    const { eigenvalues } = jacobiEigen4(M)
    const sorted = [...eigenvalues].sort((a, b) => a - b)
    expect(sorted[0]).toBeCloseTo(1, 5)
    expect(sorted[3]).toBeCloseTo(4, 5)
  })
})

describe('projectionMatrix', () => {
  it('projiserer origo til principal point når R=I og t=0', () => {
    const K = defaultIntrinsics(320, 240)
    const P = projectionMatrix(K, identityMat3(), [0, 0, 1])
    // Punkt (0, 0, 1) skal projiseres til (cx, cy)
    const X = [0, 0, 1, 1]
    const x = P[0][0] * X[0] + P[0][1] * X[1] + P[0][2] * X[2] + P[0][3] * X[3]
    const y = P[1][0] * X[0] + P[1][1] * X[1] + P[1][2] * X[2] + P[1][3] * X[3]
    const w = P[2][0] * X[0] + P[2][1] * X[1] + P[2][2] * X[2] + P[2][3] * X[3]
    expect(x / w).toBeCloseTo(160, 4)
    expect(y / w).toBeCloseTo(120, 4)
  })
})

describe('triangulatePoint', () => {
  it('rekonstruerer kjent 3D-punkt fra to syntetiske kameraposer', () => {
    const K = defaultIntrinsics(320, 240)
    const truePoint = { X: 0.2, Y: 0.1, Z: 5 } // 5m fremover, litt sideveis

    // Pose 1: i origo, ser fremover
    const R1 = identityMat3()
    const t1 = [0, 0, 0]

    // Pose 2: 0.5m til høyre (kameraet flyttes; verdens-koordinatene endres ikke,
    // men kameraets perspektiv på punktet endres). I kamera-rammen betyr det at
    // punktet "flyttes" -0.5 i x.
    const R2 = identityMat3()
    const t2 = [-0.5, 0, 0]

    const P1 = projectionMatrix(K, R1, t1)
    const P2 = projectionMatrix(K, R2, t2)

    // Beregn projeksjoner
    function project(P, X) {
      const w = P[2][0] * X.X + P[2][1] * X.Y + P[2][2] * X.Z + P[2][3]
      return {
        u: (P[0][0] * X.X + P[0][1] * X.Y + P[0][2] * X.Z + P[0][3]) / w,
        v: (P[1][0] * X.X + P[1][1] * X.Y + P[1][2] * X.Z + P[1][3]) / w,
      }
    }

    const p1 = project(P1, truePoint)
    const p2 = project(P2, truePoint)

    const recovered = triangulatePoint([
      { P: P1, u: p1.u, v: p1.v },
      { P: P2, u: p2.u, v: p2.v },
    ])

    expect(recovered).not.toBeNull()
    expect(recovered.X).toBeCloseTo(truePoint.X, 2)
    expect(recovered.Y).toBeCloseTo(truePoint.Y, 2)
    expect(recovered.Z).toBeCloseTo(truePoint.Z, 2)
  })

  it('returnerer null for under to observasjoner', () => {
    const K = defaultIntrinsics(320, 240)
    const P = projectionMatrix(K, identityMat3(), [0, 0, 0])
    expect(triangulatePoint([{ P, u: 100, v: 100 }])).toBeNull()
    expect(triangulatePoint([])).toBeNull()
  })
})

describe('triangulateTracks', () => {
  it('rekonstruerer 3D-punkter fra tracks med tilstrekkelig observasjoner', () => {
    const K = defaultIntrinsics(320, 240)
    const truePoint = { X: 0.3, Y: 0.0, Z: 4 }

    // 5 frames hvor kameraet beveger seg gradvis sideveis
    const poses = []
    for (let i = 0; i < 5; i++) {
      poses.push({
        R: identityMat3(),
        t: [-i * 0.1, 0, 0], // 0.1m sideveis pr frame
      })
    }
    const projMatrices = poses.map(p => projectionMatrix(K, p.R, p.t))

    function project(P, X) {
      const w = P[2][0] * X.X + P[2][1] * X.Y + P[2][2] * X.Z + P[2][3]
      return {
        u: (P[0][0] * X.X + P[0][1] * X.Y + P[0][2] * X.Z + P[0][3]) / w,
        v: (P[1][0] * X.X + P[1][1] * X.Y + P[1][2] * X.Z + P[1][3]) / w,
      }
    }

    const track = {
      id: 0,
      points: poses.map((_, i) => {
        const p = project(projMatrices[i], truePoint)
        return { frame: i, x: p.u, y: p.v }
      }),
    }

    const result = triangulateTracks([track], poses, K, { minObservations: 3 })
    expect(result.length).toBe(1)
    expect(result[0].point.X).toBeCloseTo(truePoint.X, 1)
    expect(result[0].point.Z).toBeCloseTo(truePoint.Z, 1)
  })

  it('hopper over tracks med for få observasjoner', () => {
    const K = defaultIntrinsics(320, 240)
    const poses = [
      { R: identityMat3(), t: [0, 0, 0] },
      { R: identityMat3(), t: [-0.1, 0, 0] },
    ]
    const tracks = [{ id: 0, points: [{ frame: 0, x: 160, y: 120 }] }]
    const result = triangulateTracks(tracks, poses, K, { minObservations: 4 })
    expect(result.length).toBe(0)
  })
})
