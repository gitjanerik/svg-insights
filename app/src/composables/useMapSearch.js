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
 *   - Unavngitte vann-polygoner i ferskvann-lag (ISOM 301 / 302) ekstrahert
 *     fra de kombinerte sti-elementene som v8.10.4 emitterer. Disse får
 *     syntetiske navn ("Innsjø uten navn", "Tjern uten navn") og dukker
 *     bare opp ved kategori-søk ("vann"/"innsjø"/"tjern"). Saltvann (303)
 *     og sjøkart-dybdeareal (307) tas ikke med.
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
  'stedsnavn':   'Sted',
  'vann-navn':   'Vann',
  'peak':        'Topp',
  'sted':        'Sted',
  'parkering':   'Parkering',
  'hoydepunkt':  'Høyde',
}

function labelFor(kind) {
  return LABEL_LUT[kind] ?? 'Stedsnavn'
}

// Kategori-søkeord — eksakt-match (etter folding) på disse listet alle
// entries med matchende `categories`-tag, slik at brukeren kan få oversikt
// over alle blå ferskvann-områder uten å vite navnet. «vann», «innsjø» og
// «tjern» behandles som synonymer og mapper alle til canonical 'vann'-tag.
const CATEGORY_ALIASES = {
  'vann':    'vann',
  'innsjoe': 'vann',
  'innsjo':  'vann',
  'tjern':   'vann',
  'parkering': 'parkering',
  'utfartsparkering': 'parkering',
  'utfart':  'parkering',
}

// Spesial-søkeord for «kartets høyeste punkter». Eksakt-match (etter folding)
// på disse lister de N høyeste toppene sortert på høyde desc, hver med moh +
// navn. Et eget modus (ikke en vanlig kategori) fordi resultatet er en
// rangert topp-liste, ikke «alle entries med en tag».
const PEAK_KEYWORDS = new Set(['topp', 'topper'])
// «Topp 10» er et innarbeidet begrep i lokale turarrangementer, så vi lister
// de ti høyeste (ikke fem).
const TOP_PEAKS_COUNT = 10

// Hvor nær et navngitt sted må ligge en navnløs topp for at vi låner navnet.
const PEAK_NAME_RADIUS_M = 50

// To like høydetall innen denne radiusen regnes som samme høydepunkt (kontur-
// etiketter gjentar samme tall langs en kurve / rundt en topp). Brukes i
// kontur-tall-fallbacken for «topp»-søket når kartet mangler ekte topp-markører.
const DUP_HEIGHT_RADIUS_M = 200

/**
 * Klynge-dedupliser høydepunkter: grupper punkter med samme (avrundede) høyde
 * som ligger innen DUP_HEIGHT_RADIUS_M av hverandre (transitivt), og behold ett
 * pr klynge — det «midterste» (nærmest klynge-sentroiden). Ren funksjon
 * (testbar). `points`: [{ x, y, ele }] → samme form, redusert.
 */
export function dedupeHeightPoints(points, radiusM = DUP_HEIGHT_RADIUS_M) {
  const byEle = new Map()
  for (const p of points) {
    if (!Number.isFinite(p.ele)) continue
    const key = Math.round(p.ele)
    if (!byEle.has(key)) byEle.set(key, [])
    byEle.get(key).push(p)
  }
  const r2 = radiusM * radiusM
  const out = []
  for (const group of byEle.values()) {
    const used = new Array(group.length).fill(false)
    for (let i = 0; i < group.length; i++) {
      if (used[i]) continue
      const cluster = [i]
      used[i] = true
      // BFS: dra inn alle like-høyde-punkter innen radius av klyngen.
      for (let qi = 0; qi < cluster.length; qi++) {
        const a = group[cluster[qi]]
        for (let j = 0; j < group.length; j++) {
          if (used[j]) continue
          const b = group[j]
          if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= r2) {
            used[j] = true
            cluster.push(j)
          }
        }
      }
      let cx = 0, cy = 0
      for (const idx of cluster) { cx += group[idx].x; cy += group[idx].y }
      cx /= cluster.length; cy /= cluster.length
      let best = cluster[0], bestD2 = Infinity
      for (const idx of cluster) {
        const d2 = (group[idx].x - cx) ** 2 + (group[idx].y - cy) ** 2
        if (d2 < bestD2) { bestD2 = d2; best = idx }
      }
      out.push(group[best])
    }
  }
  return out
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
  // Foretrekk stedsnavn > peak > vann-navn > path-name (omrade) > unavngitt vann
  if (kind === 'stedsnavn') return 0
  if (kind === 'peak') return 1
  if (kind === 'vann-navn') return 2
  if (kind === 'omrade') return 5
  if (kind === 'vann-omrade') return 8
  return 10
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
 * For path/polygon med data-name: getBBox() gir lokal bbox i ELEMENTETS
 * eget koordinatsystem (FØR dets egen transform). Vi legger til både
 * elementets EGEN translate og parent-translates for å mappe til root.
 * Egen-translate er kritisk for punkt-grupper som holdeplass/parkering/
 * sjø-POI: `<g data-name="…" transform="translate(x,y)"><use x="-3mm" …>`
 * har hele posisjonen i sin egen transform og bbox-senter ≈ (0,0) lokalt —
 * uten egen-translate havnet søketreff på slike i kartets NV-hjørne
 * («Bondivann»-buggen: togholdeplassen markertes på (0,0)).
 */
export function elementPosition(svgEl, el) {
  try {
    if ((el.tagName ?? '').toLowerCase() === 'text') {
      // parseFloat strips ev. mm-suffiks (peak-labels bruker "2mm"); 2 user-
      // units = 2 m, neglisjerbart relativt til parent-gruppens translate
      // som inneholder den ekte posisjonen.
      const ax = parseFloat(el.getAttribute('x') ?? '') || 0
      const ay = parseFloat(el.getAttribute('y') ?? '') || 0
      const [dx, dy] = ancestorTranslate(el, svgEl)
      return { x: ax + dx, y: ay + dy }
    }
    // Lokalt bbox-senter i elementets EGET koordinatsystem (før egen transform).
    // Nettleser: getBBox(). Headless (linkedom har ingen getBBox): utled fra
    // path-geometrien, ellers (0,0) for punkt-grupper der hele posisjonen ligger
    // i transform-kjeden — se geometryCenter.
    let lx, ly
    if (typeof el.getBBox === 'function') {
      const bb = el.getBBox()
      if (!Number.isFinite(bb.x) || !Number.isFinite(bb.y)) return null
      // Degenerert bbox (display:none / tomt polygon) — skip
      if (bb.width <= 0 && bb.height <= 0) return null
      lx = bb.x + bb.width / 2
      ly = bb.y + bb.height / 2
    } else {
      const c = geometryCenter(el)
      if (!c) return null
      lx = c.x
      ly = c.y
    }
    const own = parseTranslate(el.getAttribute('transform')) ?? [0, 0]
    const [dx, dy] = ancestorTranslate(el, svgEl)
    return { x: lx + own[0] + dx, y: ly + own[1] + dy }
  } catch {
    return null
  }
}

/**
 * Headless erstatning for getBBox-senter (linkedom mangler getBBox). For
 * <path>: union-bbox fra parsePathSubpaths → senter i elementets egne (lokale)
 * koordinater, samme rom getBBox ville gitt. For <g>/andre uten egen `d`:
 * (0,0) lokalt, siden posisjonen for punkt-grupper (parkering/sjø-POI) ligger i
 * egen/forelder-transform (kommentaren over gjelder). Returnerer null når
 * ingen geometri kan utledes.
 */
function geometryCenter(el) {
  const tag = (el.tagName ?? '').toLowerCase()
  if (tag === 'path') {
    const subs = parsePathSubpaths(el.getAttribute('d'))
    if (!subs.length) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const s of subs) {
      if (s.bbox.minX < minX) minX = s.bbox.minX
      if (s.bbox.minY < minY) minY = s.bbox.minY
      if (s.bbox.maxX > maxX) maxX = s.bbox.maxX
      if (s.bbox.maxY > maxY) maxY = s.bbox.maxY
    }
    if (!Number.isFinite(minX)) return null
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  }
  return { x: 0, y: 0 }
}

/**
 * Tolk én topp-label (<text data-label="peak"> eller "peak-ele") til
 * { name?, ele? }. Eksportert for test (duck-typet element — trenger kun
 * getAttribute/textContent/childNodes/querySelector).
 *
 * Formater i omløp:
 *  - v12.0.7+ («Stedsnavn-typografi»): høyden ligger som INLINE
 *    <tspan data-label="peak-ele"> inni navne-teksten. textContent på ytter-
 *    teksten konkatenerer navn+tall («Slottsberget293»), så navnet må leses
 *    fra tekst-nodene alene. Denne varianten brakk søket i v12.0.7–v12.1.21:
 *    tspan-en matchet ikke `text[data-label="peak-ele"]`, toppen fikk aldri
 *    `ele` og ble droppet fra indeksen.
 *  - Eldre kart: navn og høyde som to søsken-<text> (peak + peak-ele).
 *  - Navnløs topp: peak-labelen ER høyde-tallet (fallback når navnet var
 *    claimet av en annen label ved bygging).
 */
export function readPeakLabel(t) {
  const lbl = t.getAttribute('data-label')
  if (lbl === 'peak-ele') {
    const n = parseFloat((t.textContent ?? '').trim())
    return Number.isFinite(n) ? { ele: n } : {}
  }
  const out = {}
  const inline = t.querySelector?.('[data-label="peak-ele"]')
  if (inline) {
    const n = parseFloat((inline.textContent ?? '').trim())
    if (Number.isFinite(n)) out.ele = n
  }
  let name = (t.getAttribute('data-name-full') ?? '').trim()
  if (!name) {
    let own = ''
    for (const node of t.childNodes ?? []) {
      if (node.nodeType === 3) own += node.textContent ?? ''
    }
    name = own.trim()
    if (!name && !inline) name = (t.textContent ?? '').trim()
  }
  // Defensivt: eldre applyNameLanguage (≤ v12.1.28) rakk å forurense
  // data-name-full med det inline høyde-tallet («Vardåsen349») — strip et
  // navne-suffiks som er identisk med tspan-høyden.
  if (inline && name) {
    const eleText = (inline.textContent ?? '').trim()
    if (eleText && name !== eleText && name.endsWith(eleText)) {
      name = name.slice(0, -eleText.length).trim()
    }
  }
  if (NUMERIC_RE.test(name)) {
    const n = parseFloat(name)
    if (Number.isFinite(n) && out.ele == null) out.ele = n
  } else if (name) {
    out.name = name
  }
  return out
}

function pushRaw(out, name, kind, pos, el, extra = {}) {
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
    categories: extra.categories ?? null,
    areaM2: extra.areaM2 ?? null,
    ele: extra.ele ?? null,
  })
}

// Mapper ISOM-kode til kategori-tags. 301 = Innsjø, 302 = Tjern. Begge
// regnes likt som ferskvann («vann»). Søke-keywordsne «innsjø» og «tjern»
// fungerer som synonymer for «vann» (se CATEGORY_ALIASES).
function categoriesForIsom(iso) {
  if (iso === '301' || iso === '302') return ['vann']
  return null
}

function isomFromAncestor(el) {
  let p = el
  while (p && p.nodeType === 1) {
    if ((p.tagName ?? '').toLowerCase() === 'g' && p.hasAttribute('data-iso')) {
      return p.getAttribute('data-iso')
    }
    p = p.parentElement
  }
  return null
}

/**
 * Parse en kombinert path-d ("M..L..Z M..L..Z ...") til en liste sub-paths,
 * hver med beregnet sentroid, bbox og polygon-areal (shoelace). Brukes til
 * å trekke ut individuelle unavngitte vann-polygoner fra v8.10.4-stilen
 * der mapBuilder slår sammen unnamed features per data-src i én <path>.
 *
 * Vi forventer kun M og L kommandoer (+ avsluttende Z) — mapBuilder
 * skriver ingen andre. Tall er separert med komma og kommando-bokstaver.
 */
function parsePathSubpaths(d) {
  if (!d || typeof d !== 'string') return []
  const out = []
  // Lookahead-split bevarer hvert sub-path som starter med 'M'
  const parts = d.split(/(?=M)/)
  const numRe = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g
  for (const part of parts) {
    if (!part || part[0] !== 'M') continue
    const coords = []
    let m
    numRe.lastIndex = 0
    while ((m = numRe.exec(part)) !== null) {
      const x = parseFloat(m[1])
      const y = parseFloat(m[2])
      if (Number.isFinite(x) && Number.isFinite(y)) coords.push([x, y])
    }
    if (coords.length < 3) continue
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let cx = 0, cy = 0
    for (const [x, y] of coords) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      cx += x; cy += y
    }
    cx /= coords.length; cy /= coords.length
    // Shoelace-areal (absolutt). Polygoner i SVG-units = meter, så
    // areaM2 er ekte kvadratmeter.
    let a = 0
    for (let i = 0; i < coords.length; i++) {
      const [x1, y1] = coords[i]
      const [x2, y2] = coords[(i + 1) % coords.length]
      a += x1 * y2 - x2 * y1
    }
    const areaM2 = Math.abs(a) / 2
    out.push({
      cx, cy,
      bbox: { minX, minY, maxX, maxY },
      areaM2,
    })
  }
  return out
}

function lakeLabelForIsom(iso) {
  if (iso === '302') return 'Tjern uten navn'
  return 'Innsjø uten navn'
}

export function formatAreaShort(m2) {
  if (!Number.isFinite(m2) || m2 <= 0) return ''
  if (m2 >= 1_000_000) return `~${(m2 / 1_000_000).toFixed(1).replace('.0', '')} km²`
  if (m2 >= 10_000) return `~${Math.round(m2 / 10_000)} ha`
  return `~${Math.round(m2)} m²`
}

// Minimum-areal for å regnes som «et vann». Mindre enn dette er typisk
// dam/grøft/støy — ikke noe brukeren vil se i en oversikt.
const MIN_LAKE_AREA_M2 = 300

// Maks antall unavngitte vann vi tar med per kart. Begrenser pollution
// fra LiDAR-støy eller mange små dammer i myr-områder.
const MAX_UNNAMED_LAKES = 60

export function buildSearchIndex(svgEl) {
  if (!svgEl) return []
  const out = []

  // 1) Tekst-labels — alle som har data-label og ikke er rene tall.
  for (const t of svgEl.querySelectorAll('text[data-label]')) {
    // Spøkelses-/utvidelses-fliser (#ghost-tiles) beholder navn for VISNING, men
    // skal ikke i søkeindeksen (doble treff) eller JS-tetthets-budsjettet.
    if (t.closest('#ghost-tiles')) continue
    const kind = t.getAttribute('data-label') ?? ''
    if (!kind || SKIP_LABELS.has(kind)) continue
    // Topper håndteres i et dedikert pass under — de trenger høyden (moh)
    // fra sin søsken-label `peak-ele`, og navnløse topper (label = bare
    // tallet) skal også med i topp-rangeringen.
    if (kind === 'peak') continue
    // data-name-full holder det fulle flerspråklige navnet (norsk - samisk -
    // finsk) når MapView viser kun det norske leddet. Indekser det fulle navnet
    // så søk treffer alle språk uansett hva som vises på kartet.
    const name = (t.getAttribute('data-name-full') ?? t.textContent ?? '').trim()
    if (!name) continue
    if (NUMERIC_RE.test(name)) continue
    const pos = elementPosition(svgEl, t)
    if (!pos) continue
    // Vann-navn-labels får kategori-tag så de matcher på "vann"-søk
    // selv om søkeordet ikke står i navnet.
    let categories = null
    if (kind === 'vann-navn') categories = ['vann']
    pushRaw(out, name, kind, pos, t, { categories })
  }

  // 1b) Utfartsparkering (ISOM 534u) — mapBuilder emitterer data-name med
  //    nærmeste natur-feature ("Knivåsen Utfartsparkering"). Egen kind/label
  //    + 'parkering'-kategori så et søk på "parkering" lister dem (selv om
  //    navnet alltid inneholder ordet uansett). Kjøres FØR den generiske
  //    data-name-runden, som hopper over 534u for å unngå dubletter.
  for (const g of svgEl.querySelectorAll('g[data-iso="534u"][data-name]')) {
    const name = g.getAttribute('data-name')?.trim()
    if (!name) continue
    const pos = elementPosition(svgEl, g)
    if (!pos) continue
    pushRaw(out, name, 'parkering', pos, g, { categories: ['parkering'] })
  }

  // 2) Navngitte polygoner (data-name) — typisk innsjøer/elver/øyer som er
  //    syt sammen fra OSM relations. Mange har egen vann-navn label allerede,
  //    så vi deduper på navn+omtrentlig posisjon under.
  for (const p of svgEl.querySelectorAll('[data-name]')) {
    // 534u-markørene plukkes i 1b — skip dem her så vi ikke dobbelt-indekserer.
    if ((p.tagName ?? '').toLowerCase() === 'g' && p.getAttribute('data-iso') === '534u') continue
    const name = p.getAttribute('data-name')?.trim()
    if (!name) continue
    const pos = elementPosition(svgEl, p)
    if (!pos) continue
    const iso = isomFromAncestor(p)
    const categories = categoriesForIsom(iso)
    pushRaw(out, name, 'omrade', pos, p, { categories })
  }

  // 3) Unavngitte ferskvann-polygoner (ISOM 301 + 302). Mapbuilder slår
  //    sammen alle unavngitte vann i samme bucket i ÉN kombinert <path>,
  //    så vi må parse sub-paths fra d-attributtet for å få per-vann
  //    treff. Saltvann (303) og sjøkart (307) ekskluderes med vilje.
  const unnamedLakes = []
  for (const iso of ['301', '302']) {
    const groups = svgEl.querySelectorAll(`g[data-iso="${iso}"]`)
    for (const g of groups) {
      const [dx, dy] = ancestorTranslate(g, svgEl)
      // Sjekk alle paths i gruppen. Navngitte er allerede plukket i runde 2,
      // så skip dem her. Tomt data-name="" teller som ikke-navngitt.
      for (const path of g.querySelectorAll(':scope > path')) {
        const nameAttr = path.getAttribute('data-name')
        if (nameAttr && nameAttr.trim()) continue
        const d = path.getAttribute('d')
        if (!d) continue
        const subs = parsePathSubpaths(d)
        for (const s of subs) {
          if (s.areaM2 < MIN_LAKE_AREA_M2) continue
          unnamedLakes.push({
            x: s.cx + dx,
            y: s.cy + dy,
            areaM2: s.areaM2,
            iso,
          })
        }
      }
    }
  }
  // Sorter desc på areal og cap så vi ikke spammer listen
  unnamedLakes.sort((a, b) => b.areaM2 - a.areaM2)
  const capped = unnamedLakes.slice(0, MAX_UNNAMED_LAKES)
  for (const lake of capped) {
    const baseName = lakeLabelForIsom(lake.iso)
    const areaLabel = formatAreaShort(lake.areaM2)
    const name = areaLabel ? `${baseName} (${areaLabel})` : baseName
    const categories = categoriesForIsom(lake.iso)
    pushRaw(out, name, 'vann-omrade', { x: lake.x, y: lake.y }, null, {
      categories,
      areaM2: lake.areaM2,
    })
  }

  // 4) Topper. mapBuilder emitterer hver topp som <g transform="translate(x,y)">
  //    med et symbol og enten navn+høyde, bare navn eller bare høyde. Vi samler
  //    dem per gruppe så vi får BÅDE høyde og posisjon, og indekserer hver topp
  //    med `ele` slik at «topp»-søket kan rangere kartets høyeste punkter.
  //    Navnløse topper låner navnet til nærmeste navngitte sted innenfor 50 m
  //    (jf. spesial-søk-spesifikasjonen). Selve tolkningen av label-formatene
  //    (inline-tspan fra v12.0.7, søsken-<text> fra eldre kart) ligger i
  //    readPeakLabel.
  const peakRecs = new Map()   // <g> → { g, name, ele, nameEl }
  for (const t of svgEl.querySelectorAll('text[data-label="peak"], text[data-label="peak-ele"]')) {
    if (t.closest('#ghost-tiles')) continue   // spøkelses-topper ikke i søk
    const g = t.parentElement
    if (!g) continue
    let rec = peakRecs.get(g)
    if (!rec) { rec = { g, name: null, ele: NaN, nameEl: null }; peakRecs.set(g, rec) }
    const info = readPeakLabel(t)
    if (info.ele != null) rec.ele = info.ele
    if (info.name) {
      rec.name = info.name
      rec.nameEl = t
    }
  }
  // Snapshot av navngitte steder samlet så langt — brukes til 50 m-oppslaget
  // for navnløse topper (toppen selv er ikke lagt til ennå).
  const namedForPeaks = out.filter(
    r => r.kind === 'stedsnavn' || r.kind === 'vann-navn' || r.kind === 'omrade'
  )
  const nearestNamedName = (x, y) => {
    let best = null
    let bestD2 = PEAK_NAME_RADIUS_M * PEAK_NAME_RADIUS_M
    for (const r of namedForPeaks) {
      const d2 = (r.x - x) ** 2 + (r.y - y) ** 2
      if (d2 <= bestD2) { bestD2 = d2; best = r }
    }
    return best ? best.name : null
  }
  for (const rec of peakRecs.values()) {
    // Navngitte topper indekseres også UTEN høyde (OSM-peaks mangler av og
    // til ele-tag) — bare topper uten både navn og høyde hoppes over.
    if (!rec.name && !Number.isFinite(rec.ele)) continue
    const own = parseTranslate(rec.g.getAttribute('transform')) ?? [0, 0]
    const [dx, dy] = ancestorTranslate(rec.g, svgEl)
    const x = own[0] + dx, y = own[1] + dy
    const name = rec.name ?? nearestNamedName(x, y) ?? 'Topp'
    // El for navngitte topper = navn-teksten (så name-LOD/forced-visible
    // kan vise den ved treff). Navnløse: ingen tekst å toggle → el = null.
    pushRaw(out, name, 'peak', { x, y }, rec.nameEl, {
      categories: ['topp'],
      ele: Number.isFinite(rec.ele) ? rec.ele : null,
    })
  }

  // 5) Høydepunkt-fallback for «topp»-søket NÅR kartet ikke har ekte
  //    topp-markører (brun skrift / OSM-peaks).
  //
  //    PRIMÆRT: DEM-deriverte EKTE topper — skjult <g data-label="dem-topp">,
  //    lokale høyde-maksima funnet i mapBuilder (detectSummits). Dette er
  //    faktiske topper, ikke kontur-tall midt i en li «på vei opp» mot noe
  //    høyere (kontur-etiketter er bare ekvidistanse-tall langs en kurve).
  //
  //    SEKUNDÆRT (eldre kart bygget før dem-topp fantes): de høyeste
  //    kontur-tallene, dedup'et. Dårligere — kan vise hellings-tall som «topp»
  //    — men bedre enn ingenting til kartet bygges på nytt.
  //
  //    Begge ligger som <g data-label="…"><text>540</text>…> (data-label på
  //    GRUPPEN, ikke hvert <text>), så pass 1 plukker dem ikke.
  const readHeightTexts = (sel) => {
    const pts = []
    for (const t of svgEl.querySelectorAll(sel)) {
      const ele = parseFloat((t.textContent || '').trim())
      if (!Number.isFinite(ele)) continue
      const pos = elementPosition(svgEl, t)
      if (!pos) continue
      pts.push({ x: pos.x, y: pos.y, ele })
    }
    return pts
  }
  const demTopPts = readHeightTexts('[data-label="dem-topp"] text')
  // detectSummits har allerede romlig dedup; kontur-fallbacken må dedup'es.
  const heightPts = demTopPts.length
    ? demTopPts
    : dedupeHeightPoints(readHeightTexts('[data-label="kontur-tall"] text'))
  for (const p of heightPts) {
    const name = nearestNamedName(p.x, p.y) ?? 'Høyde'
    // el = null: ingen egen tekst-node å tvinge synlig / LOD-toggle (toppen
    // er ikke rendret som markør på kartet); søk panner bare dit.
    pushRaw(out, name, 'hoydepunkt', { x: p.x, y: p.y }, null, { ele: p.ele })
  }

  // Dedupe på navn: samme folded navn = samme «sted» for søke-formål. Beholder
  // FØRSTE forekomst i indekseringsrekkefølgen — viktig for elver/bekker
  // som har samme navn-label gjentatt langs path-en (typisk hver ~2 km i
  // OSM). Tidligere brukte vi en 50 m bucket sammen med navnet, men det
  // beholdt alle de gjentatte rivernavn-labels og spammet resultatlisten.
  //
  // Unavngitte vann-polygoner får syntetiske navn med areal-suffiks som
  // kan kollidere (to ulike små vann begge runder til "~300 m²"); for dem
  // bruker vi den unike id-en som nøkkel slik at vi ikke filtrerer bort
  // ekte ulike features.
  const seen = new Map()
  for (const r of out) {
    // Topper og unavngitte vann er distinkte punkter (flere kan dele navn,
    // f.eks. en topp og et tettsted som heter det samme, eller flere
    // navnløse «Topp») → dedupe på unik id så ingen forsvinner. Andre
    // entries deduperes på navn (samme folded navn = samme sted).
    const key = (r.kind === 'vann-omrade' || r.kind === 'peak' || r.kind === 'hoydepunkt')
      ? r.id : r.folded
    const existing = seen.get(key)
    if (existing) {
      // Bevar kategori-tags fra senere entries hvis vi første gang så
      // dem på en variant uten tag (f.eks. omrade-polygon kommer etter
      // vann-navn-tekstlabelen i pass-rekkefølgen).
      if (r.categories && !existing.categories) existing.categories = r.categories
      continue
    }
    seen.set(key, r)
  }
  return Array.from(seen.values())
}

/**
 * Filtrer indeksen mot et søk. Returnerer maks `limit` treff,
 * prefix-matcher først, så kortere navn først.
 *
 * Kategori-søk: når query er nøyaktig "vann", "innsjo" eller "tjern" (etter
 * folding), inkluderes alle entries med matchende `categories`-tag, ikke
 * bare de der søkeordet står i navnet. Slik får brukeren oversikt over
 * alle blå ferskvann-områder i kartet — inkludert navngitte hvis navn
 * ikke inneholder ordet "vann".
 */
export function filterIndex(index, query, limit = 60) {
  const q = foldName(query)
  if (!q) return []
  // «topp»-søk: kartets N høyeste punkter, sortert på høyde desc. Egen gren
  // (returnerer før den vanlige navne-/kategori-filtreringen) fordi resultatet
  // er en rangert topp-liste, ikke et substring-/kategori-treff. Har kartet ekte
  // topp-markører (brun skrift) bruker vi dem; ellers faller vi tilbake til de
  // høyeste kontur-tallene (røde tall) — det navnløse innlandskartet uten OSM-
  // peaks får da likevel en topp-liste.
  if (PEAK_KEYWORDS.has(q)) {
    const peaks = index.filter(r => r.kind === 'peak' && Number.isFinite(r.ele))
    const pool = peaks.length
      ? peaks
      : index.filter(r => r.kind === 'hoydepunkt' && Number.isFinite(r.ele))
    return pool
      .slice()
      .sort((a, b) => b.ele - a.ele || a.name.localeCompare(b.name, 'no'))
      .slice(0, TOP_PEAKS_COUNT)
  }
  const categoryTag = CATEGORY_ALIASES[q] ?? null
  // Kategori-søk ("vann"/"innsjø"/"tjern"/"parkering") er en OVERSIKT — UI-en
  // lover «alle ferskvann i utsnittet». Et tett norsk skogskart har lett >60
  // navngitte tjern; siden treffene sorteres alfabetisk kappet limit=60 lista
  // rundt bokstaven H, så f.eks. «Landfalltjern» (L) aldri dukket opp.
  // Resultatlista ligger i en scroll-container, så vi kapper IKKE kategori-
  // søk. Fritekst-navnesøk beholder limit (man vil ha topp-N, ikke alt).
  const effLimit = categoryTag != null ? Infinity : limit
  const out = []
  const seenIds = new Set()
  for (const r of index) {
    // Kontur-deriverte høydepunkter er KUN for «topp»-fallbacken — de skal
    // aldri dukke opp i vanlig navne-/kategori-søk (de har syntetiske navn).
    if (r.kind === 'hoydepunkt') continue
    const idx = r.folded.indexOf(q)
    const nameMatch = idx >= 0
    const catMatch = categoryTag != null && r.categories && r.categories.includes(categoryTag)
    if (!nameMatch && !catMatch) continue
    if (seenIds.has(r.id)) continue
    seenIds.add(r.id)
    out.push(r)
  }
  // To-trinns sortering:
  //   1. Navngitte først, alfabetisk (norsk collation — æøå sist).
  //   2. Unavngitte vann-polygoner nederst, sortert etter areal desc
  //      (største vann øverst i den gruppen). De har syntetiske «Innsjø/
  //      Tjern uten navn (~X ha)»-navn som blander seg i alfabetisk
  //      rekkefølge på en ulesbar måte — derfor er de skilt ut.
  out.sort((a, b) => {
    const aUnnamed = a.kind === 'vann-omrade' ? 1 : 0
    const bUnnamed = b.kind === 'vann-omrade' ? 1 : 0
    if (aUnnamed !== bUnnamed) return aUnnamed - bUnnamed
    if (aUnnamed) {
      // Begge er unavngitte vann — sorter etter areal desc
      const aArea = a.areaM2 ?? 0
      const bArea = b.areaM2 ?? 0
      if (aArea !== bArea) return bArea - aArea
    }
    return a.name.localeCompare(b.name, 'no')
  })
  return out.slice(0, effLimit)
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

  const results = computed(() => filterIndex(index.value, query.value, 60))

  return { query, results, index, rebuild, clear }
}
