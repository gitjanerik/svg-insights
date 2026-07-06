import { describe, it, expect } from 'vitest'
import {
  buildWfsUrl, centroidFromPosList, vernInfo, parseWfsLokaliteter,
} from './kulturminneWfs.js'

const bbox = { south: 59.66, west: 10.53, north: 59.71, east: 10.62 }

describe('buildWfsUrl', () => {
  it('bygger WFS 2.0.0 GetFeature med lat,lon-bbox i EPSG:4258', () => {
    const q = new URL(buildWfsUrl(bbox)).searchParams
    expect(q.get('version')).toBe('2.0.0')
    expect(q.get('typeNames')).toBe('app:Lokalitet')
    expect(q.get('bbox')).toBe('59.66,10.53,59.71,10.62,urn:ogc:def:crs:EPSG::4258')
    expect(q.get('count')).toBe('400')
    expect(q.get('resultType')).toBeNull()
  })
  it('hits-modus setter resultType=hits uten count', () => {
    const q = new URL(buildWfsUrl(bbox, { hits: true })).searchParams
    expect(q.get('resultType')).toBe('hits')
    expect(q.get('count')).toBeNull()
  })
})

describe('centroidFromPosList', () => {
  it('snitter lat/lon-par (lat,lon-rekkefølge)', () => {
    const c = centroidFromPosList('59.66 10.58 59.68 10.60')
    expect(c.lat).toBeCloseTo(59.67, 5)
    expect(c.lon).toBeCloseTo(10.59, 5)
  })
  it('returnerer null for tomt', () => {
    expect(centroidFromPosList('')).toBeNull()
    expect(centroidFromPosList(null)).toBeNull()
  })
})

describe('vernInfo', () => {
  it('mapper SOSI-vernetype-koder til lesbar tekst + kategori', () => {
    expect(vernInfo('AUT')).toEqual({ text: 'Automatisk fredet', kategori: 'automatisk' })
    expect(vernInfo('VED')).toEqual({ text: 'Vedtaksfredet', kategori: 'vedtak' })
    expect(vernInfo('LIST')).toEqual({ text: 'Listeført', kategori: 'listefort' })
    expect(vernInfo('IKKEV').kategori).toBe('annet')
    expect(vernInfo('UAV').kategori).toBe('annet')
  })
  it('ukjent kode → viser koden som tekst, kategori annet', () => {
    expect(vernInfo('XYZ')).toEqual({ text: 'XYZ', kategori: 'annet' })
    expect(vernInfo(null)).toEqual({ text: null, kategori: 'annet' })
  })
})

const GML = `<?xml version="1.0"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" numberMatched="2" numberReturned="2">
 <wfs:member>
  <app:Lokalitet xmlns:app="ns" xmlns:gml="g" gml:id="lokalitet.140269">
    <app:informasjon>Gravfelt.</app:informasjon>
    <app:område>
      <gml:Polygon srsName="urn:ogc:def:crs:EPSG::4258">
        <gml:exterior><gml:LinearRing>
          <gml:posList>59.66 10.58 59.68 10.60 59.70 10.62 59.66 10.58</gml:posList>
        </gml:LinearRing></gml:exterior>
      </gml:Polygon>
    </app:område>
    <app:navn>Gravfelt Håøya</app:navn>
    <app:kulturminneId>140269</app:kulturminneId>
    <app:kommune>Frogn</app:kommune>
    <app:vernetype>AUT</app:vernetype>
    <app:linkKulturminnesøk>https://kulturminnesok.no/ra/lokalitet/140269</app:linkKulturminnesøk>
  </app:Lokalitet>
 </wfs:member>
 <wfs:member>
  <app:Lokalitet xmlns:app="ns" xmlns:gml="g" gml:id="lokalitet.99">
    <app:område><gml:Point srsName="x"><gml:pos>59.68 10.55</gml:pos></gml:Point></app:område>
    <app:navn>Oscarsborg</app:navn>
    <app:vernetype>VED</app:vernetype>
    <app:kommune>Frogn</app:kommune>
  </app:Lokalitet>
 </wfs:member>
</wfs:FeatureCollection>`

describe('parseWfsLokaliteter', () => {
  it('parser polygon-sentroide + felt fra GML', () => {
    const feats = parseWfsLokaliteter(GML)
    expect(feats).toHaveLength(2)
    const g = feats[0]
    expect(g.navn).toBe('Gravfelt Håøya')
    expect(g.vernetype).toBe('Automatisk fredet')   // AUT-kode → lesbar tekst
    expect(g.kategori).toBe('automatisk')
    expect(g.informasjon).toBe('Gravfelt.')
    expect(g.kommune).toBe('Frogn')
    expect(g.link).toBe('https://kulturminnesok.no/ra/lokalitet/140269')
    expect(g.lat).toBeCloseTo(59.675, 2)
    expect(g.lon).toBeCloseTo(10.595, 2)
  })

  it('takler Point-geometri (gml:pos) og manglende lenke', () => {
    const o = parseWfsLokaliteter(GML)[1]
    expect(o.navn).toBe('Oscarsborg')
    expect(o.lat).toBeCloseTo(59.68, 5)
    expect(o.lon).toBeCloseTo(10.55, 5)
    expect(o.link).toBeNull()
    expect(o.kategori).toBe('vedtak')
  })

  it('returnerer [] for tomt/ugyldig', () => {
    expect(parseWfsLokaliteter('')).toEqual([])
    expect(parseWfsLokaliteter(null)).toEqual([])
  })
})
