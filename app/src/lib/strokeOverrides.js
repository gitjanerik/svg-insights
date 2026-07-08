import isomCatalogDefault from './isomCatalog.json' with { type: 'json' }

// Per-element strek-overstyring (v12.0.18): strek-panelet på Strek-FAB-en lar
// brukeren skalere strekbredden per elementgruppe. Bredder er bakt inn i hvert
// lagret karts <style> ved bygging (symbolizer.js), så overstyringen må skje
// runtime — MapView injiserer CSS-en herfra som <style id="stroke-override-style">
// i kart-SVG-en. !important slår de bakede reglene uansett dokumentrekkefølge.

export const STROKE_GROUPS = Object.freeze([
  { id: 'kurve',    label: 'Høydekurver',          codes: ['101', '102', '103'] },
  { id: 'sti',      label: 'Stier',                codes: ['505', '506', '507'] },
  { id: 'litenVei', label: 'Liten vei',            codes: ['503', '504'] },
  { id: 'storVei',  label: 'Stor vei',             codes: ['501', '502'] },
  { id: 'stup',     label: 'Stup',                 codes: ['201', '203'] },
  { id: 'verne',    label: 'Naturreservat-omriss', codes: ['520'] },
  { id: 'bygg',     label: 'Store bygninger',      codes: ['521'] },
  { id: 'bane',     label: 'Idrettsbaner',         codes: ['513'] },
])

export const NEUTRAL_MULTIPLIER = 1

// Småbygg-regelen i symbolizer.js bruker en hardkodet 0.05 mm (ikke i katalogen)
// og en mer spesifikk selektor enn gruppens base-regel — må speiles her.
const SMALL_BUILDING_WIDTH_MM = 0.05

const EPSILON = 0.001

function findDef(catalog, code) {
  for (const defs of Object.values(catalog.categories)) {
    if (defs[code]) return defs[code]
  }
  return null
}

const swRule = (sel, widthMm, mult) =>
  `${sel} { stroke-width: calc(${widthMm}mm * var(--stroke-scale, 1) * ${mult}) !important; }`

/**
 * Bygger override-CSS for gruppene i STROKE_GROUPS. Grupper med nøytral
 * multiplikator (1) hoppes over — nøytral state gir tom streng, som garanterer
 * at kart uten justering rendres byte-identisk med i dag (også eldre kart der
 * bakede mm-verdier avviker fra gjeldende katalog).
 */
export function buildStrokeOverrideCss(multipliers, catalog = isomCatalogDefault) {
  const rules = []
  for (const group of STROKE_GROUPS) {
    const raw = multipliers?.[group.id]
    const mult = Number.isFinite(raw) ? raw : NEUTRAL_MULTIPLIER
    if (Math.abs(mult - NEUTRAL_MULTIPLIER) < EPSILON) continue
    const m = Number(mult.toFixed(3))
    for (const code of group.codes) {
      const def = findDef(catalog, code)
      if (!def) continue
      const sel = `.isom-map [data-iso="${code}"]`
      if (def.stroke?.widthMm) rules.push(swRule(sel, def.stroke.widthMm, m))
      if (def.casingStroke?.widthMm) rules.push(swRule(`${sel} path.casing`, def.casingStroke.widthMm, m))
      if (def.overlayStroke?.widthMm) rules.push(swRule(`${sel} path.overlay`, def.overlayStroke.widthMm, m))
      if (code === '521') rules.push(swRule(`${sel} path[data-small="yes"]`, SMALL_BUILDING_WIDTH_MM, m))
    }
  }
  return rules.join('\n')
}
