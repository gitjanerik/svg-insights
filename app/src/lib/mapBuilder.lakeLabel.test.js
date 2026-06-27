import { describe, it, expect } from 'vitest'
import { buildSvg } from './mapBuilder.js'

// v11.0.79 — navn på store vann som bare delvis er i utsnittet.
// Et vann der mesteparten ligger utenfor bboksen har sitt ekte tyngdepunkt
// utenfor lerretet. Tidligere ble navne-teksten emittert på den off-canvas
// koordinaten → usynlig på kartet OG utenfor søkeindeksen (som leser SVG-en).
// Fiksen klipper ringen mot kart-rektangelet og plasserer navnet på den
// synlige biten.

const bbox = { south: 59, north: 59.05, west: 10, east: 10.09 }

function viewBoxWH(svg) {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null
}

// Finn <text … data-label="vann-navn">NAME</text> og hent ut x/y.
function lakeLabelPos(svg, name) {
  for (const m of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
    const attrs = m[1]
    const text = m[2].trim()
    if (!/data-label="vann-navn"/.test(attrs)) continue
    const full = /data-name-full="([^"]*)"/.exec(attrs)?.[1]
    if (text !== name && full !== name) continue
    const x = Number(/\bx="([\d.-]+)"/.exec(attrs)?.[1])
    const y = Number(/\by="([\d.-]+)"/.exec(attrs)?.[1])
    return { x, y }
  }
  return null
}

describe('vann-navn for delvis synlig innsjø (v11.0.79)', () => {
  it('plasserer navnet innenfor lerretet når tyngdepunktet er utenfor utsnittet', () => {
    // Stort vann som strekker seg langt VEST for bboksen (vest = lon 10);
    // bare en østlig stripe (lon 10.0–10.02) er synlig. Ekte tyngdepunkt
    // ligger ved lon ≈ 9.985 → projisert x < 0 (utenfor lerretet).
    const bigLake = {
      type: 'way', id: 9001, _source: 'n50',
      tags: { natural: 'water', name: 'Storsetten' },
      geometry: [
        { lat: 59.01, lon: 9.95 },
        { lat: 59.01, lon: 10.02 },
        { lat: 59.04, lon: 10.02 },
        { lat: 59.04, lon: 9.95 },
        { lat: 59.01, lon: 9.95 },
      ],
    }
    const { svg } = buildSvg([bigLake], bbox, {})
    const wh = viewBoxWH(svg)
    expect(wh).toBeTruthy()

    const pos = lakeLabelPos(svg, 'Storsetten')
    expect(pos).toBeTruthy()
    expect(pos.x).toBeGreaterThanOrEqual(0)
    expect(pos.x).toBeLessThanOrEqual(wh.w)
    expect(pos.y).toBeGreaterThanOrEqual(0)
    expect(pos.y).toBeLessThanOrEqual(wh.h)
    // Navnet skal lande på den SYNLIGE østlige stripa (lon 10.0–10.02),
    // altså i venstre del av et 0–~5,1 km bredt kart, ikke på midten.
    expect(pos.x).toBeLessThan(wh.w * 0.5)
  })

  it('et fullt synlig vann beholder navn ved sitt tyngdepunkt (ingen regresjon)', () => {
    const lake = {
      type: 'way', id: 9002, _source: 'n50',
      tags: { natural: 'water', name: 'Midtvatnet' },
      geometry: [
        { lat: 59.02, lon: 10.04 },
        { lat: 59.02, lon: 10.05 },
        { lat: 59.03, lon: 10.05 },
        { lat: 59.03, lon: 10.04 },
        { lat: 59.02, lon: 10.04 },
      ],
    }
    const { svg } = buildSvg([lake], bbox, {})
    const wh = viewBoxWH(svg)
    const pos = lakeLabelPos(svg, 'Midtvatnet')
    expect(pos).toBeTruthy()
    // Tyngdepunktet ligger midt i kartet.
    expect(pos.x).toBeGreaterThan(wh.w * 0.3)
    expect(pos.x).toBeLessThan(wh.w * 0.7)
  })
})
