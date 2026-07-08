import { describe, it, expect } from 'vitest'
import { routeCues, extractNamedPointsFromSvg, formatDistanceM } from './routeCues.js'

describe('routeCues', () => {
  it('østover så sørover i et kryss → ta til høyre', () => {
    const route = [[0, 0], [100, 0], [100, 100]] // øst, så sør (y-ned)
    const cues = routeCues(route, { junctionAt: () => true, namedPoints: [{ x: 100, y: 0, name: 'Krysset' }] })
    expect(cues).toHaveLength(1)
    expect(cues[0].side).toBe('høyre')
    expect(cues[0].near).toBe('Krysset')
    expect(cues[0].text).toContain('til høyre ved Krysset')
  })

  it('østover så nordover → ta til venstre', () => {
    const route = [[0, 0], [100, 0], [100, -100]]
    const cues = routeCues(route, { junctionAt: () => true })
    expect(cues[0].side).toBe('venstre')
  })

  it('slak knekk under terskelen gir ingen varsel', () => {
    const route = [[0, 0], [100, 0], [200, 10]] // ~6° sving
    expect(routeCues(route, { junctionAt: () => true })).toHaveLength(0)
  })

  it('sving som IKKE er i et kryss gir ingen varsel', () => {
    const route = [[0, 0], [100, 0], [100, 100]]
    expect(routeCues(route, { junctionAt: () => false })).toHaveLength(0)
  })

  it('uten navngitt holdepunkt i nærheten faller near til null', () => {
    const route = [[0, 0], [100, 0], [100, 100]]
    const cues = routeCues(route, { junctionAt: () => true, namedPoints: [{ x: 5000, y: 5000, name: 'Langt unna' }] })
    expect(cues[0].near).toBeNull()
    expect(cues[0].text).not.toContain('ved')
  })
})

describe('extractNamedPointsFromSvg', () => {
  it('plukker navngitte tekst-punkter, hopper over rene tall', () => {
    const svg = '<svg><text x="10" y="20">Abbortjern</text><text x="5" y="5">349</text>' +
      '<text x="30" y="40">Vardåsen</text></svg>'
    const pts = extractNamedPointsFromSvg(svg)
    expect(pts.map(p => p.name)).toEqual(['Abbortjern', 'Vardåsen'])
    expect(pts[0]).toEqual({ x: 10, y: 20, name: 'Abbortjern' })
  })

  it('krever x/y-attributter', () => {
    expect(extractNamedPointsFromSvg('<text>Utenpos</text>')).toEqual([])
  })
})

describe('formatDistanceM', () => {
  it('meter under ~1 km, ellers km med komma', () => {
    expect(formatDistanceM(320)).toBe('320 m')
    expect(formatDistanceM(1500)).toBe('1,5 km')
  })
})
