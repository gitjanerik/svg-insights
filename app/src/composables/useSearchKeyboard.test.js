import { describe, it, expect, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { useSearchKeyboard } from './useSearchKeyboard.js'

function key(name) {
  return { key: name, preventDefault: vi.fn() }
}

describe('useSearchKeyboard', () => {
  it('pil ned fra ingenting markerer første treff, wrap-around til slutt', () => {
    const results = ref([{ id: 1 }, { id: 2 }, { id: 3 }])
    const { activeIndex, onKeydown } = useSearchKeyboard(results, {})
    expect(activeIndex.value).toBe(-1)
    onKeydown(key('ArrowDown'))
    expect(activeIndex.value).toBe(0)
    onKeydown(key('ArrowDown'))
    onKeydown(key('ArrowDown'))
    expect(activeIndex.value).toBe(2)
    onKeydown(key('ArrowDown'))          // wrap
    expect(activeIndex.value).toBe(0)
  })

  it('pil opp fra ingenting markerer siste treff', () => {
    const results = ref([{ id: 1 }, { id: 2 }, { id: 3 }])
    const { activeIndex, onKeydown } = useSearchKeyboard(results, {})
    onKeydown(key('ArrowUp'))
    expect(activeIndex.value).toBe(2)
    onKeydown(key('ArrowUp'))
    expect(activeIndex.value).toBe(1)
  })

  it('Enter velger det markerte treffet', () => {
    const results = ref([{ id: 1 }, { id: 2 }])
    const onSelect = vi.fn()
    const { onKeydown } = useSearchKeyboard(results, { onSelect })
    onKeydown(key('ArrowDown'))
    onKeydown(key('ArrowDown'))          // index 1
    const ev = key('Enter')
    onKeydown(ev)
    expect(onSelect).toHaveBeenCalledWith({ id: 2 })
    expect(ev.preventDefault).toHaveBeenCalled()
  })

  it('Enter uten markering gjør ingenting (lar native oppførsel stå)', () => {
    const results = ref([{ id: 1 }])
    const onSelect = vi.fn()
    const { onKeydown } = useSearchKeyboard(results, { onSelect })
    const ev = key('Enter')
    onKeydown(ev)
    expect(onSelect).not.toHaveBeenCalled()
    expect(ev.preventDefault).not.toHaveBeenCalled()
  })

  it('Escape kaller onClear og nullstiller markeringen', () => {
    const results = ref([{ id: 1 }, { id: 2 }])
    const onClear = vi.fn()
    const { activeIndex, onKeydown } = useSearchKeyboard(results, { onClear })
    onKeydown(key('ArrowDown'))
    expect(activeIndex.value).toBe(0)
    onKeydown(key('Escape'))
    expect(onClear).toHaveBeenCalled()
    expect(activeIndex.value).toBe(-1)
  })

  it('nye treff nullstiller markeringen', async () => {
    const results = ref([{ id: 1 }, { id: 2 }])
    const { activeIndex, onKeydown } = useSearchKeyboard(results, {})
    onKeydown(key('ArrowDown'))
    expect(activeIndex.value).toBe(0)
    results.value = [{ id: 9 }]
    await nextTick()
    expect(activeIndex.value).toBe(-1)
  })

  it('tom liste holder markeringen på -1', () => {
    const results = ref([])
    const { activeIndex, onKeydown } = useSearchKeyboard(results, {})
    onKeydown(key('ArrowDown'))
    expect(activeIndex.value).toBe(-1)
    onKeydown(key('ArrowUp'))
    expect(activeIndex.value).toBe(-1)
  })
})
