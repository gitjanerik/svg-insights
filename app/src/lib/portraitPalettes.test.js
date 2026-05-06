import { describe, it, expect } from 'vitest'
import { PALETTES, pickRandomPalette, defaultPalette } from './portraitPalettes.js'

describe('PALETTES', () => {
  it('har minst 5 paletter', () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(5)
  })

  it('hver palett har alle påkrevde farger', () => {
    const required = ['name', 'skin', 'hair', 'beard', 'eyeWhite', 'pupil', 'mouth', 'glasses', 'outline', 'bg']
    for (const p of PALETTES) {
      for (const key of required) {
        expect(p[key]).toBeDefined()
        expect(p[key]).not.toBe('')
      }
    }
  })

  it('hver palett har et unikt navn', () => {
    const names = PALETTES.map(p => p.name)
    const unique = new Set(names)
    expect(unique.size).toBe(PALETTES.length)
  })
})

describe('defaultPalette', () => {
  it('returnerer Klassisk-paletten', () => {
    expect(defaultPalette().name).toBe('Klassisk')
    expect(defaultPalette().skin).toBe('#FED90F') // Simpsons-gul
  })
})

describe('pickRandomPalette', () => {
  it('returnerer en palett fra listen', () => {
    const p = pickRandomPalette()
    expect(PALETTES.find(x => x.name === p.name)).toBeDefined()
  })

  it('ekskluderer nåværende palett-navn når oppgitt', () => {
    // Kjør 50 ganger — sannsynligheten for å aldri velge bort den er ekstremt lav
    for (let i = 0; i < 50; i++) {
      const p = pickRandomPalette('Klassisk')
      expect(p.name).not.toBe('Klassisk')
    }
  })
})
