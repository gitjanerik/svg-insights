import { describe, it, expect } from 'vitest'
import {
  resolveVisibleLayers, buildSettingsCss, applyMapSettings, SETTINGS_STYLE_ID,
  buildThemeCss, listThemes,
} from './mapSettingsApply.js'
import {
  LAYERS, ALL_LAYER_KEYS, DEFAULT_VISIBLE_LAYER_KEYS, DEFAULT_OFF_LAYERS,
  LAYER_PRESETS, MARINE_LAYER_KEYS,
} from './mapLayerCatalog.js'

const SVG = '<svg class="isom-map"><g data-layer="kontur"/><g data-layer="sti"/></svg>'

describe('mapLayerCatalog', () => {
  it('har unike lag-nøkler og etiketter på alle lag', () => {
    const keys = LAYERS.map((l) => l.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const l of LAYERS) expect(l.label).toBeTruthy()
  })

  it('preset-nøkler peker på ekte lag (kun «dybde» er pseudo)', () => {
    const known = new Set([...ALL_LAYER_KEYS, 'dybde'])
    for (const p of LAYER_PRESETS) {
      for (const k of p.keys) expect(known.has(k), `${p.key}: ${k}`).toBe(true)
    }
  })

  it('default-synlighet = alle lag minus DEFAULT_OFF_LAYERS', () => {
    expect(DEFAULT_VISIBLE_LAYER_KEYS.length).toBe(LAYERS.length - DEFAULT_OFF_LAYERS.size)
    for (const k of DEFAULT_OFF_LAYERS) expect(DEFAULT_VISIBLE_LAYER_KEYS).not.toContain(k)
  })

  it('marine lag finnes i katalogen', () => {
    for (const k of MARINE_LAYER_KEYS) expect(ALL_LAYER_KEYS).toContain(k)
  })
})

describe('resolveVisibleLayers', () => {
  it('default: alt unntatt DEFAULT_OFF_LAYERS', () => {
    const v = resolveVisibleLayers()
    expect(v.has('kontur')).toBe(true)
    expect(v.has('lysloype')).toBe(false)
  })

  it('preset gir presetets lag-sett', () => {
    const v = resolveVisibleLayers({ preset: 'tur' })
    expect(v.has('sti')).toBe(true)
    expect(v.has('sjo-poi')).toBe(false)
  })

  it('lag-overstyring vinner over preset', () => {
    const v = resolveVisibleLayers({ preset: 'tur', lag: { kontur: false, 'sjo-poi': true } })
    expect(v.has('kontur')).toBe(false)
    expect(v.has('sjo-poi')).toBe(true)
  })

  it('kaster på ukjent preset og ukjent lag', () => {
    expect(() => resolveVisibleLayers({ preset: 'tull' })).toThrow(/Ukjent preset/)
    expect(() => resolveVisibleLayers({ lag: { finnesIkke: true } })).toThrow(/Ukjent lag/)
  })
})

describe('buildSettingsCss', () => {
  it('default-innstillinger speiler appens default-visning (kun lysloype skjult)', () => {
    const css = buildSettingsCss()
    expect(css).toContain('[data-layer="lysloype"]')
    expect(css).not.toContain('[data-layer="kontur"]')
  })

  it('alt synlig gir tom CSS', () => {
    expect(buildSettingsCss({ lag: { lysloype: true }, strekSkala: 1 })).toBe('')
  })

  it('lag av → display:none-regel scoped til .isom-map (også ghost-fliser)', () => {
    const css = buildSettingsCss({ lag: { kontur: false } })
    expect(css).toContain('.isom-map [data-layer="kontur"]')
    expect(css).toContain('[data-ghost-layer="kontur"]')
    expect(css).toContain('display: none !important')
    expect(css).not.toContain('[data-layer="sti"]')
  })

  it('navn av skjuler også tall-labels (drawer-ens spesialtilfelle)', () => {
    const css = buildSettingsCss({ lag: { navn: false } })
    expect(css).toContain('[data-label]:not([data-label="stedsnavn"])')
  })

  it('dybde på tvinger frem detalj-lagene', () => {
    const css = buildSettingsCss({ lag: { dybde: true } })
    expect(css).toContain('[data-layer="dybdepunkt"]')
    expect(css).toContain('display: inline !important')
  })

  it('strekSkala setter --stroke-scale', () => {
    expect(buildSettingsCss({ strekSkala: 0.6 })).toContain('--stroke-scale: 0.6')
  })

  it('strek-gruppe gir override-regel med multiplikator; ukjent gruppe kaster', () => {
    const css = buildSettingsCss({ strek: { sti: 0.5 } })
    expect(css).toContain('[data-iso="505"]')
    expect(css).toContain('* 0.5')
    expect(() => buildSettingsCss({ strek: { tull: 2 } })).toThrow(/Ukjent strek-gruppe/)
  })
})

describe('tema', () => {
  it('listThemes returnerer alle katalog-temaer med etikett og beskrivelse', () => {
    const themes = listThemes()
    const keys = themes.map((t) => t.key)
    for (const k of ['light', 'dark', 'mono-sepia', 'mono-indigo', 'mono-slate', 'mocha', 'forest', 'curves']) {
      expect(keys).toContain(k)
    }
    for (const t of themes) {
      expect(t.label).toBeTruthy()
      expect(t.beskrivelse).toBeTruthy()
    }
    expect(themes.find((t) => t.key === 'curves').autoHideLayers).toBe(true)
    expect(themes.find((t) => t.key === 'dark').autoHideLayers).toBe(false)
  })

  it('light = katalog-defaults → ingen CSS', () => {
    expect(buildThemeCss('light')).toBe('')
  })

  it('dark setter samme CSS-variabler som appens applyTheme', () => {
    const css = buildThemeCss('dark')
    expect(css).toContain('--bg: #2a1f15')
    expect(css).toContain('--iso-101-stroke: #f0c275')
    expect(css).toContain('--art-fill-opacity: 0.85')
    expect(css).toContain('--iso-depth-1: #356f8c')
    expect(css).toContain('--label-place-fill: #e8e0d0')
    expect(css.startsWith('.isom-map {')).toBe(true)
  })

  it('ukjent tema kaster med liste over gyldige', () => {
    expect(() => buildThemeCss('neon')).toThrow(/Ukjent tema .*curves/)
  })

  it('curves auto-skjuler alle lag unntatt høydekurver (gul)', () => {
    const v = resolveVisibleLayers({ tema: 'curves' })
    expect([...v]).toEqual(['kontur'])
    const css = buildSettingsCss({ tema: 'curves' })
    expect(css).toContain('--iso-101-stroke: #ffd84a')
    expect(css).toContain('[data-layer="sti"]')
    expect(css).toContain('[data-layer="vann"]')
    expect(css).not.toContain('[data-layer="kontur"], ')
  })

  it('lag-overstyring og preset vinner over curves-basen', () => {
    const medVann = resolveVisibleLayers({ tema: 'curves', lag: { vann: true } })
    expect(medVann.has('vann')).toBe(true)
    expect(medVann.has('sti')).toBe(false)
    const medPreset = resolveVisibleLayers({ tema: 'curves', preset: 'tur' })
    expect(medPreset.has('sti')).toBe(true)
  })

  it('vanlig tema (dark) endrer ikke lag-synligheten', () => {
    const v = resolveVisibleLayers({ tema: 'dark' })
    expect(v.has('sti')).toBe(true)
    expect(v.has('kontur')).toBe(true)
  })
})

describe('applyMapSettings', () => {
  it('injiserer style-blokk før </svg>', () => {
    const out = applyMapSettings(SVG, { lag: { kontur: false } })
    expect(out).toContain(`<style id="${SETTINGS_STYLE_ID}">`)
    expect(out.indexOf('</svg>')).toBeGreaterThan(out.indexOf(SETTINGS_STYLE_ID))
  })

  it('er idempotent — ny påføring erstatter gammel blokk', () => {
    const once = applyMapSettings(SVG, { lag: { kontur: false } })
    const twice = applyMapSettings(once, { lag: { sti: false } })
    expect(twice.match(new RegExp(SETTINGS_STYLE_ID, 'g')).length).toBe(1)
    expect(twice).toContain('data-layer="sti"')
    expect(twice).not.toContain('.isom-map [data-layer="kontur"]')
  })

  it('alt-synlig-innstillinger fjerner eksisterende blokk og lar SVG-en ellers stå', () => {
    const allOn = { lag: { lysloype: true } }
    const once = applyMapSettings(SVG, { lag: { kontur: false } })
    expect(applyMapSettings(once, allOn)).toBe(SVG)
    expect(applyMapSettings(SVG, allOn)).toBe(SVG)
  })
})
