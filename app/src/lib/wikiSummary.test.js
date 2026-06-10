import { describe, it, expect } from 'vitest'
import { titleMatches } from './wikiSummary.js'

describe('titleMatches', () => {
  it('aksepterer eksakt og suffiks-variant', () => {
    expect(titleMatches('Mardalen', 'Mardalen')).toBe(true)
    expect(titleMatches('Mardalen', 'Mardalen (naturreservat)')).toBe(true)
    expect(titleMatches('Mardalen naturreservat', 'Mardalen')).toBe(true)
  })

  it('skiller å fra a (Mardalen ≠ Mårdalen)', () => {
    // Den faktiske bug-en: oppslag «Mardalen» matchet etternavnet «Mårdalen».
    expect(titleMatches('Mardalen', 'Mårdalen')).toBe(false)
  })

  it('skiller ø/æ tilsvarende', () => {
    expect(titleMatches('Brattefjell', 'Brattefjøll')).toBe(false)
    expect(titleMatches('Sletten', 'Slætten')).toBe(false)
  })

  it('avviser helt urelaterte titler', () => {
    expect(titleMatches('Mardalen', 'Oslo')).toBe(false)
  })
})
