/**
 * fillEffects.js — Reversible visual effects applied to the <g class="fills">
 * group produced by `insertFills`. All effects work by injecting SVG
 * `<filter>` definitions or transforming the fill paths directly.
 *
 * Keeping these separate from `colorization.js` means the fills pipeline
 * doesn't need to know about rendering effects, and toggling an effect off
 * simply means not calling the corresponding function.
 */

// ─── 1. Forenkling ────────────────────────────────────────────────────────
// "Simplifies" the coloured regions by morphological CLOSING (dilate then
// erode by the same amount) — small gaps between neighbouring fills fill
// in, but overall shape is preserved. No blur, no threshold tricks.
//
// amount ∈ [0, 1]: 0 = no merging, 1 = strong merging
export function applyFillSimplification(svgString, amount = 0.5) {
  if (amount <= 0) return svgString
  const radius = Math.max(0.5, amount * 4)

  const filterId = 'fill-simplify'
  const defs = `<filter id="${filterId}" x="-10%" y="-10%" width="120%" height="120%">
    <feMorphology operator="dilate" radius="${radius.toFixed(2)}"/>
    <feMorphology operator="erode" radius="${radius.toFixed(2)}"/>
  </filter>`

  return injectDefsAndApply(svgString, defs, filterId)
}

// ─── 2. Avrunding ─────────────────────────────────────────────────────────
// Softens sharp corners of fills using a morphological opening (erode then
// dilate by the same radius). Unlike Gaussian blur + threshold hacks, this
// is crisp, deterministic, and doesn't alter colour. Small concave corners
// get eaten by the erosion; the dilation restores the overall size.
//
// amount ∈ [0, 1]: 0 = no rounding, 1 = strong corner softening
export function applyFillRounding(svgString, amount = 0.5) {
  if (amount <= 0) return svgString
  const radius = Math.max(0.3, amount * 3)

  const filterId = 'fill-round'
  const defs = `<filter id="${filterId}" x="-10%" y="-10%" width="120%" height="120%">
    <feMorphology operator="erode" radius="${radius.toFixed(2)}"/>
    <feMorphology operator="dilate" radius="${radius.toFixed(2)}"/>
  </filter>`

  return injectDefsAndApply(svgString, defs, filterId)
}

// ─── 3. Gradient ──────────────────────────────────────────────────────────
// Replaces every `fill="#hex"` on .fill-region paths with a linear gradient
// that goes from the original colour to a lighter tint (or darker shade).
// amount ∈ [0, 1] controls the lightness offset: 0 = no gradient, 1 = ±40%
// lightness swing.
export function applyFillGradient(svgString, amount = 0.5) {
  if (amount <= 0) return svgString
  const swing = amount * 0.4      // fractional lightness swing
  const seenColors = new Map()    // colour → gradient id
  let gradCounter = 0

  // First pass: find all unique fill colours inside .fill-region paths and
  // generate a gradient id for each.
  const pathRe = /<path\b[^>]*class="[^"]*fill-region[^"]*"[^>]*>/gi
  const fillColorRe = /fill\s*=\s*"(#[0-9a-f]{3,8})"/i

  svgString.replace(pathRe, (tag) => {
    const m = tag.match(fillColorRe)
    if (m && !seenColors.has(m[1])) {
      seenColors.set(m[1], `grad-fill-${gradCounter++}`)
    }
    return tag
  })
  if (seenColors.size === 0) return svgString

  // Build <defs> with one linear gradient per unique colour
  const gradients = Array.from(seenColors.entries()).map(([hex, id]) => {
    const [r, g, b] = hexToRgb(hex)
    const lighter = rgbToHex(shiftLightness(r, g, b, +swing))
    const darker  = rgbToHex(shiftLightness(r, g, b, -swing * 0.5))
    return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${lighter}"/>
      <stop offset="100%" stop-color="${darker}"/>
    </linearGradient>`
  }).join('')

  const defsInjected = injectDefsBlock(svgString, gradients)

  // Second pass: replace fills on .fill-region paths to use url(#gradId)
  return defsInjected.replace(pathRe, (tag) => {
    return tag.replace(fillColorRe, (_, hex) => {
      const id = seenColors.get(hex)
      return id ? `fill="url(#${id})"` : `fill="${hex}"`
    })
  })
}

// ─── 4. Fragmentering ─────────────────────────────────────────────────────
// Mosaic / broken-glass effect on the fills group — uses feTurbulence +
// feDisplacementMap to shatter the edges.
//
// amount ∈ [0, 1]
export function applyFillFragmentation(svgString, amount = 0.5) {
  if (amount <= 0) return svgString
  const scale = amount * 15              // displacement magnitude
  const freq = (0.02 + amount * 0.1).toFixed(3)

  const filterId = 'fill-fragment'
  const defs = `<filter id="${filterId}" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="1"/>
    <feDisplacementMap in="SourceGraphic" scale="${scale.toFixed(1)}" xChannelSelector="R" yChannelSelector="G"/>
  </filter>`

  return injectDefsAndApply(svgString, defs, filterId)
}

// ─── Internal helpers ─────────────────────────────────────────────────────

/**
 * Inject a `<filter>` def and wrap the `.fills` group content with a NESTED
 * group that applies the filter. This lets us chain multiple fill effects
 * (simplify + round + fragment) — each becomes its own nested <g> with its
 * own filter attribute, which SVG evaluates in document order.
 *
 * First application: wraps .fills' children in <g filter="url(#X)">...</g>.
 * Subsequent applications: wrap the previously-wrapped content again.
 */
function injectDefsAndApply(svgString, defsContent, filterId) {
  let out = injectDefsBlock(svgString, defsContent)

  // Wrap the inside of <g class="fills">...</g> with a nested filter-group.
  // Regex captures: opening tag, inner content, closing tag.
  const fillsGroupRe = /(<g\b[^>]*class="[^"]*fills[^"]*"[^>]*>)([\s\S]*?)(<\/g>)/i
  out = out.replace(fillsGroupRe, (_m, openTag, inner, closeTag) => {
    return `${openTag}<g filter="url(#${filterId})">${inner}</g>${closeTag}`
  })
  return out
}

/** Insert a `<defs>` block (or augment existing) near the top of the SVG. */
function injectDefsBlock(svgString, newContent) {
  // Prefer adding to existing <defs>; otherwise create one after <svg ...>
  if (/<defs\b[^>]*>/.test(svgString)) {
    return svgString.replace(/<defs\b([^>]*)>/, (m) => m + newContent)
  }
  return svgString.replace(/(<svg\b[^>]*>)/, `$1<defs>${newContent}</defs>`)
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '')
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean.slice(0, 6)
  const n = parseInt(full, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function rgbToHex([r, g, b]) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return '#' + h(r) + h(g) + h(b)
}

function shiftLightness(r, g, b, amount) {
  // amount > 0 brightens toward white, < 0 darkens toward black
  if (amount >= 0) {
    return [r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]
  }
  const f = 1 + amount  // 0..1
  return [r * f, g * f, b * f]
}

