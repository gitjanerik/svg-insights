import { describe, it, expect } from 'vitest'
import { useStifinner } from './useStifinner.js'

describe('useStifinner – vann-guard for startpunkt', () => {
  it('startOnWater → ingen rute, ingen start-markør, feilmelding', () => {
    const sti = useStifinner()
    sti.begin({ svgX: 100, svgY: 100 })
    expect(sti.mode.value).toBe('pickingStart')

    sti.confirmStart({ x: 50, y: 50 }, null, { startOnWater: true })

    expect(sti.mode.value).toBe('showing')
    expect(sti.start.value).toBe(null)           // ingen villedende prikk i vann
    expect(sti.routes.value).toEqual([])
    expect(sti.error.value).toMatch(/vann/i)
  })

  it('uten vann-treff og uten kartdata → vanlig feilbane (start beholdes)', () => {
    const sti = useStifinner()
    sti.begin({ svgX: 100, svgY: 100 })

    sti.confirmStart({ x: 50, y: 50 }, null, { startOnWater: false })

    expect(sti.mode.value).toBe('showing')
    expect(sti.start.value).toEqual({ svgX: 50, svgY: 50 })
    expect(sti.error.value).toBe('Mangler kartdata')
  })
})
