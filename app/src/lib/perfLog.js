// perfLog.js — liten perf-logg som overlever auto-kart-navigering og reload.
//
// Brukeren sitter på mobil og kan ikke lese nettleser-konsollen. createMapFlow
// skriver byggetider hit (i tillegg til console.log), og MapView viser dem i en
// modal med kopier-knapp så de kan limes inn og deles. Lagres i localStorage
// (ring-buffer) — auto-kart bytter komponent ved hver bygging, så in-memory
// ville nullstilt loggen.

const KEY = 'svg-insights-perflog'
const MAX = 60

export function logPerf(msg) {
  try {
    const arr = getPerfLog()
    arr.push({ t: Date.now(), msg })
    while (arr.length > MAX) arr.shift()
    localStorage.setItem(KEY, JSON.stringify(arr))
  } catch { /* localStorage utilgjengelig — ignorer */ }
  try { console.log(msg) } catch { /* noop */ }
}

export function getPerfLog() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function clearPerfLog() {
  try { localStorage.removeItem(KEY) } catch { /* noop */ }
}
