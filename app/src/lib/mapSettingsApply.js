// String-basert påføring av visnings-innstillinger på en kart-SVG — den
// statiske ekvivalenten til det en ekspert-bruker gjør i MapViews drawer
// (Kartlag-fanen, presets, Strek-knotten og Strek-FAB-panelet). Appen endrer
// live-DOM (style.display, --stroke-scale, injisert override-CSS); denne
// modulen gjør NØYAKTIG samme valg om til en <style>-blokk som bakes inn i
// SVG-teksten, så MCP-serveren kan levere ferdig justerte kart uten DOM.
//
// Vokabularet deles med UI-et: lag-nøkler/presets fra mapLayerCatalog.js,
// strek-grupper fra strokeOverrides.js. Kall er idempotente — en eksisterende
// innstillings-blokk byttes ut, den stables ikke.

import {
  LAYERS, DEFAULT_VISIBLE_LAYER_KEYS, LAYER_PRESETS,
} from './mapLayerCatalog.js'
import { buildStrokeOverrideCss, STROKE_GROUPS } from './strokeOverrides.js'

export const SETTINGS_STYLE_ID = 'kart-innstillinger'

const LAYER_KEY_SET = new Set(LAYERS.map((l) => l.key))
// 'dybde' er MapViews spesial-toggle (Sjøkart-dybde på hovedkartet) — ikke et
// LAYERS-lag, men gyldig i presets (Padling) og som lag-overstyring.
const EXTRA_KEYS = new Set(['dybde'])

/**
 * Regn ut hvilke lag som er synlige gitt preset + per-lag-overstyringer —
 * samme semantikk som drawer-en: preset (eller default-synligheten) er
 * utgangspunktet, `lag` skrur enkelt-lag av/på oppå det.
 *
 * @param {{preset?: string, lag?: Record<string, boolean>}} settings
 * @returns {Set<string>} synlige lag-nøkler
 */
export function resolveVisibleLayers(settings = {}) {
  const { preset, lag = {} } = settings
  let visible
  if (preset) {
    const p = LAYER_PRESETS.find((x) => x.key === preset)
    if (!p) {
      const known = LAYER_PRESETS.map((x) => x.key).join(', ')
      throw new Error(`Ukjent preset «${preset}» — gyldige: ${known}`)
    }
    visible = new Set(p.keys)
  } else {
    visible = new Set(DEFAULT_VISIBLE_LAYER_KEYS)
  }
  for (const [key, on] of Object.entries(lag)) {
    if (!LAYER_KEY_SET.has(key) && !EXTRA_KEYS.has(key)) {
      const known = [...LAYER_KEY_SET, ...EXTRA_KEYS].join(', ')
      throw new Error(`Ukjent lag «${key}» — gyldige: ${known}`)
    }
    if (on) visible.add(key)
    else visible.delete(key)
  }
  return visible
}

/**
 * Bygg CSS-en som realiserer innstillingene. Skjulte lag får display:none
 * (også spøkelses-fliser via data-ghost-layer, som i applyLayerVisibility);
 * 'navn' av skjuler i tillegg tall-labels inne i andre lag (kontur-tall,
 * vann-moh) — samme spesialtilfelle som drawer-en. 'dybde' på tvinger frem de
 * skjulte detalj-lagene (dybdepunkt/dybdekurve har inline display:none fra
 * bygging, derfor !important + display:inline).
 *
 * @param {{
 *   preset?: string,
 *   lag?: Record<string, boolean>,
 *   strekSkala?: number,
 *   strek?: Record<string, number>,
 * }} settings
 * @returns {string} CSS (kan være tom — nøytrale innstillinger gir ingen regler)
 */
export function buildSettingsCss(settings = {}) {
  const rules = []
  const visible = resolveVisibleLayers(settings)

  for (const l of LAYERS) {
    if (visible.has(l.key)) continue
    rules.push(
      `.isom-map [data-layer="${l.key}"], .isom-map [data-ghost-layer="${l.key}"] { display: none !important; }`,
    )
  }
  if (!visible.has('navn')) {
    rules.push('.isom-map [data-label]:not([data-label="stedsnavn"]) { display: none !important; }')
  }
  if (visible.has('dybde')) {
    rules.push('.isom-map [data-layer="dybdepunkt"], .isom-map [data-layer="dybdekurve"] { display: inline !important; }')
  }

  const { strekSkala, strek } = settings
  if (Number.isFinite(strekSkala) && strekSkala > 0 && strekSkala !== 1) {
    rules.push(`.isom-map { --stroke-scale: ${Number(strekSkala.toFixed(3))}; }`)
  }
  if (strek) {
    const known = new Set(STROKE_GROUPS.map((g) => g.id))
    for (const id of Object.keys(strek)) {
      if (!known.has(id)) {
        throw new Error(`Ukjent strek-gruppe «${id}» — gyldige: ${[...known].join(', ')}`)
      }
    }
    const overrideCss = buildStrokeOverrideCss(strek)
    if (overrideCss) rules.push(overrideCss)
  }
  return rules.join('\n')
}

const STYLE_BLOCK_RE = new RegExp(
  `<style id="${SETTINGS_STYLE_ID}">[\\s\\S]*?</style>\\n?`, 'g',
)

/**
 * Påfør innstillinger på en kart-SVG-streng: injiser (eller bytt ut)
 * <style id="kart-innstillinger"> rett før </svg>. Nøytrale innstillinger
 * fjerner en eventuell eksisterende blokk og returnerer ellers uendret SVG.
 *
 * @param {string} svgText
 * @param {Parameters<typeof buildSettingsCss>[0]} settings
 * @returns {string}
 */
export function applyMapSettings(svgText, settings = {}) {
  const css = buildSettingsCss(settings)
  const stripped = svgText.replace(STYLE_BLOCK_RE, '')
  if (!css) return stripped
  const block = `<style id="${SETTINGS_STYLE_ID}">\n${css}\n</style>\n`
  const idx = stripped.lastIndexOf('</svg>')
  if (idx === -1) return stripped + block
  return stripped.slice(0, idx) + block + stripped.slice(idx)
}
