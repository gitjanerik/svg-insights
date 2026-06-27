import { describe, it, expect } from 'vitest'
import { norwegianName, hasMultilangName } from './placeName.js'

describe('norwegianName', () => {
  it('henter første ledd fra norsk - samisk - finsk', () => {
    expect(norwegianName('Bugøynes - Buođggák - Pykeijä')).toBe('Bugøynes')
  })

  it('henter første ledd fra norsk - samisk', () => {
    expect(norwegianName('Svinøya - Spiidnesuolu')).toBe('Svinøya')
  })

  it('håndterer skråstrek-skilletegn', () => {
    expect(norwegianName('Kåfjord / Gáivuotna / Kaivuono')).toBe('Kåfjord')
  })

  it('håndterer en-dash og em-dash', () => {
    expect(norwegianName('Tana – Deatnu')).toBe('Tana')
    expect(norwegianName('Karasjok — Kárášjohka')).toBe('Karasjok')
  })

  it('lar enspråklige navn være urørt', () => {
    expect(norwegianName('Trondheim')).toBe('Trondheim')
    expect(norwegianName('Vardåsen')).toBe('Vardåsen')
  })

  it('splitter ALDRI ekte bindestreksnavn (ingen mellomrom rundt)', () => {
    expect(norwegianName('Sør-Trøndelag')).toBe('Sør-Trøndelag')
    expect(norwegianName('Nord-Norge')).toBe('Nord-Norge')
  })

  it('trimmer og takler tomme / nullish verdier', () => {
    expect(norwegianName('  Bodø  ')).toBe('Bodø')
    expect(norwegianName('')).toBe('')
    expect(norwegianName(null)).toBe('')
    expect(norwegianName(undefined)).toBe('')
  })

  it('beholder navn der bindestreken ikke er et språk-skille', () => {
    // Bindestrek uten omkransende mellomrom er ikke et skilletegn.
    expect(norwegianName('E-6 rasteplass')).toBe('E-6 rasteplass')
  })
})

describe('hasMultilangName', () => {
  it('er sann for flerspråklige navn', () => {
    expect(hasMultilangName('Bugøynes - Buođggák - Pykeijä')).toBe(true)
    expect(hasMultilangName('Kåfjord / Gáivuotna')).toBe(true)
  })

  it('er usann for enspråklige og bindestreksnavn', () => {
    expect(hasMultilangName('Trondheim')).toBe(false)
    expect(hasMultilangName('Sør-Trøndelag')).toBe(false)
    expect(hasMultilangName('')).toBe(false)
  })
})
