import { describe, it, expect } from 'vitest'
import {
  buildWmsGetMapUrl, buildWmsGetFeatureInfoUrl, parseWmsFeatureInfo,
  summarizeKulturminne, kulturminnesokLokalitetUrl,
} from './kulturminneWms.js'

const extent = { minE: 250000, minN: 6614000, maxE: 255000, maxN: 6619000 }

describe('buildWmsGetMapUrl', () => {
  it('bygger 1.3.0 GetMap i EPSG:25832 med E,N-bbox og transparent PNG', () => {
    const u = new URL(buildWmsGetMapUrl({ ...extent, widthPx: 2048, heightPx: 2048 }))
    const q = u.searchParams
    expect(q.get('REQUEST')).toBe('GetMap')
    expect(q.get('VERSION')).toBe('1.3.0')
    expect(q.get('CRS')).toBe('EPSG:25832')
    expect(q.get('BBOX')).toBe('250000,6614000,255000,6619000')
    expect(q.get('TRANSPARENT')).toBe('TRUE')
    expect(q.get('FORMAT')).toBe('image/png')
    expect(q.get('WIDTH')).toBe('2048')
  })
})

describe('buildWmsGetFeatureInfoUrl', () => {
  it('legger til QUERY_LAYERS, I/J, BUFFER og GML-format', () => {
    const q = new URL(buildWmsGetFeatureInfoUrl({ ...extent, widthPx: 800, heightPx: 800, i: 400, j: 400 })).searchParams
    expect(q.get('REQUEST')).toBe('GetFeatureInfo')
    expect(q.get('QUERY_LAYERS')).toBeTruthy()
    expect(q.get('I')).toBe('400')
    expect(q.get('J')).toBe('400')
    expect(Number(q.get('BUFFER'))).toBeGreaterThan(0)
    expect(q.get('INFO_FORMAT')).toBe('text/plain')
  })
})

// Ekte MapServer text/plain-format (utdrag fra kart.ra.no/wms/kulturminner2)
const PLAIN = `GetFeatureInfo results:

Layer 'Lokalitetsikoner'
  Feature 48670:
    lokalid = '48670-1'
    kulturminneid = '48670-1'
    navn = 'Hurumprosjektet - R45'
    lokalitetsart = 'Bosetning-aktivitetsområde'
    enkeltminneart = 'Boplass'
    datering = 'Steinalder'
    vernetype = 'Automatisk fredet'
    kommune = 'Asker'
    informasjon = 'På en slette ble det funnet flint.'
    linkkulturminnesok = 'https://kulturminnesok.no/ra/lokalitet/48670'
Layer 'Enkeltminneikoner'
  Feature 173268:
    navn = 'Retterstedet'
    enkeltminneart = 'Krigsminne'
    kulturminneid = '173268-53'
`

describe('parseWmsFeatureInfo', () => {
  it('parser MapServer text/plain til ett objekt pr Feature', () => {
    const feats = parseWmsFeatureInfo(PLAIN)
    expect(feats).toHaveLength(2)
    expect(feats[0].navn).toBe('Hurumprosjektet - R45')
    expect(feats[0].kulturminneid).toBe('48670-1')
    expect(feats[0].datering).toBe('Steinalder')
    expect(feats[1].enkeltminneart).toBe('Krigsminne')
  })

  it('returnerer [] for tomt msGMLOutput / tom input', () => {
    expect(parseWmsFeatureInfo('GetFeatureInfo results:\n')).toEqual([])
    expect(parseWmsFeatureInfo('')).toEqual([])
    expect(parseWmsFeatureInfo(null)).toEqual([])
  })
})

describe('summarizeKulturminne', () => {
  it('plukker relevante felt, art fra enkeltminne først, og lokalitet-id fra kid', () => {
    const s = summarizeKulturminne(parseWmsFeatureInfo(PLAIN)[0])
    expect(s.navn).toBe('Hurumprosjektet - R45')
    expect(s.art).toBe('Boplass') // enkeltminneart foran lokalitetsart
    expect(s.vernetype).toBe('Automatisk fredet')
    expect(s.kommune).toBe('Asker')
    expect(s.informasjon).toContain('flint')
    expect(s.lokalitetid).toBe('48670') // før bindestrek i kid
    expect(s.link).toBe('https://kulturminnesok.no/ra/lokalitet/48670')
  })

  it('returnerer null for tom input', () => {
    expect(summarizeKulturminne(null)).toBeNull()
  })
})

describe('kulturminnesokLokalitetUrl', () => {
  it('bygger lenke fra lokalitetid, null uten', () => {
    expect(kulturminnesokLokalitetUrl('100007')).toBe('https://kulturminnesok.no/ra/lokalitet/100007')
    expect(kulturminnesokLokalitetUrl(null)).toBeNull()
  })
})
