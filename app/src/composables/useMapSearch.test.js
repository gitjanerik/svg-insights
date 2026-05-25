import { describe, it, expect } from 'vitest'
import { filterIndex, foldName } from './useMapSearch.js'

// Pure-funksjons-tester. buildSearchIndex tester vi ikke her — den krever
// reell DOM (jsdom er ikke installert), og vi har hverken @napi-rs eller
// happy-dom i devDeps. DOM-baserte ende-til-ende-scenarier verifiseres
// manuelt i nettleseren.

describe('useMapSearch', () => {
  describe('foldName', () => {
    it('folds Norwegian chars and case', () => {
      expect(foldName('Hestesund')).toBe('hestesund')
      // å decomposes to a + combining ring via NFD og blir 'a', ikke 'aa' —
      // dette er bevisst trade-off (typing 'a' matcher også 'å') og var slik
      // før denne PR-en. ø dekomposeres ikke og blir 'oe' som forventet.
      expect(foldName('Vågen')).toBe('vagen')
      expect(foldName('Tjernet ')).toBe('tjernet')
      expect(foldName('Ærø')).toBe('aeroe')
    })
  })

  describe('filterIndex', () => {
    // Mini-indeks som dekker de viktige tilfellene
    const mockIndex = [
      {
        id: 'a', name: 'Hestesund', folded: 'hestesund', kind: 'omrade',
        label: 'Vann', x: 100, y: 100, categories: ['vann', 'innsjo'], areaM2: 50_000,
      },
      {
        id: 'b', name: 'Innsjø uten navn (~1 ha)', folded: 'innsjoe uten navn (~1 ha)',
        kind: 'vann-omrade', label: 'Vann', x: 200, y: 200,
        categories: ['vann', 'innsjo'], areaM2: 10_000,
      },
      {
        id: 'c', name: 'Tjern uten navn (~500 m²)', folded: 'tjern uten navn (~500 m2)',
        kind: 'vann-omrade', label: 'Vann', x: 300, y: 300,
        categories: ['vann', 'tjern'], areaM2: 500,
      },
      {
        id: 'd', name: 'Bergetoppen', folded: 'bergetoppen', kind: 'peak',
        label: 'Topp', x: 400, y: 400, categories: null, areaM2: null,
      },
      {
        id: 'e', name: 'Trondheimsfjorden', folded: 'trondheimsfjorden', kind: 'omrade',
        label: 'Vann', x: 500, y: 500, categories: null, areaM2: 1_000_000,
      },
    ]

    it('regular name search matches by substring', () => {
      const results = filterIndex(mockIndex, 'berge')
      expect(results.length).toBe(1)
      expect(results[0].name).toBe('Bergetoppen')
    })

    it('returns all freshwater entries when query is "vann"', () => {
      const results = filterIndex(mockIndex, 'vann')
      const names = results.map(r => r.name)
      // Hestesund (kategori vann) + 2 unnavngitte (kategori vann)
      expect(names).toContain('Hestesund')
      expect(names).toContain('Innsjø uten navn (~1 ha)')
      expect(names).toContain('Tjern uten navn (~500 m²)')
      // Bergetoppen er IKKE vann
      expect(names).not.toContain('Bergetoppen')
      // Trondheimsfjorden har ingen vann-kategori (saltvann) og navnet
      // inneholder ikke "vann" — skal IKKE matche.
      expect(names).not.toContain('Trondheimsfjorden')
    })

    it('returns only tjern-tagged entries when query is "tjern"', () => {
      const results = filterIndex(mockIndex, 'tjern')
      const names = results.map(r => r.name)
      expect(names).toContain('Tjern uten navn (~500 m²)')
      expect(names).not.toContain('Hestesund')
      expect(names).not.toContain('Innsjø uten navn (~1 ha)')
    })

    it('returns only innsjo-tagged entries when query is "innsjø"', () => {
      const results = filterIndex(mockIndex, 'innsjø')
      const names = results.map(r => r.name)
      // Hestesund (innsjo-tag) + unnavngitt innsjø (innsjo-tag)
      expect(names).toContain('Hestesund')
      expect(names).toContain('Innsjø uten navn (~1 ha)')
      // Tjern er ikke innsjø
      expect(names).not.toContain('Tjern uten navn (~500 m²)')
    })

    it('partial query "vannet" does NOT trigger category mode', () => {
      // "vannet" er ikke et eksakt kategori-keyword. Vi får tilbake bare
      // entries der "vannet" finnes som substring i navnet. Ingen gjør.
      const results = filterIndex(mockIndex, 'vannet')
      expect(results.length).toBe(0)
    })

    it('returns [] for empty query', () => {
      expect(filterIndex(mockIndex, '')).toEqual([])
      expect(filterIndex(mockIndex, '   ')).toEqual([])
    })

    it('sorts results alphabetically', () => {
      // Query "vann" treffer 3 entries via categories. Sorteringen er
      // ren alfabetisk på navn (norsk collation), ikke etter relevans
      // eller størrelse.
      const results = filterIndex(mockIndex, 'vann')
      const names = results.map(r => r.name)
      expect(names).toEqual(['Hestesund', 'Innsjø uten navn (~1 ha)', 'Tjern uten navn (~500 m²)'])
    })

    it('alphabetical sort works across mixed kinds', () => {
      const mini = [
        { id: '1', name: 'Åse', folded: 'aase', kind: 'stedsnavn', x: 0, y: 0 },
        { id: '2', name: 'Berg', folded: 'berg', kind: 'peak', x: 0, y: 0 },
        { id: '3', name: 'Almenningen', folded: 'almenningen', kind: 'omrade', x: 0, y: 0 },
        // Substring-match på "e" treffer alle tre. Alfabetisk: Almenningen,
        // Berg, Åse (norsk: æøå kommer sist).
      ]
      const results = filterIndex(mini, 'e')
      expect(results.map(r => r.name)).toEqual(['Almenningen', 'Berg', 'Åse'])
    })

    it('folding lets ASCII-only input match diakritisk navn', () => {
      const results = filterIndex(mockIndex, 'trondheimsfjord')
      expect(results.length).toBe(1)
      expect(results[0].name).toBe('Trondheimsfjorden')
    })
  })
})
