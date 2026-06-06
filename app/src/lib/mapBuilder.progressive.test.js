import { describe, it, expect } from 'vitest'
import { buildSvg } from './mapBuilder.js'
import { syntheticDEM } from './dem.js'

// Bratt syntetisk DEM (Gaussian-topp) → slope > 45° → stupkanter detekteres.
// ~600×600 m @ 10 m oppløsning.
function steepDem() {
  return syntheticDEM(600, 600, { originX: 0, originY: 0, pixelWidth: 10, pixelHeight: 10 },
    [{ x: 300, y: 300, h: 400, sigma: 40 }], 0)
}
// ~600 m bbox rundt lat 59 (eksakt justering uvesentlig for lag-tilstedeværelse).
const bbox = { south: 59, north: 59.0054, west: 10, east: 10.0105 }

describe('buildSvg progressiv skip-mekanikk', () => {
  it('hopper over stupkant-beregning når includeCliffs=false (fase-1)', () => {
    const dem = steepDem()
    const full = buildSvg([], bbox, { dem, contourIntervalM: 20, includeCliffs: true })
    const fast = buildSvg([], bbox, { dem, contourIntervalM: 20, includeCliffs: false })

    // Deterministisk bevis på at den dyre beregningen ble gated bort:
    expect(typeof full.timings.cliffs).toBe('number')   // kjørte
    expect(fast.timings.cliffs).toBeUndefined()          // hoppet over
  })

  it('måler alltid kontur-bygging (timings.contours)', () => {
    const dem = steepDem()
    const { timings } = buildSvg([], bbox, { dem, contourIntervalM: 20 })
    expect(typeof timings.contours).toBe('number')
    expect(timings.contours).toBeGreaterThanOrEqual(0)
  })

  it('includeBuildingMass=false bygger uten feil og uten bymasse-beregning', () => {
    const dem = steepDem()
    const { svg, timings } = buildSvg([], bbox, { dem, contourIntervalM: 20, includeBuildingMass: false })
    expect(typeof svg).toBe('string')
    expect(timings.buildingMass).toBeUndefined()
  })
})
