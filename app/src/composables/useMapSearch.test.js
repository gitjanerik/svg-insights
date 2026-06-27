import { describe, it, expect } from 'vitest'
import { filterIndex, foldName, elementPosition } from './useMapSearch.js'

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
        label: 'Vann', x: 100, y: 100, categories: ['vann'], areaM2: 50_000,
      },
      {
        id: 'b', name: 'Innsjø uten navn (~1 ha)', folded: 'innsjoe uten navn (~1 ha)',
        kind: 'vann-omrade', label: 'Vann', x: 200, y: 200,
        categories: ['vann'], areaM2: 10_000,
      },
      {
        id: 'c', name: 'Tjern uten navn (~500 m²)', folded: 'tjern uten navn (~500 m2)',
        kind: 'vann-omrade', label: 'Vann', x: 300, y: 300,
        categories: ['vann'], areaM2: 500,
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

    it('treats "tjern", "innsjø" and "vann" as synonyms — all return same set', () => {
      const vannResults = filterIndex(mockIndex, 'vann').map(r => r.name)
      const tjernResults = filterIndex(mockIndex, 'tjern').map(r => r.name)
      const innsjoResults = filterIndex(mockIndex, 'innsjø').map(r => r.name)
      // Alle tre keyword-formene må returnere identisk resultat
      expect(tjernResults).toEqual(vannResults)
      expect(innsjoResults).toEqual(vannResults)
      // Sjekk at faktisk innholdet er det vi forventer (alle ferskvann)
      expect(vannResults).toContain('Hestesund')
      expect(vannResults).toContain('Innsjø uten navn (~1 ha)')
      expect(vannResults).toContain('Tjern uten navn (~500 m²)')
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

    it('sorts named entries alphabetically, unnamed lakes last by area desc', () => {
      // Query "vann" treffer 3 entries via categories.
      //   - Hestesund (named, kind=omrade) — alfabetisk gruppe, alene
      //   - 2 unavngitte vann-omrader — sorteres etter areal desc til
      //     slutt: innsjø (10 000 m²) før tjern (500 m²)
      const results = filterIndex(mockIndex, 'vann')
      const names = results.map(r => r.name)
      expect(names).toEqual([
        'Hestesund',
        'Innsjø uten navn (~1 ha)',
        'Tjern uten navn (~500 m²)',
      ])
    })

    it('unnamed lakes sort by area desc regardless of alphabetic order', () => {
      // Konstruer eksempel der alfabetisk ville gitt motsatt rekkefølge
      const mini = [
        {
          id: 'small', name: 'Innsjø uten navn (~200 m²)',
          folded: 'innsjoe uten navn (~200 m2)', kind: 'vann-omrade',
          x: 0, y: 0, categories: ['vann'], areaM2: 200,
        },
        {
          id: 'big', name: 'Tjern uten navn (~5 ha)',
          folded: 'tjern uten navn (~5 ha)', kind: 'vann-omrade',
          x: 0, y: 0, categories: ['vann'], areaM2: 50_000,
        },
      ]
      const results = filterIndex(mini, 'vann')
      // Alfabetisk ville 'Innsjø …' kommet før 'Tjern …', men her
      // sorteres unavngitte etter areal desc → Tjern (5 ha) først.
      expect(results.map(r => r.name)).toEqual([
        'Tjern uten navn (~5 ha)',
        'Innsjø uten navn (~200 m²)',
      ])
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

    it('category search is NOT truncated by limit (alphabetical list must not stop halfway)', () => {
      // 100 navngitte tjern, alfabetisk a000…a099, alle med vann-kategori.
      // Med en limit på 60 ville lista stoppet ved a059 og «Landfalltjern»-
      // analogen aldri vist. Kategori-søk skal returnere ALLE.
      const many = Array.from({ length: 100 }, (_, i) => {
        const name = `Tjern ${String(i).padStart(3, '0')}`
        return {
          id: `t${i}`, name, folded: foldName(name), kind: 'omrade',
          label: 'Vann', x: i, y: i, categories: ['vann'], areaM2: 1000,
        }
      })
      const results = filterIndex(many, 'vann', 60)
      expect(results.length).toBe(100)
      expect(results[results.length - 1].name).toBe('Tjern 099')
    })

    it('free-text name search still respects the limit', () => {
      const many = Array.from({ length: 100 }, (_, i) => {
        const name = `Bekk ${String(i).padStart(3, '0')}`
        return {
          id: `b${i}`, name, folded: foldName(name), kind: 'omrade',
          label: 'Vann', x: i, y: i, categories: null, areaM2: null,
        }
      })
      // "bekk" er ikke et kategori-keyword → fritekst, limit gjelder.
      const results = filterIndex(many, 'bekk', 60)
      expect(results.length).toBe(60)
    })

    describe('parkering-kategori (utfartsparkering)', () => {
      // folded settes via foldName så vi ikke hardkoder feil (å → a, ikke aa)
      const entry = (id, name, extra) => ({ id, name, folded: foldName(name), ...extra })
      const idx = [
        entry('p1', 'Utfartsparkering Knivåsen', {
          kind: 'parkering', label: 'Parkering', x: 100, y: 100, categories: ['parkering'], areaM2: null,
        }),
        entry('p2', 'Utfartsparkering Vardåsen', {
          kind: 'parkering', label: 'Parkering', x: 200, y: 200, categories: ['parkering'], areaM2: null,
        }),
        entry('v1', 'Hestesund', {
          kind: 'omrade', label: 'Vann', x: 300, y: 300, categories: ['vann'], areaM2: 9000,
        }),
      ]

      it('"parkering" lister alle utfartsparkeringer, ikke vann', () => {
        const names = filterIndex(idx, 'parkering').map(r => r.name)
        expect(names).toContain('Utfartsparkering Knivåsen')
        expect(names).toContain('Utfartsparkering Vardåsen')
        expect(names).not.toContain('Hestesund')
      })

      it('"utfart" og "utfartsparkering" er synonymer for kategorien', () => {
        const base = filterIndex(idx, 'parkering').map(r => r.name).sort()
        expect(filterIndex(idx, 'utfart').map(r => r.name).sort()).toEqual(base)
        expect(filterIndex(idx, 'utfartsparkering').map(r => r.name).sort()).toEqual(base)
      })

      it('navnesøk på nærmeste-feature ("knivåsen") treffer P-en', () => {
        const results = filterIndex(idx, 'knivåsen')
        expect(results.map(r => r.name)).toEqual(['Utfartsparkering Knivåsen'])
      })
    })
  })

  describe('elementPosition', () => {
    // Stub-elementer (ingen jsdom nødvendig): elementPosition bruker bare
    // tagName, getAttribute, getBBox og parentElement. Stubbene speiler
    // mapBuilder-markup eksakt.
    const svgStub = { nodeType: 1, tagName: 'svg' }
    const layerG = (transform = null) => ({
      nodeType: 1, tagName: 'g',
      getAttribute: (n) => (n === 'transform' ? transform : null),
      parentElement: svgStub,
    })
    const attrs = (map) => (n) => map[n] ?? null

    it('punkt-gruppe med posisjon i EGEN transform (holdeplass/parkering) — «Bondivann»-buggen', () => {
      // <g data-name="Bondivann" transform="translate(2456.1,2234.5)">
      //   <use x="-3mm" …/> → lokal bbox sentrert rundt (0,0)
      const el = {
        nodeType: 1, tagName: 'g',
        getAttribute: attrs({ transform: 'translate(2456.1,2234.5)' }),
        getBBox: () => ({ x: -11.3, y: -11.3, width: 22.6, height: 22.6 }),
        parentElement: layerG(),
      }
      const pos = elementPosition(svgStub, el)
      // Uten egen-translate var dette (0,0) = kartets NV-hjørne.
      expect(pos.x).toBeCloseTo(2456.1, 6)
      expect(pos.y).toBeCloseTo(2234.5, 6)
    })

    it('egen translate kombineres med rotate (upright-counter-rotasjon)', () => {
      const el = {
        nodeType: 1, tagName: 'g',
        getAttribute: attrs({ transform: 'translate(100, 200) rotate(45)' }),
        getBBox: () => ({ x: -5, y: -5, width: 10, height: 10 }),
        parentElement: layerG(),
      }
      const pos = elementPosition(svgStub, el)
      expect(pos.x).toBeCloseTo(100, 6)
      expect(pos.y).toBeCloseTo(200, 6)
    })

    it('path uten egen transform er uendret (bbox-senter + parent-translate)', () => {
      const el = {
        nodeType: 1, tagName: 'path',
        getAttribute: attrs({}),
        getBBox: () => ({ x: 1000, y: 2000, width: 400, height: 200 }),
        parentElement: layerG('translate(10,20)'),
      }
      const pos = elementPosition(svgStub, el)
      expect(pos.x).toBeCloseTo(1000 + 200 + 10, 6)
      expect(pos.y).toBeCloseTo(2000 + 100 + 20, 6)
    })

    it('text bruker x/y-attributter + parent-translate', () => {
      const el = {
        nodeType: 1, tagName: 'text',
        getAttribute: attrs({ x: '2mm', y: '-0.4mm' }),
        parentElement: layerG('translate(500,600)'),
      }
      const pos = elementPosition(svgStub, el)
      expect(pos.x).toBeCloseTo(502, 6)
      expect(pos.y).toBeCloseTo(600 - 0.4, 6)
    })

    it('degenerert bbox (display:none) → null', () => {
      const el = {
        nodeType: 1, tagName: 'path',
        getAttribute: attrs({}),
        getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
        parentElement: layerG(),
      }
      expect(elementPosition(svgStub, el)).toBeNull()
    })
  })
})
