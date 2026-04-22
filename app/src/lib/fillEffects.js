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
// Rounds corners geometrically by rewriting each fill-region path: every
// L-to-L corner becomes L(shorter) → Q(corner,shorter) → L continuation.
// Deterministic, crisp, and previews identically in every renderer.
//
// amount ∈ [0, 1]: 0 = no rounding, 1 = corners rounded up to ~40% of edge
export function applyFillRounding(svgString, amount = 0.5) {
  if (amount <= 0) return svgString
  const frac = Math.min(0.45, amount * 0.45)  // fraction of edge to bevel

  const pathRe = /(<path\b[^>]*class="[^"]*fill-region[^"]*"[^>]*\bd\s*=\s*")([^"]+)("[^>]*\/?>)/gi
  return svgString.replace(pathRe, (_m, pre, d, post) => {
    return pre + roundPathCorners(d, frac) + post
  })
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

/** Inject `<filter>` defs and apply the filter to the .fills group. */
function injectDefsAndApply(svgString, defsContent, filterId) {
  let out = injectDefsBlock(svgString, defsContent)

  // Apply the filter to <g class="fills"...>
  const fillsGRe = /(<g\b[^>]*class="[^"]*fills[^"]*"[^>]*)>/i
  out = out.replace(fillsGRe, (_m, openTag) => {
    // Remove any previous fill-* filter attribute to avoid stacking
    const cleaned = openTag.replace(/\s*filter\s*=\s*"url\(#fill-[^)]+\)"/gi, '')
    return `${cleaned} filter="url(#${filterId})">`
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

/**
 * Rewrite a `d` attribute so every polyline corner is replaced with a Q-curve.
 * For each triplet of consecutive points (A, B, C), the corner at B is
 * replaced by: line from A to (B − t·AB̂), then Q(B, B + t·BĈ), where
 * t = frac · min(|AB|, |BC|). This produces crisp rounded corners that
 * scale with edge length — short edges get less rounding automatically.
 *
 * Only handles M/L/Z subpaths (which is what insertFills produces for
 * flood-filled regions). Leaves anything with C/Q/S/A untouched.
 */
function roundPathCorners(d, frac) {
  // Parse into subpaths of points
  const tokens = d.match(/[MLHVZmlhvz]|-?\d+(?:\.\d+)?/g) || []
  const subpaths = []
  let current = null
  let cx = 0, cy = 0

  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === 'M' || t === 'm') {
      const x = parseFloat(tokens[i + 1]), y = parseFloat(tokens[i + 2])
      cx = t === 'm' && current ? cx + x : x
      cy = t === 'm' && current ? cy + y : y
      current = { points: [[cx, cy]], closed: false }
      subpaths.push(current)
      i += 3
    } else if (t === 'L' || t === 'l') {
      const x = parseFloat(tokens[i + 1]), y = parseFloat(tokens[i + 2])
      cx = t === 'l' ? cx + x : x
      cy = t === 'l' ? cy + y : y
      current.points.push([cx, cy])
      i += 3
    } else if (t === 'Z' || t === 'z') {
      if (current) current.closed = true
      i += 1
    } else if (t === 'H' || t === 'h') {
      const x = parseFloat(tokens[i + 1])
      cx = t === 'h' ? cx + x : x
      current.points.push([cx, cy])
      i += 2
    } else if (t === 'V' || t === 'v') {
      const y = parseFloat(tokens[i + 1])
      cy = t === 'v' ? cy + y : y
      current.points.push([cx, cy])
      i += 2
    } else {
      // Unknown command — bail out, return original d
      return d
    }
  }

  // Build output with rounded corners
  const parts = []
  for (const sp of subpaths) {
    const pts = sp.points
    const n = pts.length
    if (n < 3) {
      // Not enough points to round
      parts.push(pathFromPoints(pts, sp.closed))
      continue
    }

    const out = []
    const getPrev = (idx) => sp.closed ? pts[(idx - 1 + n) % n] : pts[Math.max(0, idx - 1)]
    const getNext = (idx) => sp.closed ? pts[(idx + 1) % n] : pts[Math.min(n - 1, idx + 1)]

    for (let k = 0; k < n; k++) {
      const B = pts[k]
      const A = getPrev(k)
      const C = getNext(k)
      const isEndpoint = !sp.closed && (k === 0 || k === n - 1)
      if (isEndpoint) {
        out.push({ type: 'L', pt: B })
        continue
      }
      const ab = [A[0] - B[0], A[1] - B[1]]
      const bc = [C[0] - B[0], C[1] - B[1]]
      const lenAB = Math.hypot(ab[0], ab[1])
      const lenBC = Math.hypot(bc[0], bc[1])
      const t = frac * Math.min(lenAB, lenBC)
      if (t < 0.5 || lenAB === 0 || lenBC === 0) {
        out.push({ type: 'L', pt: B })
        continue
      }
      const p1 = [B[0] + (ab[0] / lenAB) * t, B[1] + (ab[1] / lenAB) * t]
      const p2 = [B[0] + (bc[0] / lenBC) * t, B[1] + (bc[1] / lenBC) * t]
      out.push({ type: 'L', pt: p1 })
      out.push({ type: 'Q', ctrl: B, pt: p2 })
    }

    // Assemble: start with M, then sequence
    let s = ''
    const first = out[0]
    s += 'M' + fmt(first.pt)
    for (let k = 1; k < out.length; k++) {
      const o = out[k]
      if (o.type === 'L') s += 'L' + fmt(o.pt)
      else if (o.type === 'Q') s += 'Q' + fmt(o.ctrl) + ' ' + fmt(o.pt)
    }
    if (sp.closed) s += 'Z'
    parts.push(s)
  }
  return parts.join('')
}

function pathFromPoints(pts, closed) {
  if (!pts.length) return ''
  let s = 'M' + fmt(pts[0])
  for (let i = 1; i < pts.length; i++) s += 'L' + fmt(pts[i])
  if (closed) s += 'Z'
  return s
}

function fmt(pt) {
  return pt[0].toFixed(2) + ',' + pt[1].toFixed(2)
}
