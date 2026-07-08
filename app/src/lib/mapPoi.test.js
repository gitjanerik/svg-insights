import { describe, it, expect } from 'vitest'
import { poiType, parseLen, sumTranslate, mmToUnitFromSvg, dedupePoi, filterPoi } from './mapPoi.js'

describe('poiType', () => {
  it('mapper kjente data-label til type', () => {
    expect(poiType('peak')).toBe('topp')
    expect(poiType('hytte-navn')).toBe('hytte')
    expect(poiType('vann-navn')).toBe('vann')
    expect(poiType('kontur-tall')).toBeNull()
  })
})

describe('parseLen', () => {
  it('tolker enheter og mm', () => {
    expect(parseLen('3775.7')).toBeCloseTo(3775.7)
    expect(parseLen('2mm', 10)).toBeCloseTo(20)
    expect(parseLen('-0.4mm', 10)).toBeCloseTo(-4)
    expect(parseLen(null)).toBe(0)
  })
})

describe('sumTranslate', () => {
  it('summerer translate(x,y) i en transform-kjede', () => {
    expect(sumTranslate('translate(100,200) rotate(30) translate(5 -3)')).toEqual({ dx: 105, dy: 197 })
    expect(sumTranslate(null)).toEqual({ dx: 0, dy: 0 })
    expect(sumTranslate('translate(50)')).toEqual({ dx: 50, dy: 0 })
  })
})

describe('mmToUnitFromSvg', () => {
  it('utleder faktor fra viewBox + width-mm', () => {
    expect(mmToUnitFromSvg('<svg viewBox="0 0 5131.9 5123" width="513.2mm">')).toBeCloseTo(10, 1)
  })
  it('faller til 10 ved manglende attributter', () => {
    expect(mmToUnitFromSvg('<svg>')).toBe(10)
  })
})

describe('dedupePoi', () => {
  it('fjerner LOD-dubletter (samme type+navn)', () => {
    const out = dedupePoi([
      { type: 'sted', navn: 'Jutemyr', x: 1, y: 1 },
      { type: 'sted', navn: 'jutemyr', x: 2, y: 2 },
      { type: 'topp', navn: 'Vardåsen', x: 3, y: 3 },
      { type: 'sted', navn: '', x: 4, y: 4 },
    ])
    expect(out).toHaveLength(2)
    expect(out.map(p => p.navn)).toEqual(['Jutemyr', 'Vardåsen'])
  })
})

describe('filterPoi', () => {
  const items = [
    { type: 'topp', navn: 'Vardåsen' },
    { type: 'hytte', navn: 'Wentzelhytta' },
    { type: 'vann', navn: 'Bondivannet' },
  ]
  it('filtrerer på typer', () => {
    expect(filterPoi(items, { typer: ['topp', 'vann'] }).map(p => p.navn)).toEqual(['Vardåsen', 'Bondivannet'])
  })
  it('filtrerer på fritekst-søk', () => {
    expect(filterPoi(items, { sok: 'hytt' }).map(p => p.navn)).toEqual(['Wentzelhytta'])
  })
})
