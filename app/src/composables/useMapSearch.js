import { ref, computed, shallowRef } from 'vue'

/**
 * useMapSearch — bygger en søkeindeks over navngitte elementer i en SVG-kart-
 * DOM og tilbyr live-filtrering med live-resultater.
 *
 * Indeksen plukker:
 *   - <text>-noder med data-label (stedsnavn, vann-navn, peak osv) — bruker
 *     tekstinnholdet som navn
 *   - <path data-name="..."> (lakes/elver/øyer/relations) — bruker bbox-senter
 *     som anker
 *
 * Posisjonene returneres i user-units (meter, samme som viewBoxen).
 *
 * Indeksen er ikke reaktiv på SVG-endringer — kall `rebuild(svgEl)` etter
 * map-load eller når annoteringer/lag endrer DOM-en på en måte som vil
 * legge til nye navngitte features.
 */

const NUMERIC_RE = /^[\s-]*\d+([.,]\d+)?(\s*(m|moh|km))?$/i

// data-label-verdier vi alltid hopper over fordi de bare er tall (høydekurve-
// labels, dybdetall, fyltehøyder osv).
const SKIP_LABELS = new Set([
  'kontur-tall', 'peak-ele', 'vann-tall', 'dybde-tall',
])

const LABEL_LUT = {
  'stedsnavn':  'Sted',
  'vann-navn':  'Vann',
  'peak':       'Topp',
  'sted':       'Sted',
}

function labelFor(kind) {
  return LABEL_LUT[kind] ?? 'Stedsnavn'
}

/**
 * Foldec ASCII-substitusjon for fuzzy match: ALT enkel diakritikk
 * normaliseres til ASCII, æ/ø/å → ae/oe/aa. Brukerinput og index normaliseres
 * likt slik at f.eks. "tarn" matcher "Tärn" og "trondheimsfjorden" matcher
 * "Trondheimsfjorden".
 */
export function foldName(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .trim()
}

function bestKindRank(kind) {
  // Foretrekk stedsnavn > peak > vann-navn > path-name (omrade)
  if (kind === 'stedsnavn') return 0
  if (kind === 'peak') return 1
  if (kind === 'vann-navn') return 2
  return 5
}

// Parsererer `transform="translate(x, y)"` (det eneste mapBuilder skriver
// på label-grupper). Returnerer [dx, dy] eller [0, 0] hvis ikke matchet.
const TRANSLATE_RE = /translate\s*\(\s*([\-0-9.eE]+)[\s,]+([\-0-9.eE]+)\s*\)/

function parseTranslate(transformStr) {
  if (!transformStr) return null
  const m = TRANSLATE_RE.exec(transformStr)
  if (!m) return null
  const dx = parseFloat(m[1])
  const dy = parseFloat(m[2])
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  return [dx, dy]
}

/**
 * Akkumuler `transform="translate(...)"` opp parent-kjeden fra `el` til
 * `stopEl` (eksklusiv). Vi bruker dette istedenfor `getCTM()` fordi getCTM
 * returnerer matrise til SVG-viewportens CSS-pikselsystem, ikke til viewBox-
 * koordinatene (meter). For vårt formål — finne ankerpunkt i user-units —
 * må vi walke trærd selv. Kun translate støttes; mapBuilder skriver ingen
 * rotate/scale på label-grupper, så det er trygt.
 */
function ancestorTranslate(el, stopEl) {
  let dx = 0, dy = 0
  let p = el.parentElement
  while (p && p !== stopEl && p.nodeType === 1) {
    const t = parseTranslate(p.getAttribute('transform'))
    if (t) { dx += t[0]; dy += t[1] }
    p = p.parentElement
  }
  return [dx, dy]
}

/**
 * Pluck en representativ (x, y) i SVG-rotens koordinatsystem (user-units).
 *
 * For <text>: bruker x/y-attributtene som ankerpunkt og legger til
 * akkumulerte translate fra parent-chain. Fungerer også når elementet er i
 * et display:none-lag (stedsnavn-overlayet sendes med inline display:none
 * og toggles av MapView.applyLayerVisibility — getBBox() ville gitt (0,0)
 * for skjulte elementer; getCTM() ville gitt CSS-piksler).
 *
 * For path/polygon med data-name: getBBox() gir lokal bbox i parent-coord-
 * system. Vi legger til parent-translate for å mappe til root.
 */
function elementPosition(svgEl, el) {
  try {
    if (el.tagName === 'text') {
      // parseFloat strips ev. mm-suffiks (peak-labels bruker "2mm"); 2 user-
      // units = 2 m, neglisjerbart relativt til parent-gruppens translate
      // som inneholder den ekte posisjonen.
      const ax = parseFloat(el.getAttribute('x') ?? '') || 0
      const ay = parseFloat(el.getAttribute('y') ?? '') || 0
      const [dx, dy] = ancestorTranslate(el, svgEl)
      return { x: ax + dx, y: ay + dy }
    }
    const bb = el.getBBox()
    if (!Number.isFinite(bb.x) || !Number.isFinite(bb.y)) return null
    // Degenerert bbox (display:none / tomt polygon) — skip
    if (bb.width <= 0 && bb.height <= 0) return null
    const [dx, dy] = ancestorTranslate(el, svgEl)
    return {
      x: bb.x + bb.width / 2 + dx,
      y: bb.y + bb.height / 2 + dy,
    }
  } catch {
    return null
  }
}

function pushRaw(out, name, kind, pos, el) {
  if (!name || !pos) return
  out.push({
    id: `${kind}-${out.length}`,
    name,
    folded: foldName(name),
    kind,
    label: labelFor(kind),
    x: pos.x,
    y: pos.y,
    el,
  })
}

export function buildSearchIndex(svgEl) {
  if (!svgEl) return []
  const out = []

  // 1) Tekst-labels — alle som har data-label og ikke er rene tall.
  for (const t of svgEl.querySelectorAll('text[data-label]')) {
    const kind = t.getAttribute('data-label') ?? ''
    if (!kind || SKIP_LABELS.has(kind)) continue
    const name = (t.textContent || '').trim()
    if (!name) continue
    if (NUMERIC_RE.test(name)) continue
    const pos = elementPosition(svgEl, t)
    if (!pos) continue
    pushRaw(out, name, kind, pos, t)
  }

  // 2) Navngitte polygoner (data-name) — typisk innsjøer/elver/øyer som er
  //    syt sammen fra OSM relations. Mange har egen vann-navn label allerede,
  //    så vi deduper på navn+omtrentlig posisjon under.
  for (const p of svgEl.querySelectorAll('[data-name]')) {
    const name = p.getAttribute('data-name')?.trim()
    if (!name) continue
    const pos = elementPosition(svgEl, p)
    if (!pos) continue
    pushRaw(out, name, 'omrade', pos, p)
  }

  // Dedupe: samme navn (folded) innen ~50m skal kun gi ett resultat. Behold
  // den med best kind-rank (helst stedsnavn over polygon).
  const seen = new Map()
  for (const r of out) {
    // Bucket-størrelse i meter — to elementer i samme bucket regnes som duplikat
    const bucket = `${r.folded}|${Math.round(r.x / 50)}|${Math.round(r.y / 50)}`
    const existing = seen.get(bucket)
    if (!existing || bestKindRank(r.kind) < bestKindRank(existing.kind)) {
      seen.set(bucket, r)
    }
  }
  return Array.from(seen.values())
}

/**
 * Filtrer indeksen mot et søk. Returnerer maks `limit` treff,
 * prefix-matcher først, så kortere navn først.
 */
export function filterIndex(index, query, limit = 30) {
  const q = foldName(query)
  if (!q) return []
  const out = []
  for (const r of index) {
    const idx = r.folded.indexOf(q)
    if (idx < 0) continue
    out.push({ ...r, _matchPos: idx })
  }
  out.sort((a, b) => {
    if (a._matchPos !== b._matchPos) return a._matchPos - b._matchPos
    const kr = bestKindRank(a.kind) - bestKindRank(b.kind)
    if (kr !== 0) return kr
    return a.name.length - b.name.length
  })
  return out.slice(0, limit)
}

/**
 * Finn beste treff på et eksakt navn (case-insensitivt + diakritikk-foldet).
 * Brukes når URL inneholder ?hl=<navn> og vi skal auto-highlighte. Foretrekker
 * eksakt match; fall tilbake til første prefix-treff hvis ingen eksakte finnes.
 */
export function findByName(index, name) {
  const q = foldName(name)
  if (!q) return null
  let exact = null
  let prefix = null
  let any = null
  for (const r of index) {
    if (r.folded === q) {
      if (!exact || bestKindRank(r.kind) < bestKindRank(exact.kind)) exact = r
    } else if (!prefix && r.folded.startsWith(q)) {
      prefix = r
    } else if (!any && r.folded.includes(q)) {
      any = r
    }
  }
  return exact ?? prefix ?? any
}

export function useMapSearch() {
  // shallowRef siden vi bytter hele array-referansen ved rebuild og ikke
  // muterer enkeltelementer — sparer Vue for deep-tracking.
  const index = shallowRef([])
  const query = ref('')

  function rebuild(svgEl) {
    index.value = buildSearchIndex(svgEl)
  }

  function clear() {
    query.value = ''
  }

  const results = computed(() => filterIndex(index.value, query.value, 30))

  return { query, results, index, rebuild, clear }
}
