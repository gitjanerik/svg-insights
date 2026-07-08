import { describe, it, expect } from 'vitest'
import { buildTripReportSvg, buildTripReportMarkdown, extractMapInner } from './tripReport.js'

describe('extractMapInner', () => {
  it('trekker ut viewBox og indre innhold', () => {
    const { viewBox, inner } = extractMapInner('<svg class="isom-map" viewBox="0 0 500 400"><g>x</g></svg>')
    expect(viewBox).toBe('0 0 500 400')
    expect(inner).toBe('<g>x</g>')
  })
  it('tåler ugyldig input', () => {
    expect(extractMapInner(null).viewBox).toBe('0 0 100 100')
  })
})

describe('buildTripReportSvg', () => {
  const base = {
    title: 'Bondivann → Vardåsen',
    summary: { distanceM: 2906, ascentM: 283, timeMin: 73, viaNavn: ['Wentzelhytta'] },
    mapSvg: '<svg viewBox="0 0 5000 5000"><g data-layer="stiforslag"/></svg>',
    profile: { samples: [{ distM: 0, elev: 100 }, { distM: 1000, elev: 250 }, { distM: 2000, elev: 348 }], minElev: 100, maxElev: 348, totalDistM: 2000 },
    enrichment: {
      kulturminner: [{ navn: 'Gravrøys', vernetype: 'Automatisk fredet', langsM: 800, avstandM: 40 }],
      reservater: [{ navn: 'Oppsjømyrene', verneform: 'Naturreservat', arealKm2: 1.2 }],
      arter: { observasjoner: 120, arter: 45, arterCappet: false, rodliste: { antall: 3, perKategori: { CR: 0, EN: 1, VU: 1, NT: 1 }, arter: [{ kategori: 'EN', vitenskapelig: 'Sci', norsk: 'Hønsehauk', gruppe: 'Fugler' }] } },
      kilder: { kulturminne: true, vern: true, arter: true },
    },
    cues: [{ text: 'Etter 1,2 km: ta til venstre ved Abbortjern' }],
  }

  it('produserer en SVG med tittel, paneler og funn', () => {
    const svg = buildTripReportSvg(base)
    expect(svg.startsWith('<?xml')).toBe(true)
    expect(svg).toContain('Bondivann → Vardåsen') // → escapes ikke (kun &,<,>)
    expect(svg).toContain('Høydeprofil')
    expect(svg).toContain('Gravrøys')
    expect(svg).toContain('Oppsjømyrene')
    expect(svg).toContain('Hønsehauk')
    expect(svg).toContain('ta til venstre ved Abbortjern')
    // Nestet kart med kartets viewBox + isom-map-klasse.
    expect(svg).toContain('viewBox="0 0 5000 5000"')
    expect(svg).toContain('class="isom-map"')
    // Gyldig høyde satt.
    expect(svg).toMatch(/height="\d+"/)
  })

  it('viser «Kilde utilgjengelig» når en kilde er nede', () => {
    const svg = buildTripReportSvg({ ...base, enrichment: { ...base.enrichment, kilder: { kulturminne: false, vern: false, arter: false } } })
    expect(svg).toContain('Kilde utilgjengelig')
  })

  it('tåler manglende profil', () => {
    const svg = buildTripReportSvg({ ...base, profile: null })
    expect(svg).toContain('Ingen høydeprofil')
  })
})

describe('buildTripReportMarkdown', () => {
  const base = {
    title: 'Bondivann → Vardåsen',
    summary: { distanceM: 2906, ascentM: 283, timeMin: 73, viaNavn: ['Wentzelhytta'] },
    enrichment: {
      kulturminner: [{ navn: 'Gravrøys', vernetype: 'Automatisk fredet', langsM: 800, avstandM: 40 }],
      reservater: [{ navn: 'Oppsjømyrene', verneform: 'Naturreservat', arealKm2: 1.2 }],
      arter: { observasjoner: 120, arter: 45, arterCappet: false, rodliste: { antall: 3, perKategori: { CR: 0, EN: 1, VU: 1, NT: 1 }, arter: [{ kategori: 'EN', vitenskapelig: 'Sci', norsk: 'Hønsehauk', gruppe: 'Fugler' }] } },
      kilder: { kulturminne: true, vern: true, arter: true },
    },
    cues: [{ text: 'Etter 1,2 km: ta til venstre ved Abbortjern' }],
  }

  it('lager markdown med overskrifter, funn og nummerert veibeskrivelse', () => {
    const md = buildTripReportMarkdown(base)
    expect(md).toContain('# Bondivann → Vardåsen')
    expect(md).toContain('**2,9 km · ↑283 m · ~73 min · via Wentzelhytta**')
    expect(md).toContain('## Fredede kulturminner (1)')
    expect(md).toContain('- Gravrøys — Automatisk fredet')
    expect(md).toContain('## Verneområder')
    expect(md).toContain('- Oppsjømyrene — Naturreservat, 1.2 km²')
    expect(md).toContain('**Rødlistet: 3**')
    expect(md).toContain('- Hønsehauk (EN, Fugler)')
    expect(md).toContain('1. Etter 1,2 km: ta til venstre ved Abbortjern')
  })

  it('viser dvale-tekst når kilder er nede', () => {
    const md = buildTripReportMarkdown({ ...base, enrichment: { kilder: { kulturminne: false, vern: false, arter: false } } })
    expect(md).toContain('_Kilde utilgjengelig (Riksantikvaren)_')
    expect(md).toContain('_Kilde utilgjengelig (Naturbase)_')
    expect(md).toContain('_Kilde utilgjengelig (GBIF)_')
  })
})
