import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import {
  filterIndex, foldName, elementPosition, dedupeHeightPoints, readPeakLabel,
  buildSearchIndex,
} from './useMapSearch.js'

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

    describe('topp-modus (kartets høyeste punkter)', () => {
      const peak = (id, name, ele) => ({
        id, name, folded: foldName(name), kind: 'peak', label: 'Topp',
        x: ele, y: ele, categories: ['topp'], areaM2: null, ele,
      })
      const idx = [
        peak('p1', 'Tretoppen', 412),
        peak('p2', 'Storetoppen', 980),
        peak('p3', 'Topp', 655),       // navnløs, ingen sted innenfor 50 m
        peak('p4', 'Midttoppen', 720),
        peak('p5', 'Lavtoppen', 210),
        peak('p6', 'Småtoppen', 305),
        { id: 'v1', name: 'Hestesund', folded: 'hestesund', kind: 'omrade',
          label: 'Vann', x: 0, y: 0, categories: ['vann'], areaM2: 9000, ele: null },
      ]

      it('«topp» lister de høyeste, sortert på høyde desc', () => {
        const results = filterIndex(idx, 'topp')
        expect(results.map(r => r.name)).toEqual([
          'Storetoppen', 'Midttoppen', 'Topp', 'Tretoppen', 'Småtoppen', 'Lavtoppen',
        ])
        expect(results.map(r => r.ele)).toEqual([980, 720, 655, 412, 305, 210])
      })

      it('«topper» er synonym for «topp»', () => {
        expect(filterIndex(idx, 'topper').map(r => r.name))
          .toEqual(filterIndex(idx, 'topp').map(r => r.name))
      })

      it('topp-modus tar aldri med ikke-topper (vann)', () => {
        const names = filterIndex(idx, 'topp').map(r => r.name)
        expect(names).not.toContain('Hestesund')
      })

      it('kapper til ti treff selv med flere topper', () => {
        const many = Array.from({ length: 25 }, (_, i) => peak(`m${i}`, `Topp ${i}`, 100 + i))
        expect(filterIndex(many, 'topp').length).toBe(10)
        // Høyeste først (ele 124 ned til 115)
        expect(filterIndex(many, 'topp')[0].ele).toBe(124)
      })

      it('partial «top» trigger ikke topp-modus (vanlig substring-søk)', () => {
        // «top» er ikke et eksakt nøkkelord → substring-søk. Treffer navn som
        // inneholder «top» (alle -toppen), men IKKE den navnløse «Topp» som
        // sorteres på høyde i topp-modus — her er det rein alfabetisk liste.
        const results = filterIndex(idx, 'top')
        expect(results.map(r => r.name)).toContain('Storetoppen')
        // Ikke høyde-sortert:
        expect(results[0].name).toBe('Lavtoppen')   // alfabetisk først
      })

      it('faller tilbake til kontur-høydepunkter når kartet mangler ekte topper', () => {
        const hp = (id, ele) => ({
          id, name: 'Høyde', folded: 'hoeyde', kind: 'hoydepunkt', label: 'Høyde',
          x: ele, y: ele, categories: null, areaM2: null, ele,
        })
        const noPeaks = [
          hp('h1', 200), hp('h2', 240), hp('h3', 180),
          { id: 'v1', name: 'Hestesund', folded: 'hestesund', kind: 'omrade',
            label: 'Vann', x: 0, y: 0, categories: ['vann'], areaM2: 9000, ele: null },
        ]
        const results = filterIndex(noPeaks, 'topp')
        expect(results.map(r => r.ele)).toEqual([240, 200, 180])
      })

      it('ekte topper vinner over kontur-høydepunkter når begge finnes', () => {
        const mixed = [
          ...idx,
          { id: 'h1', name: 'Høyde', folded: 'hoeyde', kind: 'hoydepunkt',
            label: 'Høyde', x: 1, y: 1, categories: null, areaM2: null, ele: 9999 },
        ]
        const results = filterIndex(mixed, 'topp')
        // Kontur-høydepunktet (9999) skal IKKE være med — vi har ekte topper.
        expect(results.every(r => r.kind === 'peak')).toBe(true)
        expect(results.map(r => r.ele)).not.toContain(9999)
      })

      it('hoydepunkt dukker ALDRI opp i vanlig navnesøk', () => {
        const withHp = [
          { id: 'h1', name: 'Høyde', folded: 'hoeyde', kind: 'hoydepunkt',
            label: 'Høyde', x: 1, y: 1, categories: null, areaM2: null, ele: 300 },
        ]
        expect(filterIndex(withHp, 'høyde')).toEqual([])
      })
    })

    describe('dedupeHeightPoints', () => {
      it('kollapser like høyder innen radius til det midterste', () => {
        // Tre punkter med samme høyde langs en linje innen 200 m → ett igjen,
        // det midterste (nærmest sentroiden).
        const pts = [
          { x: 0, y: 0, ele: 200 },
          { x: 100, y: 0, ele: 200 },
          { x: 180, y: 0, ele: 200 },
        ]
        const out = dedupeHeightPoints(pts, 200)
        expect(out.length).toBe(1)
        // Sentroide ≈ x=93 → nærmest er x=100
        expect(out[0].x).toBe(100)
      })

      it('beholder like høyder som ligger lenger fra hverandre enn radius', () => {
        const pts = [
          { x: 0, y: 0, ele: 200 },
          { x: 500, y: 0, ele: 200 },   // > 200 m unna → egen klynge
        ]
        expect(dedupeHeightPoints(pts, 200).length).toBe(2)
      })

      it('ulike høyder er aldri samme klynge selv om de er nære', () => {
        const pts = [
          { x: 0, y: 0, ele: 200 },
          { x: 10, y: 0, ele: 220 },
        ]
        expect(dedupeHeightPoints(pts, 200).length).toBe(2)
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

// Duck-typede element-stubs for readPeakLabel (ingen jsdom nødvendig —
// funksjonen bruker kun getAttribute/textContent/childNodes/querySelector).
function peakTextStub({ label = 'peak', nameFull = null, textNodes = [], inlineEle = null }) {
  const inline = inlineEle != null ? { textContent: String(inlineEle) } : null
  const children = textNodes.map((s) => ({ nodeType: 3, textContent: s }))
  if (inline) children.push({ nodeType: 1, textContent: inline.textContent })
  return {
    getAttribute: (k) => (k === 'data-label' ? label : k === 'data-name-full' ? nameFull : null),
    textContent: textNodes.join('') + (inline ? inline.textContent : ''),
    childNodes: children,
    querySelector: (sel) => (sel === '[data-label="peak-ele"]' ? inline : null),
  }
}

describe('readPeakLabel', () => {
  it('v12.0.7-format: navn + inline <tspan data-label="peak-ele"> — navnet leses uten tallet', () => {
    const t = peakTextStub({ textNodes: ['Slottsberget'], inlineEle: 293 })
    // textContent konkatenerer («Slottsberget293») — bug-scenarioet fra felttest.
    expect(t.textContent).toBe('Slottsberget293')
    expect(readPeakLabel(t)).toEqual({ name: 'Slottsberget', ele: 293 })
  })
  it('gammelt format: søsken-<text data-label="peak-ele"> gir høyde', () => {
    const t = peakTextStub({ label: 'peak-ele', textNodes: ['604'] })
    expect(readPeakLabel(t)).toEqual({ ele: 604 })
  })
  it('gammelt format: peak-tekst uten tspan gir bare navn', () => {
    const t = peakTextStub({ textNodes: ['Stubdalskampen'] })
    expect(readPeakLabel(t)).toEqual({ name: 'Stubdalskampen' })
  })
  it('navnløs topp: numerisk peak-label tolkes som høyde', () => {
    const t = peakTextStub({ textNodes: ['540'] })
    expect(readPeakLabel(t)).toEqual({ ele: 540 })
  })
  it('data-name-full vinner over tekst-nodene (flerspråklige navn)', () => {
    const t = peakTextStub({ nameFull: 'Ráisduottarháldi - Raisduoddarhaldde', textNodes: ['Ráisduottarháldi'], inlineEle: 1361 })
    expect(readPeakLabel(t)).toEqual({ name: 'Ráisduottarháldi - Raisduoddarhaldde', ele: 1361 })
  })
  it('høyde-forurenset data-name-full («Vardåsen349», ≤ v12.1.28) strippes', () => {
    const t = peakTextStub({ nameFull: 'Vardåsen349', textNodes: ['Vardåsen'], inlineEle: 349 })
    expect(readPeakLabel(t)).toEqual({ name: 'Vardåsen', ele: 349 })
  })
})

// Headless ende-til-ende av buildSearchIndex via linkedom (samme DOM-motor som
// MCP-serverens headless.js). Sikrer at «vann»/«topp»-spesialsøkene virker uten
// nettleser — og at getBBox-fallbacken (linkedom har ingen getBBox) gir
// navngitte polygoner ekte koordinat i stedet for (0,0). tagName er UPPERCASE i
// linkedom, så dette fanger også case-følsomme tagName-sammenligninger.
describe('buildSearchIndex (headless via linkedom)', () => {
  // Koordinater i meter (SVG-units). Firkantene er store nok til å passere
  // MIN_LAKE_AREA_M2 (300 m²).
  const svgMarkup = `
    <svg viewBox="0 0 1000 1000">
      <g data-iso="301">
        <path d="M0,0 L60,0 L60,60 L0,60 Z M100,100 L130,100 L130,130 L100,130 Z"/>
        <path data-name="Bjørnsjøen" d="M300,300 L360,300 L360,360 L300,360 Z"/>
      </g>
      <g data-iso="302">
        <path d="M200,200 L250,200 L250,250 L200,250 Z"/>
      </g>
      <g transform="translate(500,500)">
        <text data-label="peak" x="0" y="0">Stortoppen<tspan data-label="peak-ele">980</tspan></text>
      </g>
      <g transform="translate(600,600)">
        <text data-label="peak" x="0" y="0">Lilletoppen<tspan data-label="peak-ele">320</tspan></text>
      </g>
    </svg>`

  const buildIndex = () => {
    const { document } = parseHTML(`<html><body>${svgMarkup}</body></html>`)
    return buildSearchIndex(document.querySelector('svg'))
  }

  it('«topp» rangerer topper på moh desc (label-tekst, uten getBBox)', () => {
    const results = filterIndex(buildIndex(), 'topp')
    expect(results.map(r => r.name)).toEqual(['Stortoppen', 'Lilletoppen'])
    expect(results.map(r => r.ele)).toEqual([980, 320])
  })

  it('«vann» lister navnløse innsjøer sortert på areal + den navngitte', () => {
    const results = filterIndex(buildIndex(), 'vann')
    const names = results.map(r => r.name)
    expect(names).toContain('Bjørnsjøen')
    // 3 navnløse: 301 (3600 m²), 302 (2500 m²), 301 (900 m²)
    const unnamed = results.filter(r => r.kind === 'vann-omrade')
    expect(unnamed.length).toBe(3)
    // Sortert på areal desc innenfor den navnløse gruppa
    expect(unnamed.map(r => Math.round(r.areaM2))).toEqual([3600, 2500, 900])
  })

  it('getBBox-fallback gir navngitt polygon ekte koordinat (ikke 0,0)', () => {
    const bjorn = buildIndex().find(r => r.name === 'Bjørnsjøen')
    expect(bjorn).toBeTruthy()
    // Union-bbox-senter av firkanten 300..360 = (330, 330)
    expect(bjorn.x).toBeCloseTo(330, 3)
    expect(bjorn.y).toBeCloseTo(330, 3)
    // Og den fikk vann-kategori via data-iso="301"-forelderen (case-insensitiv
    // tagName-sjekk headless).
    expect(bjorn.categories).toContain('vann')
  })
})
