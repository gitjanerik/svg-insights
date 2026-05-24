import { describe, it, expect } from 'vitest'
import { vectorizeAlphaMask } from './waterMaskFromWms.js'

const bbox = { south: 59.80, west: 10.40, north: 59.85, east: 10.50 }

function makeMask(w, h, fill) {
  const m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      m[y * w + x] = fill(x, y) ? 1 : 0
    }
  }
  return m
}

describe('vectorizeAlphaMask', () => {
  it('klassifiserer som sjø når vann berører kant', () => {
    const w = 40, h = 40
    const mask = makeMask(w, h, (x) => x < 20)
    const r = vectorizeAlphaMask({
      mask, widthPx: w, heightPx: h, bbox,
      opts: { minAreaM2: 1, simplifyM: 0.5 },
    })
    expect(r.polygons.length).toBeGreaterThan(0)
    expect(r.polygons[0].type).toBe('sea')
  })

  it('klassifiserer som innsjø når vann er omsluttet', () => {
    const w = 40, h = 40
    const mask = makeMask(w, h, (x, y) => x >= 15 && x <= 25 && y >= 15 && y <= 25)
    const r = vectorizeAlphaMask({
      mask, widthPx: w, heightPx: h, bbox,
      opts: { minAreaM2: 1, simplifyM: 0.5 },
    })
    expect(r.polygons.length).toBeGreaterThan(0)
    expect(r.polygons[0].type).toBe('lake')
  })

  it('bevarer øy-hull i sjø-polygon (outer + inner ring)', () => {
    const w = 60, h = 60
    const mask = makeMask(w, h, (x, y) => {
      const isIsland = x >= 25 && x <= 34 && y >= 25 && y <= 34
      return !isIsland  // alt er vann unntatt øy-firkanten
    })
    const r = vectorizeAlphaMask({
      mask, widthPx: w, heightPx: h, bbox,
      opts: { minAreaM2: 1, simplifyM: 0.5 },
    })
    expect(r.polygons).toHaveLength(1)
    expect(r.polygons[0].type).toBe('sea')
    expect(r.polygons[0].rings.length).toBe(2)  // outer + hole
  })

  it('returnerer tomt for helt tom mask', () => {
    const w = 40, h = 40
    const mask = new Uint8Array(w * h)
    const r = vectorizeAlphaMask({
      mask, widthPx: w, heightPx: h, bbox,
      opts: { minAreaM2: 1, simplifyM: 0.5 },
    })
    expect(r.polygons).toHaveLength(0)
  })

  it('respekterer minAreaM2-filter', () => {
    // 2×2 piksel-flekk skal være for liten med stort areal-filter
    const w = 40, h = 40
    const mask = makeMask(w, h, (x, y) => x >= 19 && x <= 20 && y >= 19 && y <= 20)
    const r = vectorizeAlphaMask({
      mask, widthPx: w, heightPx: h, bbox,
      opts: { minAreaM2: 1e9, simplifyM: 0.5 },
    })
    expect(r.polygons).toHaveLength(0)
  })
})
