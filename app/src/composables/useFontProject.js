/**
 * useFontProject.js
 *
 * Shared reactive state for the MinFont vertical. Exports glyph map, metrics,
 * settings, detected font info and project name. All views read and write the
 * same instances without prop-drilling or Pinia. Reset with resetFontProject().
 */

import { ref, reactive } from 'vue'

// ─── Glyph character set ───────────────────────────────────────────────────

export const GLYPH_GROUPS = {
  upper:  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ'],
  lower:  [...'abcdefghijklmnopqrstuvwxyzæøå'],
  digits: [...'0123456789'],
  punct:  [...'.,;:!?-–—\'"()[]{}/@#%$€&*+=<>^~\\/'],
}

export const ALL_GLYPHS = [
  ...GLYPH_GROUPS.upper,
  ...GLYPH_GROUPS.lower,
  ...GLYPH_GROUPS.digits,
  ...GLYPH_GROUPS.punct,
]

// ─── Reactive state ────────────────────────────────────────────────────────

export const fontName = ref('MinFont')
export const detectedFontInfo = ref(null)

// Map<char, {pathD, advanceWidth, status: 'empty'|'auto'|'traced'|'edited'}>
export const glyphs = reactive({})

export const fontMetrics = reactive({
  unitsPerEm: 1000,
  ascender:    800,
  descender:  -200,
  xHeight:     500,
  capHeight:   700,
  defaultAdvanceWidth: 600,
})

export const fontSettings = reactive({
  tracking: 0,
  skewDeg:  0,
  weight:   400,  // 100–900
  italic:   0,    // 0=normal, 1=italic
})

// ─── Helpers ───────────────────────────────────────────────────────────────

export function canExportFont() {
  return Object.values(glyphs).some(g => g && g.status !== 'empty' && g.pathD)
}

export function glyphStats() {
  let edited = 0, traced = 0, auto = 0, empty = 0
  for (const c of ALL_GLYPHS) {
    const g = glyphs[c]
    if (!g || g.status === 'empty') { empty++; continue }
    if (g.status === 'edited') edited++
    else if (g.status === 'traced') traced++
    else if (g.status === 'auto') auto++
  }
  return { edited, traced, auto, empty, total: ALL_GLYPHS.length }
}

export function setGlyphPath(char, pathD, advanceWidth, status = 'traced') {
  glyphs[char] = {
    pathD,
    advanceWidth: advanceWidth || fontMetrics.defaultAdvanceWidth,
    status,
  }
}

export function resetFontProject() {
  fontName.value = 'MinFont'
  detectedFontInfo.value = null
  for (const key of Object.keys(glyphs)) delete glyphs[key]
  Object.assign(fontMetrics, {
    unitsPerEm:  1000,
    ascender:     800,
    descender:   -200,
    xHeight:      500,
    capHeight:    700,
    defaultAdvanceWidth: 600,
  })
  Object.assign(fontSettings, {
    tracking: 0,
    skewDeg:  0,
    weight:   400,
    italic:   0,
  })
}
