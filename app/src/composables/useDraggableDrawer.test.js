import { describe, it, expect } from 'vitest'
import { pickSnapTarget } from './useDraggableDrawer.js'

// Snaps i translateY-rom: -300 (maksimert/høyest), 0 (utvidet), 200 (minimert).
const SNAPS = [-300, 0, 200]

describe('pickSnapTarget', () => {
  it('blir på start-snap når draget er under 25 % av gapet', () => {
    // Fra utvidet (0) opp mot maksimert (-300): 25 % = -75. -50 er ikke nok.
    expect(pickSnapTarget(-50, 0, SNAPS, 0.25)).toBe(0)
    // Ned mot minimert (200): 25 % = 50. 40 er ikke nok.
    expect(pickSnapTarget(40, 0, SNAPS, 0.25)).toBe(0)
  })

  it('committer til neste snap ved nøyaktig/over 25 % av gapet', () => {
    expect(pickSnapTarget(-75, 0, SNAPS, 0.25)).toBe(-300)   // opp, akkurat 25 %
    expect(pickSnapTarget(-90, 0, SNAPS, 0.25)).toBe(-300)
    expect(pickSnapTarget(50, 0, SNAPS, 0.25)).toBe(200)     // ned, akkurat 25 %
  })

  it('lander på snap-et når draget går helt dit', () => {
    expect(pickSnapTarget(-300, 0, SNAPS, 0.25)).toBe(-300)
    expect(pickSnapTarget(200, 0, SNAPS, 0.25)).toBe(200)
  })

  it('kan hoppe to snaps ved langt nok drag', () => {
    // Fra minimert (200) opp: forbi utvidet (0) og 25 % videre mot -300 (= -75).
    expect(pickSnapTarget(-80, 200, SNAPS, 0.25)).toBe(-300)
    // Bare forbi utvidet, men ikke 25 % videre → stopper på utvidet.
    expect(pickSnapTarget(-10, 200, SNAPS, 0.25)).toBe(0)
  })

  it('snap tilbake når det ikke finnes snap i dra-retningen', () => {
    // Allerede på høyeste (-300), drar «opp» videre → ingen snap der.
    expect(pickSnapTarget(-400, -300, SNAPS, 0.25)).toBe(-300)
  })

  it('håndterer ingen bevegelse', () => {
    expect(pickSnapTarget(0, 0, SNAPS, 0.25)).toBe(0)
  })
})
