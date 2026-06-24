import { ref, watch } from 'vue'

// Live-justerbare detalj-LOD-knotter (Utvikler-fanen). Lar oss finne sweet-spoten
// for zoom-trappingen empirisk på ekte kart uten å pushe ny kode for hvert forsøk.
//
// VIKTIG: kun RUNTIME-parametre kan justeres her — terskelen for når MapView
// setter `.zoom-near`-klassen, og navne-tetthets-budsjettene. HVILKE lag som
// gates (kontur-tall, vann-tall, bekk, minor stedsnavn) er bakt inn i SVG-ens
// CSS ved bygging og kan ikke endres i ettertid uten å bygge kartet på nytt.
//
// Modul-nivå refs ⇒ delt singleton, overlever MapView-remount, persisteres.
const KEY = 'svg-insights-lod-tuning'
export const LOD_DEFAULTS = Object.freeze({ near: 2.5, budgetFar: 60, budgetMid: 130, budgetNear: 250 })

function loadSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    return (v && typeof v === 'object') ? v : {}
  } catch { return {} }
}
const s = loadSaved()
const num = (v, def) => (Number.isFinite(v) ? v : def)

const zoomNearThreshold = ref(num(s.near, LOD_DEFAULTS.near))
const nameBudgetFar  = ref(num(s.budgetFar,  LOD_DEFAULTS.budgetFar))
const nameBudgetMid  = ref(num(s.budgetMid,  LOD_DEFAULTS.budgetMid))
const nameBudgetNear = ref(num(s.budgetNear, LOD_DEFAULTS.budgetNear))

watch([zoomNearThreshold, nameBudgetFar, nameBudgetMid, nameBudgetNear], () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      near: zoomNearThreshold.value,
      budgetFar: nameBudgetFar.value,
      budgetMid: nameBudgetMid.value,
      budgetNear: nameBudgetNear.value,
    }))
  } catch { /* private mode / quota — ignore */ }
})

function resetLodTuning() {
  zoomNearThreshold.value = LOD_DEFAULTS.near
  nameBudgetFar.value  = LOD_DEFAULTS.budgetFar
  nameBudgetMid.value  = LOD_DEFAULTS.budgetMid
  nameBudgetNear.value = LOD_DEFAULTS.budgetNear
}

export function useLodTuning() {
  return {
    zoomNearThreshold, nameBudgetFar, nameBudgetMid, nameBudgetNear,
    resetLodTuning, LOD_DEFAULTS,
  }
}
