// Navngitte interessepunkter (POI) fra en generert kart-SVG. Kartet merker
// navn-etiketter med `data-label` (peak, hytte-navn, vann-navn, stedsnavn,
// omrade-navn, naturreservat-navn) — vi mapper dem til lesbare typer og lar
// MCP/appen slå opp «hva finnes på kartet» uten manuell koordinat-graving.
//
// Ren logikk her (klassifisering, lengde-parsing, dedup); selve DOM-vandringen
// som summerer forelder-transformer bor i mcp/headless.js (linkedom).

// data-label → lesbar POI-type.
export const POI_LABELS = {
  'peak': 'topp',
  'hytte-navn': 'hytte',
  'vann-navn': 'vann',
  'stedsnavn': 'sted',
  'omrade-navn': 'område',
  'naturreservat-navn': 'naturreservat',
}

export function poiType(dataLabel) {
  return POI_LABELS[dataLabel] ?? null
}

// Lengde i SVG-brukerenheter. Kartet blander «3775.7» (enheter) og «2mm»
// (etikett-offset). mm konverteres med `mmToUnit` (utledet fra rot-SVG:
// viewBox-bredde / bredde-i-mm).
export function parseLen(raw, mmToUnit = 10) {
  if (raw == null) return 0
  const s = String(raw).trim()
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return 0
  return /mm\s*$/i.test(s) ? n * mmToUnit : n
}

// Summer alle translate(x[,y]) i en transform-streng (rotate/scale ignoreres —
// vi trenger bare posisjon). Returnerer {dx,dy}.
export function sumTranslate(transform) {
  let dx = 0, dy = 0
  if (!transform) return { dx, dy }
  const re = /translate\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\s*\)/g
  let m
  while ((m = re.exec(transform))) {
    dx += parseFloat(m[1]) || 0
    dy += parseFloat(m[2] || '0') || 0
  }
  return { dx, dy }
}

// Utled mm→enhet-faktor fra rot-SVG (viewBox-bredde / width-mm). Faller til 10
// (typisk for disse kartene: 5131.9 enheter / 513.2 mm ≈ 10).
export function mmToUnitFromSvg(svgText) {
  const vb = (String(svgText).match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) /) || [])[1]
  const wmm = (String(svgText).match(/width="([\d.]+)mm"/) || [])[1]
  const vbW = parseFloat(vb), mmW = parseFloat(wmm)
  return Number.isFinite(vbW) && Number.isFinite(mmW) && mmW > 0 ? vbW / mmW : 10
}

// Fjern dubletter: samme type + navn (kartet rendrer f.eks. stedsnavn i flere
// LOD-lag → 2–3 identiske kopier). Behold første.
export function dedupePoi(items) {
  const seen = new Set()
  const out = []
  for (const p of items) {
    const key = `${p.type}|${(p.navn ?? '').toLowerCase().trim()}`
    if (!p.navn || seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

// Filtrer på typer (array) og fritekst-søk i navnet.
export function filterPoi(items, { typer, sok } = {}) {
  let out = items
  if (Array.isArray(typer) && typer.length) {
    const set = new Set(typer)
    out = out.filter(p => set.has(p.type))
  }
  if (sok) {
    const q = sok.toLowerCase()
    out = out.filter(p => (p.navn ?? '').toLowerCase().includes(q))
  }
  return out
}
