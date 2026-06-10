import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useScreenWakeLock } from './useScreenWakeLock.js'

// Mocker Screen Wake Lock API + document slik at vi kan teste inaktivitets-
// timeren i node-env. Hver request() gir en fersk sentinel med en release-spy.
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

let requestSpy
let lastSentinel

function makeSentinel() {
  lastSentinel = { release: vi.fn(() => Promise.resolve()), addEventListener: vi.fn() }
  return lastSentinel
}

beforeEach(() => {
  vi.useFakeTimers()
  requestSpy = vi.fn(() => Promise.resolve(makeSentinel()))
  vi.stubGlobal('navigator', { wakeLock: { request: requestSpy } })
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useScreenWakeLock — inaktivitets-timer', () => {
  it('default er AV (opt-in) — start() uten enabled tar ingen lock', async () => {
    const wl = useScreenWakeLock({ idleTimeoutMs: 1000 })
    expect(wl.enabled.value).toBe(false)
    wl.start()
    await flush()
    expect(requestSpy).not.toHaveBeenCalled()
    expect(wl.active.value).toBe(false)
  })

  it('tar wake-lock ved start når enabled', async () => {
    const wl = useScreenWakeLock({ idleTimeoutMs: 1000 })
    wl.enabled.value = true   // opt-in
    wl.start()
    await flush()
    expect(requestSpy).toHaveBeenCalledWith('screen')
    expect(wl.active.value).toBe(true)
  })

  it('slipper locken etter idle-timeout uten aktivitet', async () => {
    const wl = useScreenWakeLock({ idleTimeoutMs: 1000 })
    wl.enabled.value = true
    wl.start()
    await flush()
    expect(wl.active.value).toBe(true)

    vi.advanceTimersByTime(1000)
    await flush()
    expect(lastSentinel.release).toHaveBeenCalled()
    expect(wl.active.value).toBe(false)
  })

  it('poke re-acquirer locken etter idle-slipp', async () => {
    const wl = useScreenWakeLock({ idleTimeoutMs: 1000 })
    wl.enabled.value = true
    wl.start()
    await flush()
    vi.advanceTimersByTime(1000)
    await flush()
    expect(wl.active.value).toBe(false)

    wl.poke()
    await flush()
    expect(requestSpy).toHaveBeenCalledTimes(2)
    expect(wl.active.value).toBe(true)
  })

  it('poke fornyer timeren så locken IKKE slippes ved aktivitet', async () => {
    const wl = useScreenWakeLock({ idleTimeoutMs: 1000 })
    wl.enabled.value = true
    wl.start()
    await flush()
    // Aktivitet rett før timeout → timer nullstilles
    vi.advanceTimersByTime(800)
    wl.poke()
    await flush()
    vi.advanceTimersByTime(800)   // 1600ms totalt, men kun 800 siden poke
    await flush()
    expect(wl.active.value).toBe(true)
    expect(lastSentinel.release).not.toHaveBeenCalled()
  })

  it('disablet → ingen lock, poke er no-op', async () => {
    const wl = useScreenWakeLock({ idleTimeoutMs: 1000 })
    wl.setEnabled(false)
    await flush()
    requestSpy.mockClear()
    wl.poke()
    await flush()
    expect(requestSpy).not.toHaveBeenCalled()
    expect(wl.active.value).toBe(false)
  })
})
