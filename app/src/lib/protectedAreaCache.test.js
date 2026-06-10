import { describe, it, expect } from 'vitest'
import { cacheGet, cacheSet, pointKey, TTL } from './protectedAreaCache.js'

describe('pointKey', () => {
  it('gruperer nære punkter til samme nøkkel (~100 m grid)', () => {
    expect(pointKey(59.91234, 10.74567)).toBe(pointKey(59.91245, 10.74578))
    expect(pointKey(59.9123, 10.7456)).not.toBe(pointKey(59.9200, 10.7456))
  })
})

describe('cacheGet / cacheSet (minne-fallback uten IndexedDB)', () => {
  it('lagrer og henter en verdi innen TTL', async () => {
    await cacheSet('test:a', { x: 1 }, TTL.vern)
    expect(await cacheGet('test:a')).toEqual({ x: 1 })
  })

  it('returnerer null når verdien er utløpt', async () => {
    await cacheSet('test:expired', { y: 2 }, -1)
    expect(await cacheGet('test:expired')).toBeNull()
  })

  it('lagrer ikke null/undefined (vi cacher ikke «ingen treff»)', async () => {
    await cacheSet('test:null', null, TTL.vern)
    expect(await cacheGet('test:null')).toBeNull()
  })

  it('returnerer null for ukjent nøkkel', async () => {
    expect(await cacheGet('test:missing')).toBeNull()
  })
})
