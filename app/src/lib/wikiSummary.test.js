import { describe, it, expect } from 'vitest'
import { titleMatches, verneformSuffix, buildWikiTitles } from './wikiSummary.js'

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

describe('verneformSuffix', () => {
  it('kartlegger Naturbase-verneform til Wikipedia-tittelordet', () => {
    expect(verneformSuffix('Biotopvern')).toBe('biotopvernområde')
    expect(verneformSuffix('Biotopvernområde')).toBe('biotopvernområde')
    expect(verneformSuffix('Naturreservat')).toBe('naturreservat')
    expect(verneformSuffix('Nasjonalpark')).toBe('nasjonalpark')
    expect(verneformSuffix('Landskapsvernområde')).toBe('landskapsvernområde')
  })
  it('returnerer null for tom/ukjent verneform', () => {
    expect(verneformSuffix('')).toBeNull()
    expect(verneformSuffix(null)).toBeNull()
    expect(verneformSuffix('Verneområde')).toBeNull()
  })
})

describe('buildWikiTitles', () => {
  it('prøver fullt offisielt navn før bart navn (Storøya-tilfellet)', () => {
    // Den faktiske bug-en: «Storøya» traff øya på Svalbard. Det fulle navnet
    // disambiguerer mot verneområdet.
    expect(buildWikiTitles('Storøya', 'Biotopvern')).toEqual([
      'Storøya biotopvernområde',
      'Storøya',
    ])
  })
  it('dobler ikke verneform når navnet allerede bærer den', () => {
    expect(buildWikiTitles('Nordmarka naturreservat', 'Naturreservat')).toEqual([
      'Nordmarka naturreservat',
    ])
  })
  it('faller tilbake til bart navn når verneform er ukjent', () => {
    expect(buildWikiTitles('Femundsmarka', null)).toEqual(['Femundsmarka'])
  })
})
