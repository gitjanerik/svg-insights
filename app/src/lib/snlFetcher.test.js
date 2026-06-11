import { describe, it, expect } from 'vitest'
import { parseSnlSearch, stripSnlHtml, snlLicenseIsFree } from './snlFetcher.js'
import { titleMatches } from './wikiSummary.js'
import { placeNameMatches } from './wikiPlace.js'

describe('stripSnlHtml', () => {
  it('fjerner <mark>-uthevinger og tags, kollapser mellomrom', () => {
    expect(stripSnlHtml('<p>Glitre er en <mark>innsjø</mark>   i Lier.</p>'))
      .toBe('Glitre er en innsjø i Lier.')
  })
  it('dekoder vanlige entiteter', () => {
    expect(stripSnlHtml('Hav &amp; fjord &#39;test&#39;')).toBe("Hav & fjord 'test'")
  })
  it('tomt/ugyldig → tom streng', () => {
    expect(stripSnlHtml('')).toBe('')
    expect(stripSnlHtml(null)).toBe('')
  })
  it('kutter lang tekst til en kort blurb', () => {
    const long = 'Setning en. ' + 'ord '.repeat(200)
    expect(stripSnlHtml(long).length).toBeLessThanOrEqual(285)
  })
})

describe('snlLicenseIsFree', () => {
  it('true for CC BY-SA / frie lisenser', () => {
    expect(snlLicenseIsFree('CC BY-SA 4.0')).toBe(true)
    expect(snlLicenseIsFree('fri')).toBe(true)
    expect(snlLicenseIsFree({ name: 'Creative Commons' })).toBe(true)
  })
  it('false for begrenset/restriktiv/ukjent', () => {
    expect(snlLicenseIsFree('begrenset')).toBe(false)
    expect(snlLicenseIsFree('All rights reserved')).toBe(false)
    expect(snlLicenseIsFree(null)).toBe(false)
    expect(snlLicenseIsFree('')).toBe(false)
  })
})

describe('parseSnlSearch', () => {
  const snlItem = (over = {}) => ({
    encyclopedia_id: 1,
    headword: 'Glitre',
    title: 'Glitre',
    clarification: 'innsjø i Lier',
    first_two_sentences: 'Glitre er en innsjø i Lier kommune.',
    snippet: '… ligger ved <mark>Glitre</mark> …',
    article_url: 'https://snl.no/Glitre',
    permalink: 'Glitre',
    first_image_url: 'https://snl.no/img/glitre.jpg',
    license: 'CC BY-SA 4.0',
    rank: 100,
    ...over,
  })

  it('velger første aksepterte SNL-treff med ren ingress + kilde', () => {
    const r = parseSnlSearch([snlItem()], 'Glitre', titleMatches)
    expect(r).toMatchObject({
      source: 'snl',
      title: 'Glitre',
      extract: 'Glitre er en innsjø i Lier kommune.',
      url: 'https://snl.no/Glitre',
      thumbnail: 'https://snl.no/img/glitre.jpg',
    })
  })

  it('utelater ingress-tekst når lisensen er begrenset (men beholder lenke)', () => {
    const r = parseSnlSearch([snlItem({ license: 'begrenset' })], 'Glitre', titleMatches)
    expect(r.extract).toBe('')
    expect(r.url).toBe('https://snl.no/Glitre')
  })

  it('filtrerer bort andre verk enn SNL (encyclopedia_id ≠ 1)', () => {
    const nbl = snlItem({ encyclopedia_id: 4, headword: 'Glitre', title: 'Glitre (biografi)' })
    expect(parseSnlSearch([nbl], 'Glitre', titleMatches)).toBeNull()
  })

  it('respekterer injisert matcher: placeNameMatches slipper bestemt form', () => {
    const item = snlItem({ headword: 'Bondivann', title: 'Bondivann', permalink: 'Bondivann',
      article_url: 'https://snl.no/Bondivann', first_two_sentences: 'Bondivann er en innsjø i Asker.' })
    expect(parseSnlSearch([item], 'Bondivannet', placeNameMatches).title).toBe('Bondivann')
    // titleMatches (streng) ville IKKE akseptert bestemt-form-mismatchen
    expect(parseSnlSearch([item], 'Bondivannet', titleMatches)).toBeNull()
  })

  it('holder å/ø/æ distinkt (Mardalen ≠ Mårdalen)', () => {
    const item = snlItem({ headword: 'Mårdalen', title: 'Mårdalen' })
    expect(parseSnlSearch([item], 'Mardalen', titleMatches)).toBeNull()
  })

  it('faller til renset snippet når first_two_sentences mangler', () => {
    const item = snlItem({ first_two_sentences: '' })
    expect(parseSnlSearch([item], 'Glitre', titleMatches).extract).toBe('… ligger ved Glitre …')
  })

  it('null for tomt/ikke-array/manglende url', () => {
    expect(parseSnlSearch([], 'Glitre', titleMatches)).toBeNull()
    expect(parseSnlSearch(null, 'Glitre', titleMatches)).toBeNull()
    expect(parseSnlSearch([snlItem({ article_url: '', permalink: '' })], 'Glitre', titleMatches)).toBeNull()
  })
})
