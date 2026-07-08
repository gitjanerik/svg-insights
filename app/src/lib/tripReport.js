// Turrapport som én selvstendig SVG: kartutsnitt med ruten tegnet inn, en
// høydeprofil, funn langs ruten (kulturminner / vern / arter+rødliste) og en
// veibeskrivelse (sti-kryss-varsler). Ren streng-komposisjon — ingen DOM, ingen
// nett. Kart-SVG-en (med rute-overlay allerede innbakt) nestes som et <svg> med
// egen viewBox; alt annet tegnes over.
//
// Kart-CSS-en er scoped til `.isom-map` (nestet svg får den klassen), så den
// lekker ikke til rapportens egne elementer.

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Trekk ut kartets viewBox + indre innhold fra en full <svg>…</svg>-streng.
export function extractMapInner(mapSvg) {
  if (typeof mapSvg !== 'string') return { viewBox: '0 0 100 100', inner: '' }
  const vb = (mapSvg.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 100 100'
  const open = mapSvg.indexOf('<svg')
  const gt = open >= 0 ? mapSvg.indexOf('>', open) : -1
  const close = mapSvg.lastIndexOf('</svg>')
  const inner = gt >= 0 && close > gt ? mapSvg.slice(gt + 1, close) : ''
  return { viewBox: vb, inner }
}

function fmtKm(m) {
  if (m == null) return '–'
  return m < 950 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`
}

// Høydeprofil-panel: fylt areal + linje fra profile.samples ({distM, elev}).
function profilePanel(profile, x, y, w, h) {
  const samples = (profile?.samples ?? []).filter(s => Number.isFinite(s.elev))
  if (samples.length < 2) {
    return `<text x="${x}" y="${y + h / 2}" font-size="13" fill="#64748b">Ingen høydeprofil (kart uten DEM)</text>`
  }
  const total = profile.totalDistM || samples[samples.length - 1].distM || 1
  const min = profile.minElev ?? Math.min(...samples.map(s => s.elev))
  const max = profile.maxElev ?? Math.max(...samples.map(s => s.elev))
  const span = Math.max(1, max - min)
  const px = (d) => x + (d / total) * w
  const py = (e) => y + h - ((e - min) / span) * h
  const pts = samples.map(s => `${px(s.distM).toFixed(1)},${py(s.elev).toFixed(1)}`)
  const area = `M${px(0).toFixed(1)},${(y + h).toFixed(1)} L${pts.join(' L')} L${px(total).toFixed(1)},${(y + h).toFixed(1)} Z`
  const line = `M${pts.join(' L')}`
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f8fafc" stroke="#e2e8f0"/>
    <path d="${area}" fill="#dbeafe" opacity="0.7"/>
    <path d="${line}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round"/>
    <text x="${x + 4}" y="${y + 14}" font-size="11" fill="#475569">${Math.round(max)} moh</text>
    <text x="${x + 4}" y="${y + h - 4}" font-size="11" fill="#475569">${Math.round(min)} moh</text>
    <text x="${x + w - 4}" y="${y + h - 4}" font-size="11" fill="#475569" text-anchor="end">${fmtKm(total)}</text>`
}

const RED_COLORS = { CR: '#b91c1c', EN: '#ea580c', VU: '#f59e0b', NT: '#eab308' }

/**
 * Bygg turrapporten som SVG-streng.
 * @param {{
 *   title?:string,
 *   summary?:{distanceM?:number,ascentM?:number,descentM?:number,timeMin?:number,viaNavn?:string[]},
 *   mapSvg?:string, profile?:object, enrichment?:object, cues?:Array,
 *   width?:number,
 * }} opts
 */
export function buildTripReportSvg(opts = {}) {
  const {
    title = 'Turrapport', summary = {}, mapSvg = '', profile = null,
    enrichment = {}, cues = [], width = 820,
  } = opts
  const W = width, M = 28
  const contentW = W - 2 * M
  const mapH = 500, profileH = 150, lineH = 20, gap = 22

  const { viewBox, inner } = extractMapInner(mapSvg)

  // Tekst-blokker (flyter under kart + profil). {h}=overskrift, ellers rad.
  const blocks = []
  const push = (text, kind = 'row', color) => blocks.push({ text, kind, color })

  const km = enrichment.kulturminner ?? []
  push(`Fredede kulturminner${enrichment.kilder?.kulturminne ? ` (${km.length})` : ''}`, 'h')
  if (!enrichment.kilder?.kulturminne) push('Kilde utilgjengelig (Riksantikvaren WFS)', 'muted')
  else if (!km.length) push('Ingen fredede kulturminner langs ruten', 'muted')
  else for (const k of km.slice(0, 8)) push(`• ${k.navn ?? 'Kulturminne'}${k.vernetype ? ` — ${k.vernetype}` : ''}  (${fmtKm(k.langsM)} inn, ${k.avstandM} m fra sti)`)

  const res = enrichment.reservater ?? []
  push('Verneområder', 'h')
  if (!enrichment.kilder?.vern) push('Kilde utilgjengelig (Naturbase)', 'muted')
  else if (!res.length) push('Ingen verneområder krysses', 'muted')
  else for (const r of res) push(`• ${r.navn}${r.verneform ? ` — ${r.verneform}` : ''}${r.arealKm2 ? `, ${r.arealKm2.toFixed(1)} km²` : ''}`)

  const arter = enrichment.arter
  push('Arter i korridoren', 'h')
  if (!enrichment.kilder?.arter || !arter) push('Kilde utilgjengelig (GBIF)', 'muted')
  else {
    push(`${arter.observasjoner} observasjoner · ${arter.arter} arter${arter.arterCappet ? '+' : ''}`)
    if (arter.rodliste) {
      const bc = arter.rodliste.perKategori
      push(`Rødlistet: ${arter.rodliste.antall}  (CR ${bc.CR} · EN ${bc.EN} · VU ${bc.VU} · NT ${bc.NT})`, 'row')
      for (const sp of arter.rodliste.arter.slice(0, 8)) {
        push(`• ${sp.norsk || sp.vitenskapelig || 'art'} (${sp.kategori}${sp.gruppe ? ', ' + sp.gruppe : ''})`, 'red', RED_COLORS[sp.kategori])
      }
    } else {
      push('Rødliste-data utilgjengelig', 'muted')
    }
  }

  push('Veibeskrivelse', 'h')
  if (!cues.length) push('Ingen tydelige kryss-valg oppdaget', 'muted')
  else cues.forEach((c, i) => push(`${i + 1}. ${c.text}`))

  // Layout-kursor.
  let y = M
  const parts = []
  const line = (txt) => { parts.push(txt) }

  // Header
  line(`<text x="${M}" y="${y + 26}" font-size="26" font-weight="700" fill="#0f172a">${esc(title)}</text>`)
  y += 40
  const sum = []
  if (summary.distanceM != null) sum.push(`${fmtKm(summary.distanceM)}`)
  if (summary.ascentM != null) sum.push(`↑${Math.round(summary.ascentM)} m`)
  if (summary.descentM != null) sum.push(`↓${Math.round(summary.descentM)} m`)
  if (summary.timeMin != null) sum.push(`~${summary.timeMin} min`)
  if (summary.viaNavn?.length) sum.push(`via ${summary.viaNavn.join(', ')}`)
  line(`<text x="${M}" y="${y + 16}" font-size="14" fill="#475569">${esc(sum.join('   ·   '))}</text>`)
  y += 30

  // Kart-panel (nestet svg med kartets viewBox).
  line(`<rect x="${M}" y="${y}" width="${contentW}" height="${mapH}" fill="#fff" stroke="#cbd5e1"/>`)
  line(`<svg x="${M}" y="${y}" width="${contentW}" height="${mapH}" viewBox="${esc(viewBox)}" preserveAspectRatio="xMidYMid meet" class="isom-map">${inner}</svg>`)
  y += mapH + gap

  // Høydeprofil
  line(`<text x="${M}" y="${y + 12}" font-size="14" font-weight="600" fill="#0f172a">Høydeprofil</text>`)
  y += 22
  line(profilePanel(profile, M, y, contentW, profileH))
  y += profileH + gap

  // Tekst-blokker
  for (const b of blocks) {
    if (b.kind === 'h') {
      y += 6
      line(`<text x="${M}" y="${y + 14}" font-size="15" font-weight="700" fill="#0f172a">${esc(b.text)}</text>`)
      y += lineH
    } else {
      const color = b.color || (b.kind === 'muted' ? '#94a3b8' : '#334155')
      const style = b.kind === 'muted' ? ' font-style="italic"' : ''
      line(`<text x="${M}" y="${y + 13}" font-size="13" fill="${color}"${style}>${esc(b.text)}</text>`)
      y += lineH
    }
  }
  y += M

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${Math.round(y)}" viewBox="0 0 ${W} ${Math.round(y)}" font-family="system-ui, sans-serif">
<rect width="${W}" height="${Math.round(y)}" fill="#ffffff"/>
${parts.join('\n')}
</svg>`
}

/**
 * Delbar Markdown-versjon av turrapporten (samme innhold som SVG-en, som ren
 * tekst — grei å lime inn, lese på mobil eller sende videre). Tar samme
 * `summary`/`enrichment`/`cues` som buildTripReportSvg (kartet utelates).
 */
export function buildTripReportMarkdown(opts = {}) {
  const { title = 'Turrapport', summary = {}, enrichment = {}, cues = [] } = opts
  const L = []
  L.push(`# ${title}`, '')

  const sum = []
  if (summary.distanceM != null) sum.push(fmtKm(summary.distanceM))
  if (summary.ascentM != null) sum.push(`↑${Math.round(summary.ascentM)} m`)
  if (summary.descentM != null) sum.push(`↓${Math.round(summary.descentM)} m`)
  if (summary.timeMin != null) sum.push(`~${summary.timeMin} min`)
  if (summary.viaNavn?.length) sum.push(`via ${summary.viaNavn.join(', ')}`)
  if (sum.length) L.push(`**${sum.join(' · ')}**`, '')

  const k = enrichment.kilder ?? {}
  const km = enrichment.kulturminner ?? []
  L.push(`## Fredede kulturminner${k.kulturminne ? ` (${km.length})` : ''}`)
  if (!k.kulturminne) L.push('_Kilde utilgjengelig (Riksantikvaren)_')
  else if (!km.length) L.push('_Ingen langs ruten_')
  else for (const it of km.slice(0, 12)) L.push(`- ${it.navn ?? 'Kulturminne'}${it.vernetype ? ` — ${it.vernetype}` : ''} (${fmtKm(it.langsM)} inn, ${it.avstandM} m fra sti)`)
  L.push('')

  const res = enrichment.reservater ?? []
  L.push('## Verneområder')
  if (!k.vern) L.push('_Kilde utilgjengelig (Naturbase)_')
  else if (!res.length) L.push('_Ingen krysses_')
  else for (const r of res) L.push(`- ${r.navn}${r.verneform ? ` — ${r.verneform}` : ''}${r.arealKm2 ? `, ${r.arealKm2.toFixed(1)} km²` : ''}`)
  L.push('')

  const arter = enrichment.arter
  L.push('## Arter i korridoren')
  if (!k.arter || !arter) L.push('_Kilde utilgjengelig (GBIF)_')
  else {
    L.push(`${arter.observasjoner} observasjoner · ${arter.arter} arter${arter.arterCappet ? '+' : ''}`)
    if (arter.rodliste) {
      const bc = arter.rodliste.perKategori
      L.push('', `**Rødlistet: ${arter.rodliste.antall}** (CR ${bc.CR} · EN ${bc.EN} · VU ${bc.VU} · NT ${bc.NT})`)
      for (const sp of arter.rodliste.arter.slice(0, 12)) L.push(`- ${sp.norsk || sp.vitenskapelig || 'art'} (${sp.kategori}${sp.gruppe ? ', ' + sp.gruppe : ''})`)
    }
  }
  L.push('')

  L.push('## Veibeskrivelse')
  if (!cues.length) L.push('_Ingen tydelige kryss-valg oppdaget_')
  else cues.forEach((c, i) => L.push(`${i + 1}. ${c.text}`))
  L.push('')

  return L.join('\n')
}
