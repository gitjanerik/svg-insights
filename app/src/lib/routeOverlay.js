// Rute-overlay som SVG-markup. Delt kjerne som tegner et stiforslag i samme
// stil som Stifinner-laget i MapView (hvit halo + farget linje, stiplet grå
// connector, grønn start / rød mål), men som en ren streng — så MCP-serveren
// (tegn_rute_svg) kan bake et ferdig stiforslag inn i en statisk kart-SVG uten
// et levende DOM. Koordinater er i kartets SVG-meter-rom.

import { polylineToPath } from './pathUtils.js'

// Farger pr rute-indeks (rød, lilla, cyan) — matcher ROUTE_COLORS i MapView.
export const ROUTE_COLORS = ['#dc2626', '#7c3aed', '#0891b2']

// Standard strekbredder i SVG-meter (kartet er ~5 km bredt → disse leses greit
// på full utstrekning). Overstyrbart via `style` for større/mindre kart.
//
// Både valgt og alternativ er semitransparente — den valgte skiller seg kun med
// litt mer bredde/opasitet, ikke ved å være en tykk, opak blokk (tidligere lå
// den valgte på 13/26 px @ opasitet 1 og druknet resten).
export const DEFAULT_OVERLAY_STYLE = {
  lineSelected: 9, lineOther: 8,
  haloSelected: 18, haloOther: 16,
  routeOpacitySelected: 0.72, routeOpacityOther: 0.55,
  haloOpacitySelected: 0.6, haloOpacityOther: 0.5,
  connector: 8, connectorDash: 24,
  dot: 34, dotStroke: 10, fontSize: 86, labelStroke: 16,
}

const num = (v) => Number(v).toFixed(1)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Bygg et `<g data-layer="stiforslag">`-element som tegner ruter, connector-
 * streker og markører.
 *
 * @param {{
 *   routes?: Array<{coordinates: Array<[number,number]>, shortest?: boolean}>,
 *   selectedIndex?: number,
 *   connectors?: Array<{from:[number,number], to:[number,number]} | [[number,number],[number,number]]>,
 *   markers?: Array<{x:number, y:number, color?:string, label?:string, anchor?:'start'|'end', labelDx?:number}>,
 *   start?: [number,number], dest?: [number,number],
 *   style?: Partial<typeof DEFAULT_OVERLAY_STYLE>,
 * }} opts
 * @returns {string} `<g>…</g>`
 */
export function buildRouteOverlaySvg(opts = {}) {
  const {
    routes = [], selectedIndex = 0,
    connectors = [], markers = [], start, dest, style = {},
  } = opts
  const s = { ...DEFAULT_OVERLAY_STYLE, ...style }
  const parts = []

  // Connector-streker (valgt punkt → snappet node): stiplet grå, under rutene.
  for (const c of connectors) {
    const from = c.from ?? c[0], to = c.to ?? c[1]
    if (!from || !to) continue
    parts.push(
      `<path d="M${num(from[0])},${num(from[1])}L${num(to[0])},${num(to[1])}" fill="none" ` +
      `stroke="#64748b" stroke-width="${s.connector}" stroke-linecap="round" ` +
      `stroke-dasharray="${s.connectorDash} ${s.connectorDash}" opacity="0.85"/>`
    )
  }

  // Rutene: ikke-valgte under, valgt øverst (samme z-orden som MapView).
  const order = routes.map((_, i) => i)
    .sort((i, j) => (i === selectedIndex ? 1 : 0) - (j === selectedIndex ? 1 : 0))
  for (const i of order) {
    const r = routes[i]
    if (!r?.coordinates?.length) continue
    const d = polylineToPath(r.coordinates, false)
    const selected = i === selectedIndex
    const color = ROUTE_COLORS[i % ROUTE_COLORS.length]
    const halo = selected ? s.haloSelected : s.haloOther
    const line = selected ? s.lineSelected : s.lineOther
    const haloOp = selected ? s.haloOpacitySelected : s.haloOpacityOther
    const lineOp = selected ? s.routeOpacitySelected : s.routeOpacityOther
    parts.push(
      `<path d="${d}" fill="none" stroke="rgba(255,255,255,0.95)" ` +
      `stroke-width="${halo}" stroke-linecap="round" ` +
      `stroke-linejoin="round" opacity="${haloOp}"/>`
    )
    parts.push(
      `<path d="${d}" fill="none" stroke="${color}" ` +
      `stroke-width="${line}" stroke-linecap="round" ` +
      `stroke-linejoin="round" opacity="${lineOp}"/>`
    )
  }

  const dot = (x, y, fill) =>
    `<circle cx="${num(x)}" cy="${num(y)}" r="${s.dot}" fill="${fill}" stroke="#fff" stroke-width="${s.dotStroke}"/>`
  const label = (x, y, t, anchor, labelDx) => {
    const dx = labelDx ?? (anchor === 'end' ? -s.dot * 1.6 : s.dot * 1.6)
    return (
      `<text x="${num(x + dx)}" y="${num(y + s.fontSize * 0.2)}" font-family="sans-serif" ` +
      `font-size="${s.fontSize}" font-weight="700" text-anchor="${anchor}" fill="#0f172a" ` +
      `stroke="#fff" stroke-width="${s.labelStroke}" paint-order="stroke" ` +
      `style="paint-order:stroke">${esc(t)}</text>`
    )
  }

  for (const m of markers) {
    parts.push(dot(m.x, m.y, m.color ?? '#dc2626'))
    if (m.label) parts.push(label(m.x, m.y, m.label, m.anchor ?? 'start', m.labelDx))
  }
  if (start) parts.push(dot(start[0], start[1], '#16a34a'))
  if (dest) parts.push(dot(dest[0], dest[1], '#dc2626'))

  return `<g data-layer="stiforslag" pointer-events="none">${parts.join('')}</g>`
}

/**
 * Sett inn et overlay-`<g>` rett før `</svg>` i en kart-SVG-streng.
 * @param {string} svgText
 * @param {string} overlayGroup
 * @returns {string}
 */
export function injectOverlay(svgText, overlayGroup) {
  const idx = svgText.lastIndexOf('</svg>')
  if (idx === -1) return svgText + overlayGroup
  return svgText.slice(0, idx) + overlayGroup + '\n' + svgText.slice(idx)
}
