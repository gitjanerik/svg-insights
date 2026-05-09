import { describe, it, expect } from 'vitest'
import { buildPointSymbolDef } from './symbolizer.js'

describe('buildPointSymbolDef', () => {
  it('renders rect-elementer (ISOM 540 stake-port)', () => {
    const spec = {
      viewBox: '-1 -1 2 2',
      elements: [
        { type: 'rect', x: -0.4, y: -0.6, width: 0.8, height: 1.2, fill: '#cc1f1f' },
      ],
    }
    const def = buildPointSymbolDef('test-rect', spec)
    expect(def).toContain('<rect')
    expect(def).toContain('x="-0.4"')
    expect(def).toContain('y="-0.6"')
    expect(def).toContain('width="0.8"')
    expect(def).toContain('height="1.2"')
    expect(def).toContain('fill="#cc1f1f"')
  })

  it('renders flere rect-elementer (ISOM 542 stake-cardinal)', () => {
    const spec = {
      viewBox: '-1 -1 2 2',
      elements: [
        { type: 'rect', x: -0.4, y: -0.7, width: 0.8, height: 0.5, fill: '#000' },
        { type: 'rect', x: -0.4, y: -0.2, width: 0.8, height: 0.5, fill: '#f5d33a' },
        { type: 'rect', x: -0.4, y: 0.3, width: 0.8, height: 0.4, fill: '#000' },
      ],
    }
    const def = buildPointSymbolDef('test-cardinal', spec)
    const rectMatches = def.match(/<rect/g)
    expect(rectMatches).toHaveLength(3)
    expect(def).toContain('fill="#f5d33a"')
  })

  it('forblir bakoverkompatibel for circle/polygon/path/line', () => {
    const def = buildPointSymbolDef('test-mix', {
      viewBox: '-1 -1 2 2',
      elements: [
        { type: 'circle', cx: 0, cy: 0, r: 0.5, fill: '#000' },
        { type: 'polygon', points: '0,-1 1,1 -1,1', fill: '#0f0' },
      ],
    })
    expect(def).toContain('<circle')
    expect(def).toContain('<polygon')
  })
})
