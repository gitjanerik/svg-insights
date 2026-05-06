import { describe, it, expect } from 'vitest'
import {
  rotationMatrixFromEuler,
  matMul3,
  transpose3,
  matVec3,
  sampleAtTime,
  buildFramePoses,
  estimateTranslationDirection,
  identityMat3,
} from './motionFusion.js'

describe('rotationMatrixFromEuler', () => {
  it('returnerer identitet for null-rotasjon', () => {
    const R = rotationMatrixFromEuler(0, 0, 0)
    expect(R[0][0]).toBeCloseTo(1, 5)
    expect(R[1][1]).toBeCloseTo(1, 5)
    expect(R[2][2]).toBeCloseTo(1, 5)
    expect(R[0][1]).toBeCloseTo(0, 5)
  })

  it('returnerer ortogonal rotasjonsmatrise', () => {
    const R = rotationMatrixFromEuler(30, 45, 20)
    // R · R^T skal være identitet
    const RT = transpose3(R)
    const I = matMul3(R, RT)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(I[i][j]).toBeCloseTo(i === j ? 1 : 0, 5)
      }
    }
  })
})

describe('matMul3 / matVec3', () => {
  it('multipliserer matriser korrekt', () => {
    const A = [[1, 2, 0], [0, 1, 0], [0, 0, 1]]
    const B = [[1, 0, 0], [0, 1, 3], [0, 0, 1]]
    const C = matMul3(A, B)
    expect(C[0]).toEqual([1, 2, 6])
  })

  it('multipliserer matrise med vektor', () => {
    const M = [[2, 0, 0], [0, 3, 0], [0, 0, 4]]
    const v = matVec3(M, [1, 1, 1])
    expect(v).toEqual([2, 3, 4])
  })
})

describe('sampleAtTime', () => {
  const samples = [
    { t: 0, alpha: 0, beta: 0, gamma: 0 },
    { t: 100, alpha: 10, beta: 5, gamma: 2 },
    { t: 200, alpha: 20, beta: 10, gamma: 4 },
  ]

  it('finner sample før første timestamp', () => {
    expect(sampleAtTime(samples, -10)).toBe(samples[0])
  })

  it('finner sample etter siste timestamp', () => {
    expect(sampleAtTime(samples, 300)).toBe(samples[2])
  })

  it('lerper mellom to samples', () => {
    const s = sampleAtTime(samples, 150)
    expect(s.alpha).toBeCloseTo(15, 4)
    expect(s.beta).toBeCloseTo(7.5, 4)
  })
})

describe('buildFramePoses', () => {
  it('returnerer identitet hvis ingen orientation-samples finnes', () => {
    const frames = [{ timestamp: 0 }, { timestamp: 100 }]
    const poses = buildFramePoses(frames, [])
    expect(poses[0].R).toEqual(identityMat3())
    expect(poses[1].R).toEqual(identityMat3())
  })

  it('returnerer relativ rotasjon, så frame 0 er identitet', () => {
    const frames = [{ timestamp: 0 }, { timestamp: 100 }]
    const motionSamples = [
      { kind: 'orientation', t: 0, alpha: 30, beta: 0, gamma: 0 },
      { kind: 'orientation', t: 100, alpha: 30, beta: 0, gamma: 0 },
    ]
    const poses = buildFramePoses(frames, motionSamples)
    // Frame 0 skal være identitet (referanse)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(poses[0].R[i][j]).toBeCloseTo(i === j ? 1 : 0, 4)
      }
    }
    // Frame 1 har samme orientering, så også identitet
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(poses[1].R[i][j]).toBeCloseTo(i === j ? 1 : 0, 4)
      }
    }
  })
})

describe('estimateTranslationDirection', () => {
  it('returnerer null-magnitude for tomme tracks', () => {
    const t = estimateTranslationDirection([])
    expect(t.magnitude).toBe(0)
  })

  it('inverterer flow-retning til kamerabevegelse', () => {
    // Hvis features beveger seg til høyre i bildet, skal kameraet ha
    // beveget seg til venstre (negativ x).
    const tracks = [
      { points: [{ x: 100, y: 100 }, { x: 120, y: 100 }] },
      { points: [{ x: 50, y: 200 }, { x: 70, y: 200 }] },
    ]
    const t = estimateTranslationDirection(tracks)
    expect(t.x).toBeCloseTo(-1, 4)
    expect(t.y).toBeCloseTo(0, 4)
  })

  it('ignorerer tracks med kun ett punkt', () => {
    const tracks = [
      { points: [{ x: 50, y: 50 }] },
      { points: [{ x: 100, y: 100 }, { x: 100, y: 100 }] },
    ]
    const t = estimateTranslationDirection(tracks)
    expect(t.magnitude).toBe(0)
  })
})
