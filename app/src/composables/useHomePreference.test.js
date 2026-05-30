import { describe, it, expect } from 'vitest'
import { useHomePreference, HOME_APPS, defaultHomeRoute } from './useHomePreference.js'

// Kjører i node-env uten localStorage — read()/setHomeApp() svelger feilen,
// så vi tester ref-oppførselen og rute-oppslaget (det guarden bruker).

describe('useHomePreference', () => {
  it('starter på portal (ingen redirect)', () => {
    const { homeApp } = useHomePreference()
    expect(homeApp.value).toBe('portal')
    expect(defaultHomeRoute()).toBe(null)
  })

  it('setHomeApp peker guarden mot riktig rute', () => {
    const { setHomeApp } = useHomePreference()
    setHomeApp('kart')
    expect(defaultHomeRoute()).toBe('kart-hjem')
    setHomeApp('font')
    expect(defaultHomeRoute()).toBe('font-chooser')
    setHomeApp('draw')
    expect(defaultHomeRoute()).toBe('capture')
  })

  it('portal nullstiller redirect', () => {
    const { setHomeApp } = useHomePreference()
    setHomeApp('kart')
    setHomeApp('portal')
    expect(defaultHomeRoute()).toBe(null)
  })

  it('ignorerer ugyldige verdier', () => {
    const { setHomeApp, homeApp } = useHomePreference()
    setHomeApp('portal')
    setHomeApp('finnes-ikke')
    expect(homeApp.value).toBe('portal')
  })

  it('alle valg peker på rutenavn som finnes i routeren', () => {
    // Speiler navnene i router.js — fanger opp utilsiktede omdøpinger.
    const valid = new Set(['home', 'capture', 'kart-hjem', 'font-chooser'])
    for (const { route } of Object.values(HOME_APPS)) {
      expect(valid.has(route)).toBe(true)
    }
  })
})
