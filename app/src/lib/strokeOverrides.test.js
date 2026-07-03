import { describe, it, expect } from 'vitest'
import { buildStrokeOverrideCss, STROKE_GROUPS } from './strokeOverrides.js'

const neutral = () => Object.fromEntries(STROKE_GROUPS.map((g) => [g.id, 1]))

describe('buildStrokeOverrideCss', () => {
  it('gir tom streng når alle multiplikatorer er nøytrale', () => {
    expect(buildStrokeOverrideCss(neutral())).toBe('')
    expect(buildStrokeOverrideCss({})).toBe('')
    expect(buildStrokeOverrideCss(undefined)).toBe('')
  })

  it('behandler nesten-1 som nøytral (epsilon)', () => {
    expect(buildStrokeOverrideCss({ kurve: 1.0004 })).toBe('')
  })

  it('emitterer base-regler for alle kurve-koder med riktig mm og !important', () => {
    const css = buildStrokeOverrideCss({ ...neutral(), kurve: 1.5 })
    expect(css).toContain('.isom-map [data-iso="101"] { stroke-width: calc(0.07mm * var(--stroke-scale, 1) * 1.5) !important; }')
    expect(css).toContain('.isom-map [data-iso="102"] { stroke-width: calc(0.13mm * var(--stroke-scale, 1) * 1.5) !important; }')
    expect(css).toContain('.isom-map [data-iso="103"] { stroke-width: calc(0.07mm * var(--stroke-scale, 1) * 1.5) !important; }')
    expect(css).not.toContain('data-iso="505"')
  })

  it('emitterer casing-regel for stier (505/506)', () => {
    const css = buildStrokeOverrideCss({ sti: 2 })
    expect(css).toContain('.isom-map [data-iso="505"] path.casing { stroke-width: calc(0.22mm * var(--stroke-scale, 1) * 2) !important; }')
    expect(css).toContain('.isom-map [data-iso="506"] path.casing { stroke-width: calc(0.18mm * var(--stroke-scale, 1) * 2) !important; }')
    expect(css).toContain('.isom-map [data-iso="507"] { stroke-width: calc(0.08mm')
  })

  it('emitterer overlay-regel for stor vei (501/502)', () => {
    const css = buildStrokeOverrideCss({ storVei: 0.5 })
    expect(css).toContain('.isom-map [data-iso="501"] path.overlay { stroke-width: calc(0.34mm * var(--stroke-scale, 1) * 0.5) !important; }')
    expect(css).toContain('.isom-map [data-iso="502"] path.overlay { stroke-width: calc(0.22mm * var(--stroke-scale, 1) * 0.5) !important; }')
  })

  it('emitterer egen småbygg-regel for 521 (data-small)', () => {
    const css = buildStrokeOverrideCss({ bygg: 1.8 })
    expect(css).toContain('.isom-map [data-iso="521"] { stroke-width: calc(0.08mm * var(--stroke-scale, 1) * 1.8) !important; }')
    expect(css).toContain('.isom-map [data-iso="521"] path[data-small="yes"] { stroke-width: calc(0.05mm * var(--stroke-scale, 1) * 1.8) !important; }')
  })

  it('rører aldri dasharray', () => {
    const all2 = Object.fromEntries(STROKE_GROUPS.map((g) => [g.id, 2]))
    expect(buildStrokeOverrideCss(all2)).not.toContain('dasharray')
  })

  it('ignorerer ikke-numeriske verdier', () => {
    expect(buildStrokeOverrideCss({ kurve: 'abc', sti: NaN })).toBe('')
  })
})
