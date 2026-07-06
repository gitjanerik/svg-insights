import { describe, it, expect, vi, afterEach } from 'vitest'
import { kulturminneKategori, fetchKulturminner, fetchKulturminneById, cleanBeskrivelse } from './kulturminneFetcher.js'

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('kulturminneKategori — tittel → kategori', () => {
  it('klassifiserer gravminner', () => {
    expect(kulturminneKategori('Gravhaug ved elva')).toBe('gravminne')
    expect(kulturminneKategori('Stor røys')).toBe('gravminne')
    expect(kulturminneKategori('Gravfelt')).toBe('gravminne')
  })

  it('lar fangst vinne over grav for dyregrav/fangstgrav (inneholder «grav»)', () => {
    expect(kulturminneKategori('Dalsida statsalmenning - dyregrav')).toBe('fangst')
    expect(kulturminneKategori('Fangstgrav')).toBe('fangst')
    expect(kulturminneKategori('Veslkuva Fangstlokalitet')).toBe('fangst')
    expect(kulturminneKategori('Fangstgrop')).toBe('fangst')
  })

  it('klassifiserer stein/bergkunst', () => {
    expect(kulturminneKategori('Bautastein')).toBe('stein')
    expect(kulturminneKategori('Helleristning felt 2')).toBe('stein')
    expect(kulturminneKategori('Rodestein nr 4')).toBe('stein')
  })

  it('klassifiserer bygninger/anlegg', () => {
    expect(kulturminneKategori('Hustuft')).toBe('bygning')
    expect(kulturminneKategori('Gammel mur')).toBe('bygning')
    expect(kulturminneKategori('Kai')).toBe('bygning')
  })

  it('faller tilbake til «annet» for ukjente titler og tom input', () => {
    expect(kulturminneKategori('Noe rart')).toBe('annet')
    expect(kulturminneKategori('')).toBe('annet')
    expect(kulturminneKategori(null)).toBe('annet')
  })
})

describe('cleanBeskrivelse — fjern «<etikett>: null»-artefakter', () => {
  it('fjerner en ledende «Beskrivelse: null» men beholder resten', () => {
    const raw = 'Beskrivelse: null\n\nBygningen ble brukt til krutt.\n\nDatering: 1900-tallet'
    expect(cleanBeskrivelse(raw)).toBe('Bygningen ble brukt til krutt.\n\nDatering: 1900-tallet')
  })

  it('beholder ekte innhold (aldri linjer med reell verdi)', () => {
    const raw = 'Datering: 1900-tallet\nKilder: Forvaltningsplan Nordre Håøya'
    expect(cleanBeskrivelse(raw)).toBe(raw)
  })

  it('rører ikke prosa som tilfeldigvis nevner null', () => {
    const raw = 'Bygningen har null vinduer igjen.'
    expect(cleanBeskrivelse(raw)).toBe(raw)
  })

  it('håndterer null/tom input', () => {
    expect(cleanBeskrivelse(null)).toBe('')
    expect(cleanBeskrivelse('')).toBe('')
  })
})

describe('fetchKulturminner — bbox-henting', () => {
  const bbox = { south: 61.9, west: 9.0, north: 62.0, east: 9.1 }

  it('mapper features til lette objekter (id/lat/lon/tittel/kategori)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({
      features: [{
        id: 'uuid-1',
        geometry: { type: 'Point', coordinates: [9.05, 61.95] },
        properties: { tittel: 'Fangstgrop' },
      }],
      links: [],
    })))
    const out = await fetchKulturminner(bbox)
    expect(out).toEqual([
      { id: 'uuid-1', lat: 61.95, lon: 9.05, tittel: 'Fangstgrop', kategori: 'fangst' },
    ])
  })

  it('følger next-lenken (paginering) og slår sammen sidene', async () => {
    const fetchMock = vi.fn((url) => {
      if (!String(url).includes('offset')) {
        return jsonResponse({
          features: [{ id: 'a', geometry: { coordinates: [9.01, 61.91] }, properties: { tittel: 'Gravhaug' } }],
          links: [{ rel: 'next', href: 'https://api.ra.no/x?offset=1' }],
        })
      }
      return jsonResponse({
        features: [{ id: 'b', geometry: { coordinates: [9.02, 61.92] }, properties: { tittel: 'Bautastein' } }],
        links: [],
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchKulturminner(bbox)
    expect(out.map((k) => k.id)).toEqual(['a', 'b'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('respekterer maxTotal og logger når taket nås', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.fn(() => jsonResponse({
      features: [
        { id: 'a', geometry: { coordinates: [9.01, 61.91] }, properties: { tittel: 'X' } },
        { id: 'b', geometry: { coordinates: [9.02, 61.92] }, properties: { tittel: 'Y' } },
      ],
      links: [{ rel: 'next', href: 'https://api.ra.no/x?offset=2' }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchKulturminner(bbox, { maxTotal: 2 })
    expect(out).toHaveLength(2)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('dropper features uten gyldig geometri eller id', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({
      features: [
        { id: 'ok', geometry: { coordinates: [9.05, 61.95] }, properties: { tittel: 'Grav' } },
        { id: 'nogeom', geometry: null, properties: { tittel: 'Uten geometri' } },
        { geometry: { coordinates: [9.06, 61.96] }, properties: { tittel: 'Uten id' } },
      ],
      links: [],
    })))
    const out = await fetchKulturminner(bbox)
    expect(out.map((k) => k.id)).toEqual(['ok'])
  })

  it('returnerer [] ved nettfeil (kaster aldri)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('nett nede'))))
    expect(await fetchKulturminner(bbox)).toEqual([])
  })

  it('returnerer [] for ugyldig bbox uten å hente', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchKulturminner({ south: NaN, west: 9, north: 62, east: 9.1 })).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('fetchKulturminneById — detalj', () => {
  it('mapper et Feature til fullt objekt inkl. bilder og lenke', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({
      type: 'Feature',
      id: 'uuid-9',
      geometry: { type: 'Point', coordinates: [10.8, 59.9] },
      properties: {
        tittel: 'Gravhaug',
        beskrivelse: 'En stor haug.',
        fylke: 'Oslo',
        kommune: 'Oslo',
        opprettet_av: 'Ola',
        linkkulturminnesok: 'https://www.kulturminnesok.no/kart/?id=uuid-9',
        bilder: [
          { url: 'https://x/img.png', fotograf: 'Kari', lisens: 'CC BY', beskrivelse: 'Bilde' },
          { fotograf: 'Uten url' },
        ],
      },
    })))
    const d = await fetchKulturminneById('uuid-9')
    expect(d.id).toBe('uuid-9')
    expect(d.kategori).toBe('gravminne')
    expect(d.kommune).toBe('Oslo')
    expect(d.opprettetAv).toBe('Ola')
    expect(d.link).toBe('https://www.kulturminnesok.no/kart/?id=uuid-9')
    expect(d.bilder).toEqual([{ url: 'https://x/img.png', fotograf: 'Kari', lisens: 'CC BY', beskrivelse: 'Bilde' }])
  })

  it('returnerer null for tom id og ved feil', async () => {
    expect(await fetchKulturminneById('')).toBeNull()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('x'))))
    expect(await fetchKulturminneById('uuid-1')).toBeNull()
  })
})
