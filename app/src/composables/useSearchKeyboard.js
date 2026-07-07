import { ref, watch, nextTick } from 'vue'

/**
 * useSearchKeyboard — tastaturnavigasjon for et søkefelt med en resultatliste
 * (combobox-mønster). Fokus BLIR VÆRENDE i input-feltet — vi flytter aldri DOM-
 * fokus ut til listeelementene. Det er bevisst: flyttes fokus til knappene,
 * slutter ESC (som nullstiller søkefeltet) å nå input-en. I stedet holder vi
 * en `activeIndex` som markerer det uthevede treffet visuelt (aria-activedescendant).
 *
 *   - Pil ned / pil opp: flytt markeringen (wrap-around; fra ingenting → første/siste)
 *   - Enter: velg det markerte treffet
 *   - Escape: nullstill søkebegrepet (via onClear)
 *
 * @param {import('vue').Ref<Array>} results  reaktiv liste med treff
 * @param {object} opts
 * @param {(r:any)=>void} opts.onSelect  kalles med valgt treff ved Enter
 * @param {()=>void}      opts.onClear   kalles ved Escape (nullstill søket)
 * @param {(i:number)=>string} [opts.optionId]  gir DOM-id-en til treff nr i,
 *        brukes for auto-scroll av det markerte elementet inn i visning
 */
export function useSearchKeyboard(results, { onSelect, onClear, optionId } = {}) {
  const activeIndex = ref(-1)

  // Nye treff (nytt søk eller ny data) nullstiller markeringen — ellers ville
  // en gammel indeks peke på feil rad.
  watch(results, () => { activeIndex.value = -1 })

  if (optionId) {
    watch(activeIndex, (i) => {
      if (i < 0) return
      nextTick(() => {
        document.getElementById(optionId(i))?.scrollIntoView({ block: 'nearest' })
      })
    })
  }

  function move(delta) {
    const n = results.value.length
    if (!n) { activeIndex.value = -1; return }
    if (activeIndex.value < 0) {
      activeIndex.value = delta > 0 ? 0 : n - 1
      return
    }
    activeIndex.value = ((activeIndex.value + delta) % n + n) % n
  }

  function onKeydown(e) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'Enter': {
        const r = results.value[activeIndex.value]
        if (r) { e.preventDefault(); onSelect?.(r) }
        break
      }
      case 'Escape':
        e.preventDefault()
        onClear?.()
        activeIndex.value = -1
        break
    }
  }

  function reset() { activeIndex.value = -1 }

  return { activeIndex, onKeydown, reset }
}
