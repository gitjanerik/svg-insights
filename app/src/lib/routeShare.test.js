import { describe, it, expect } from 'vitest'
import { routeShareToken, parseRouteToken, SHARE_NAME_MAX } from './routeShare.js'
import { pickReverseShortName } from './nominatimReverse.js'

describe('routeShareToken / parseRouteToken', () => {
  const rec = {
    navn: 'Fra Kattfoss til Sysle',
    proposalId: 'mest-grus',
    waypoints: [
      { lat: 59.925212, lon: 9.884143, name: 'Kattfoss' },
      { lat: 59.987654, lon: 9.883512, name: 'Sysle' },
    ],
  }

  it('roundtrip: token → parse gir samme koordinater, navn og profil', () => {
    const parsed = parseRouteToken(routeShareToken(rec))
    expect(parsed.a.lat).toBeCloseTo(59.925212, 6)
    expect(parsed.a.lon).toBeCloseTo(9.884143, 6)
    expect(parsed.b.lat).toBeCloseTo(59.987654, 6)
    expect(parsed.navn).toBe('Fra Kattfoss til Sysle')
    expect(parsed.proposalId).toBe('mest-grus')
  })

  it('pipe i navn erstattes så tokenet ikke ødelegges; komma overlever', () => {
    const parsed = parseRouteToken(routeShareToken({
      ...rec, navn: 'Rute A|B, via Sysle',
    }))
    expect(parsed.navn).toBe('Rute A/B, via Sysle')
  })

  it('navn kuttes til maks-lengde', () => {
    const parsed = parseRouteToken(routeShareToken({ ...rec, navn: 'x'.repeat(200) }))
    expect(parsed.navn.length).toBe(SHARE_NAME_MAX)
  })

  it('mangler navn/proposalId → null-felt, tokenet er fortsatt gyldig', () => {
    const parsed = parseRouteToken(routeShareToken({ waypoints: rec.waypoints }))
    expect(parsed.navn).toBeNull()
    expect(parsed.proposalId).toBeNull()
    expect(parsed.a.name).toBe('Delt start')
    expect(parsed.b.name).toBe('Delt mål')
  })

  it('record uten waypoints → null token; ugyldig token → null parse', () => {
    expect(routeShareToken({ navn: 'x' })).toBeNull()
    expect(parseRouteToken('tull|uten|tall')).toBeNull()
    expect(parseRouteToken('')).toBeNull()
    expect(parseRouteToken(null)).toBeNull()
  })
})

describe('pickReverseShortName', () => {
  it('foretrekker det mest lokale steds-leddet', () => {
    expect(pickReverseShortName({
      name: 'Fylkesvei 287',
      address: { village: 'Sysle', municipality: 'Modum', city: undefined },
    })).toBe('Sysle')
    expect(pickReverseShortName({
      address: { hamlet: 'Kattfoss', village: 'Geithus' },
    })).toBe('Kattfoss')
  })
  it('faller tilbake til objektets navn, ellers null', () => {
    expect(pickReverseShortName({ name: 'Blaafarveværket', address: {} })).toBe('Blaafarveværket')
    expect(pickReverseShortName({ address: {} })).toBeNull()
    expect(pickReverseShortName()).toBeNull()
  })
})
