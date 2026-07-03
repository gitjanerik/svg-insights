// Stilisert SVG-eksport av en planlagt grusrute (v12.1.14) — «SVG-alibiet»:
// en selvstendig, delbar plakat-SVG med rutegeometrien (fargekodet grus/
// asfalt), A/B-markører, nøkkeltall, grus/asfalt-bar og (når tilgjengelig)
// høydeprofil. Ren strengbygging uten DOM så den kan enhetstestes; nedlasting
// skjer via blob (samme mønster som gpxExport).

import { profileToPathData } from './routeElevation.js'

const W = 800
const MARGIN = 56
const C = {
  bg: '#0e1116',
  panel: '#151a22',
  hairline: 'rgba(255,255,255,0.10)',
  gravel: '#e8802b',
  paved: '#94a3b8',
  textStrong: '#f4f4f5',
  text: 'rgba(255,255,255,0.72)',
  muted: 'rgba(255,255,255,0.45)',
  a: '#10b981',
  b: '#f43f5e',
}
const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]))
}

function fmtKm(m) {
  if (m == null) return '–'
  const km = m / 1000
  return km >= 100 ? km.toFixed(0) : km.toFixed(1)
}

function fmtTid(s) {
  if (!s) return null
  const min = Math.round(s / 60)
  const t = Math.floor(min / 60)
  return t > 0 ? `${t} t ${String(min % 60).padStart(2, '0')} min` : `${min} min`
}

// Ruta i [lon, lat]-grader → path-punkter i en boks, ekvirektangulær med
// cos(midlat)-korrigert lengdegrad (formriktig nok på rute-skala), sentrert
// og skalert med bevart aspekt.
function fitProjection(points, box) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  const kx = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180)
  const spanX = Math.max((maxLon - minLon) * kx, 1e-9)
  const spanY = Math.max(maxLat - minLat, 1e-9)
  const scale = Math.min(box.w / spanX, box.h / spanY)
  const ox = box.x0 + (box.w - spanX * scale) / 2
  const oy = box.y0 + (box.h - spanY * scale) / 2
  return ([lon, lat]) => ({
    x: ox + (lon - minLon) * kx * scale,
    y: oy + (maxLat - lat) * scale,
  })
}

function routeSegmentPaths(route, project) {
  const toStr = (p) => { const q = project(p); return `${q.x.toFixed(1)} ${q.y.toFixed(1)}` }
  if (!route.segments) {
    return [{ gravel: true, d: 'M' + route.points.map(toStr).join(' L') }]
  }
  return route.segments
    .filter((s) => s.toIdx > s.fromIdx)
    .map((s) => ({
      gravel: s.gravel,
      d: 'M' + route.points.slice(s.fromIdx, s.toIdx + 1).map(toStr).join(' L'),
    }))
}

/**
 * Bygg plakat-SVG-en som tekst. `route` er planner-tilstanden (points,
 * segments|null, lengthM, gravelShare, estimatedTimeS, navn, waypoints);
 * `profile` er buildRouteProfile-resultat eller null (seksjonen droppes da).
 */
export function buildRouteSvg(route, { profile = null, now = Date.now() } = {}) {
  if (!route?.points?.length) return ''
  const parts = []
  let y = 0

  // ── Topptekst ──────────────────────────────────────────────────────────
  y = 78
  parts.push(`<text x="${MARGIN}" y="${y}" font-size="12" letter-spacing="3" fill="${C.muted}">SVG INSIGHTS · RUTEPLANLEGGER</text>`)
  y += 40
  const navn = route.navn || 'Grusrute'
  const title = navn.length > 38 ? navn.slice(0, 37) + '…' : navn
  parts.push(`<text x="${MARGIN}" y="${y}" font-size="30" font-weight="700" fill="${C.textStrong}">${escapeXml(title)}</text>`)
  y += 28
  const dato = new Date(now).toLocaleDateString('no-NO', { day: 'numeric', month: 'long', year: 'numeric' })
  parts.push(`<text x="${MARGIN}" y="${y}" font-size="13" fill="${C.muted}">${escapeXml(dato)}</text>`)

  // ── Kart-panel med ruta ────────────────────────────────────────────────
  y += 24
  const panel = { x0: MARGIN, y0: y, w: W - 2 * MARGIN, h: 430 }
  parts.push(`<rect x="${panel.x0}" y="${panel.y0}" width="${panel.w}" height="${panel.h}" rx="16" fill="${C.panel}" stroke="${C.hairline}"/>`)
  const inner = { x0: panel.x0 + 36, y0: panel.y0 + 36, w: panel.w - 72, h: panel.h - 72 }
  const project = fitProjection(route.points, inner)
  const segs = routeSegmentPaths(route, project)
  for (const s of segs) {
    parts.push(`<path d="${s.d}" fill="none" stroke="${C.bg}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`)
  }
  for (const s of segs) {
    parts.push(`<path d="${s.d}" fill="none" stroke="${s.gravel ? C.gravel : C.paved}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`)
  }
  const pA = project(route.points[0])
  const pB = project(route.points[route.points.length - 1])
  for (const [p, farge, bokstav] of [[pA, C.a, 'A'], [pB, C.b, 'B']]) {
    parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="13" fill="${farge}" stroke="#ffffff" stroke-width="2.5"/>`)
    parts.push(`<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" dy="4.5" text-anchor="middle" font-size="13" font-weight="700" fill="#ffffff">${bokstav}</text>`)
  }
  y = panel.y0 + panel.h

  // ── Nøkkeltall ─────────────────────────────────────────────────────────
  y += 52
  const stats = [
    ['Lengde', `${fmtKm(route.lengthM)} km`],
    ['Grus', route.gravelShare != null ? `${Math.round(route.gravelShare * 100)} %` : '–'],
    ['Estimert tid', fmtTid(route.estimatedTimeS) ?? '–'],
  ]
  const colW = (W - 2 * MARGIN) / stats.length
  stats.forEach(([label, verdi], i) => {
    const x = MARGIN + i * colW
    parts.push(`<text x="${x}" y="${y}" font-size="12" letter-spacing="1" fill="${C.muted}">${escapeXml(label.toUpperCase())}</text>`)
    parts.push(`<text x="${x}" y="${y + 30}" font-size="26" font-weight="700" fill="${C.textStrong}">${escapeXml(verdi)}</text>`)
  })
  y += 30

  // ── Grus/asfalt-bar ────────────────────────────────────────────────────
  if (route.gravelShare != null) {
    y += 36
    const barW = W - 2 * MARGIN
    const gw = Math.round(barW * route.gravelShare)
    parts.push(`<clipPath id="bar-clip"><rect x="${MARGIN}" y="${y}" width="${barW}" height="12" rx="6"/></clipPath>`)
    parts.push(`<g clip-path="url(#bar-clip)">` +
      `<rect x="${MARGIN}" y="${y}" width="${barW}" height="12" fill="${C.paved}"/>` +
      `<rect x="${MARGIN}" y="${y}" width="${gw}" height="12" fill="${C.gravel}"/></g>`)
    y += 30
    parts.push(`<text x="${MARGIN}" y="${y}" font-size="12" fill="${C.text}">Grus ${Math.round(route.gravelShare * 100)} %</text>`)
    parts.push(`<text x="${W - MARGIN}" y="${y}" text-anchor="end" font-size="12" fill="${C.text}">Asfalt ${Math.round((1 - route.gravelShare) * 100)} %</text>`)
  }

  // ── Høydeprofil ────────────────────────────────────────────────────────
  if (profile?.samples?.length >= 2) {
    y += 46
    parts.push(`<text x="${MARGIN}" y="${y}" font-size="12" letter-spacing="1" fill="${C.muted}">HØYDEPROFIL</text>`)
    parts.push(`<text x="${W - MARGIN}" y="${y}" text-anchor="end" font-size="12" fill="${C.text}">↗ ${profile.ascentM} m · ↘ ${profile.descentM} m</text>`)
    y += 14
    const chart = { x0: MARGIN, y0: y, w: W - 2 * MARGIN, h: 150 }
    const g = profileToPathData(profile, chart)
    parts.push(`<path d="${g.areaD}" fill="rgba(255,255,255,0.07)"/>`)
    for (const run of g.runs) {
      parts.push(`<path d="${run.d}" fill="none" stroke="${run.gravel ? C.gravel : C.paved}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`)
    }
    const baseY = chart.y0 + chart.h
    parts.push(`<line x1="${chart.x0}" y1="${baseY}" x2="${chart.x0 + chart.w}" y2="${baseY}" stroke="${C.hairline}"/>`)
    parts.push(`<text x="${chart.x0}" y="${baseY + 18}" font-size="11" fill="${C.muted}">${g.eleFloor} moh</text>`)
    parts.push(`<text x="${W - MARGIN}" y="${baseY + 18}" text-anchor="end" font-size="11" fill="${C.muted}">høyeste ${Math.round(profile.maxEle)} moh</text>`)
    y = baseY + 24
  }

  // ── Bunntekst ──────────────────────────────────────────────────────────
  y += 46
  parts.push(`<line x1="${MARGIN}" y1="${y - 22}" x2="${W - MARGIN}" y2="${y - 22}" stroke="${C.hairline}"/>`)
  parts.push(`<text x="${MARGIN}" y="${y}" font-size="10.5" fill="${C.muted}">© OpenStreetMap-bidragsytere · Ruting: BRouter (brouter.de)</text>`)
  parts.push(`<text x="${W - MARGIN}" y="${y}" text-anchor="end" font-size="10.5" fill="${C.muted}">svg-insights</text>`)
  const H = y + MARGIN / 2

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">
<rect width="${W}" height="${H}" fill="${C.bg}"/>
${parts.join('\n')}
</svg>
`
}

/** Last ned plakat-SVG-en i nettleseren (samme blob-mønster som GPX). */
export function downloadRouteSvg(route, { profile = null } = {}) {
  const text = buildRouteSvg(route, { profile })
  if (!text) return
  const blob = new Blob([text], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(route.navn || 'grusrute').replace(/[^a-z0-9æøå]+/gi, '-').toLowerCase()}.svg`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
