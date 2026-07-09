// Delt SVG-byggeverktøy for ISOM-inspirerte turkart.
// Bruker WGS84 → UTM 32N og produserer et lagdelt SVG med mm-baserte
// streker (print-kvalitet) basert på en data-drevet ISOM-katalog.
//
// Brukes både fra build-vardasen-svg.js (Node) og fra MapPickerView.vue
// (klient-side ved kart-generering).

import { wgs84ToUtm32, utm32BboxFromWgs84 } from './utm.js'
import {
  classifyToIsom,
  isTrigPoint,
  isMaritimeNameFeature,
  isMaritimeNameOnlyNode,
  isTrailheadParking,
  buildIsomDefs,
  buildIsomCss,
  getIsomDef,
  isomCatalog,
} from './symbolizer.js'
import { buildContours, detectCliffs, detectKnauser, detectSummits } from './dem.js'
import { buildSeaFromDem, buildSeaShallowBands } from './seaFromDem.js'
import { depthBandClass } from './sjokartFetcher.js'
import {
  unionRingsToSea,
  unionPolygonsToSea,
  pointFeatureKept,
} from './marineTopology.js'
import { fetchDEM } from './demFetcher.js'
import { polylineToPath, simplifyDP, isPointNearPolylines } from './pathUtils.js'
import { thinParkering, PARKERING_MIN_SEP_M } from './parkingRules.js'
import { bboxOfPoints, unionBbox, cellKeyFor, bboxAttr } from './spatialBucket.js'
import { classifyBuildings, multiPolyToPath } from './buildingMass.js'
import { computeCHM, sampleCHMInPolygon, classifyVegetationFromCHM } from './canopyHeight.js'
import polygonClipping from 'polygon-clipping'
import {
  raceOverpassMirrors, fetchOverpassWithRetry,
  OVERPASS_TIMEOUT_MS, OVERPASS_TIMEOUT_MAX_MS,
} from './overpassClient.js'

// Overpass-transporten (speil-kappløp + retry/backoff, klient-tak-konstanter)
// bor i overpassClient.js (v12.1.0) — delt med Ruteplanleggerens grusvei-
// overlay. Areal-skaleringen av taket er kart-spesifikk og bor her:
// Server-spørringen har timeout:90, men uten et klient-tak henger «Fyller inn
// stier og detaljer …»-spinneren til server-timeouten slår inn. 30 s er romslig
// for et par km², men taket MÅ skalere med arealet: et stort kart (200–400 km²)
// i tett kyst-/byområde gir en spørring som lovlig bruker 40–80 s på serveren.
// Se overpassTimeoutForBbox.

// Skaler klient-taket med kart-arealet. ~16 km² (4×4) → 30 s; ~200 km² (≈14 km)
// → 90 s; klampet til [30, 90] s. Et større utsnitt = flere OSM-elementer =
// lengre lovlig server-tid, så taket må følge med ellers avbryter vi gyldige svar.
export function bboxAreaKm2(bbox) {
  if (!bbox) return 0
  const midLat = (bbox.north + bbox.south) / 2
  const heightKm = Math.abs(bbox.north - bbox.south) * 111
  const widthKm = Math.abs(bbox.east - bbox.west) * 111 * Math.cos(midLat * Math.PI / 180)
  return heightKm * widthKm
}

export function overpassTimeoutForBbox(bbox) {
  if (!bbox) return OVERPASS_TIMEOUT_MS
  const areaKm2 = bboxAreaKm2(bbox)
  // 30 s baseline + 0.34 s per km² over 16 km² → ~90 s ved ~190 km².
  const scaled = OVERPASS_TIMEOUT_MS + Math.max(0, areaKm2 - 16) * 340
  return Math.round(Math.min(OVERPASS_TIMEOUT_MAX_MS, Math.max(OVERPASS_TIMEOUT_MS, scaled)))
}
// timeoutS: server-timeouten skal matche klient-taket (overpassTimeoutForBbox)
// — en fast [timeout:90] lot en zombie-kjøring fortsette å okkupere server-slots
// i opptil 90 s etter at klienten ga opp ved 30 s, og blokkere våre egne retries.
// includeBuildings=false: way["building"] (den suverent tyngste selektoren i
// tette byområder) flyttes til en egen parallell spørring for store kart —
// se fetchOverpass.
export function buildOverpassQuery(bbox, { timeoutS = 90, includeBuildings = true } = {}) {
  return `
[out:json][timeout:${timeoutS}][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street)$"];
  way["highway"~"^(path|track|bridleway|steps)$"];
  way["natural"="water"];
  way["water"];
  way["natural"="coastline"];
  way["waterway"~"^(stream|river|canal|ditch)$"];
  way["natural"="wetland"];
  way["natural"~"^(wood|scree|bare_rock)$"];
  way["landuse"~"^(forest|meadow|grass|farmland)$"];
${includeBuildings ? '  way["building"];' : ''}
  way["leisure"~"^(park|pitch|playground|stadium|sports_centre|track|horse_racing)$"];
  way["landuse"="recreation_ground"];
  way["building"="stadium"];
  way["sport"="ski_jumping"];
  node["sport"="ski_jumping"];
  relation["leisure"~"^(stadium|sports_centre|track|horse_racing|pitch)$"];
  relation["landuse"="recreation_ground"];
  way["leisure"="nature_reserve"]["name"];
  way["boundary"="protected_area"]["protect_class"~"^(1|1a|1b|4)$"]["name"];
  way["boundary"="national_park"]["name"];
  way["barrier"~"^(fence|wall)$"];
  way["power"="line"];
  way["place"~"^(island|islet)$"];
  way["aerialway"];
  way["railway"~"^(rail|tram|narrow_gauge|light_rail|subway|funicular|monorail)$"];
  way["piste:type"];
  way["leisure"="track"]["sport"="skiing"];
  node["natural"="peak"];
  node["natural"="saddle"];
  node["natural"="cave_entrance"];
  node["man_made"~"^(adit|mineshaft|survey_point|triangulation_pillar)$"];
  node["historic"~"^(mine|survey_point)$"];
  node["survey_point"];
  node["geodesic"];
  node["place"~"^(locality|hamlet|village|town|city|suburb|neighbourhood|quarter|isolated_dwelling|farm)$"];
  node["amenity"="place_of_worship"];
  node["building"~"^(church|chapel)$"];
  way["amenity"="place_of_worship"];
  way["building"~"^(church|chapel)$"];
  node["amenity"="parking"];
  way["amenity"="parking"];
  node["barrier"~"^(gate|lift_gate|swing_gate|bollard|block|cycle_barrier|cattle_grid)$"];
  node["man_made"="lighthouse"];
  way["man_made"="lighthouse"];
  node["seamark:type"];
  node["leisure"="marina"];
  way["leisure"="marina"];
  node["leisure"="slipway"];
  way["leisure"="slipway"];
  way["natural"="beach"];
  node["amenity"="toilets"];
  node["amenity"="drinking_water"];
  node["highway"="bus_stop"];
  node["railway"~"^(station|halt|tram_stop)$"];
  node["public_transport"="station"];
  node["natural"~"^(bay|cape|strait|shoal|reef|peninsula|isthmus)$"]["name"];
  way["natural"~"^(bay|cape|strait|shoal|reef|peninsula|isthmus)$"]["name"];
  node["place"~"^(island|islet)$"]["name"];
  relation["natural"="water"];
  relation["natural"~"^(bay|strait)$"];
  relation["place"~"^(sea|ocean)$"];
  relation["place"~"^(island|islet)$"];
  relation["piste:type"];
  relation["leisure"="nature_reserve"]["name"];
  relation["boundary"="protected_area"]["protect_class"~"^(1|1a|1b|4)$"]["name"];
  relation["boundary"="national_park"]["name"];
);
out geom;
`.trim()
}

// Bygninger i egen spørring for store kart: way["building"] er den suverent
// tyngste selektoren i tette byområder (alle bygningsfotavtrykk) og dominerte
// både server-tid og respons-størrelse. Terskelen 100 km² tilsvarer ~8×12 km.
const BUILDINGS_SPLIT_KM2 = 100

export function buildBuildingsQuery(bbox, { timeoutS = 90 } = {}) {
  return `
[out:json][timeout:${timeoutS}][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];
(
  way["building"];
);
out geom;
`.trim()
}

export async function fetchOverpass(bbox, { signal, query, onProgress } = {}) {
  // Areal-skalert klient-tak: store kyst-/by-kart trenger mer tid på serveren
  // enn et lite kart, ellers avbryter vi et gyldig (men tregt) svar for tidlig.
  // Server-timeouten i spørringen settes til samme verdi — en fast 90 s lot
  // zombie-kjøringer blokkere serverens slots lenge etter at klienten ga opp.
  const timeoutMs = overpassTimeoutForBbox(bbox)
  const timeoutS = Math.ceil(timeoutMs / 1000)
  // `query` lar kalleren be om en alternativ spørring (f.eks. den lette
  // periferi-spørringen for 3×3-fliser); default er den fulle — da splittes
  // bygninger ut i en parallell spørring nr. 2 for store kart, med
  // catch → tomt (feilet bygg-spørring gir kart uten bygninger, ikke feilet kart).
  const splitBuildings = !query && bboxAreaKm2(bbox) > BUILDINGS_SPLIT_KM2
  const mainBody = 'data=' + encodeURIComponent(
    query ?? buildOverpassQuery(bbox, { timeoutS, includeBuildings: !splitBuildings }),
  )
  const mainP = fetchOverpassWithRetry(mainBody, { signal, timeoutMs, onProgress })
  if (!splitBuildings) return mainP
  const bldBody = 'data=' + encodeURIComponent(buildBuildingsQuery(bbox, { timeoutS }))
  const bldP = fetchOverpassWithRetry(bldBody, { signal, timeoutMs }).catch(e => {
    console.warn(`[Overpass] bygnings-spørringen feilet (${e?.message ?? e}) — kartet bygges uten bygninger`)
    return null
  })
  const [main, bld] = await Promise.all([mainP, bldP])
  if (bld?.elements?.length) {
    const seen = new Set((main.elements ?? []).map(el => `${el.type}/${el.id}`))
    const extra = bld.elements.filter(el => !seen.has(`${el.type}/${el.id}`))
    main.elements = [...(main.elements ?? []), ...extra]
  }
  return main
}

// Mini-kystlinje-probe: en bitteliten Overpass-spørring (out ids, maks 1
// element, ~200 B svar) som avgjør «finnes OSM-saltvann i bbox?» på 1–3 s i
// stedet for å vente på hele hoved-spørringen. Selektorene MÅ speile
// bboxHasOsmSaltwater-predikatet (natural=coastline + isOsmWaterSalty i
// symbolizer.js): salt/tidal=yes, place=sea/ocean, natural=bay/strait
// (navngitt for node/way — hovedspørringen henter kun navngitte),
// water=sea/bay/strait/lagoon/cove. Paritet håndheves av enhetstest.
export function buildCoastProbeQuery(bbox) {
  return `
[out:json][timeout:10][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];
(
  way["natural"="coastline"];
  nwr["salt"="yes"];
  nwr["tidal"="yes"];
  nwr["place"~"^(sea|ocean)$"];
  node["natural"~"^(bay|strait)$"]["name"];
  way["natural"~"^(bay|strait)$"]["name"];
  relation["natural"~"^(bay|strait)$"];
  nwr["water"~"^(sea|bay|strait|lagoon|cove)$"];
);
out ids qt 1;
`.trim()
}

// Kjør kystlinje-proben: returnerer true/false, kaster ved nettverksfeil
// (kalleren faller da tilbake til det autoritative Overpass-svaret).
// Ett kappløp, ingen retries — dette er en optimalisering, ikke en kilde.
export async function probeCoastline(bbox, { signal } = {}) {
  const body = 'data=' + encodeURIComponent(buildCoastProbeQuery(bbox))
  const data = await raceOverpassMirrors(body, { signal, timeoutMs: 12000 })
  return (data?.elements?.length ?? 0) > 0
}

// v10.1.10: kartet skal FYLLE portrett-skjermen med ekte terreng i stedet for å
// vises kvadratisk med cream-letterbox over/under (kvadratisk kart tilpasset
// bredden på en høy skjerm → tomme bånd nord/sør). Derfor er bbox-en ikke lenger
// låst kvadratisk: `aspect` (= høyde/bredde) strekker N/S-utstrekningen så meter-
// rommet matcher skjerm-formatet. E/V (bredden = brukerens valgte størrelse) er
// uendret; vi legger KUN til terreng nord og sør. aspect=1 ⇒ kvadrat (uendret).
export function bboxFromCenter(lat, lon, halfKm, aspect = 1) {
  const dLon = halfKm / (111 * Math.cos(lat * Math.PI / 180))   // halv-bredde E/V (uendret)
  const dLat = (halfKm * aspect) / 111                          // halv-høyde N/S (strukket)
  return {
    south: lat - dLat,
    north: lat + dLat,
    west: lon - dLon,
    east: lon + dLon,
  }
}

// Skjerm-formatet (høyde/bredde) som kartets N/S-strekk skal følge, så et nytt
// kart fyller MapView i fullskjerm uten letterbox. Klampet [1, 2.2]: aldri
// smalere enn kvadrat (vi utvider bare nord/sør, aldri øst/vest — selv på
// liggende nettbrett faller vi tilbake til kvadrat), og aldri mer enn 2.2 så
// data-uttrekket (DEM/Overpass) ikke eksploderer på ekstreme skjermer. Uten
// `window` (worker/SSR/test) → 1 (kvadrat, byte-identisk med før).
export function viewportAspect() {
  if (typeof window === 'undefined') return 1
  const w = window.innerWidth, h = window.innerHeight
  if (!w || !h) return 1
  return Math.max(1, Math.min(2.2, h / w))
}

// A-format (A4/A3/A2 …) stående høyde/bredde-forhold = √2 ≈ 1,4142. Et kart med
// denne aspekten passer rett inn på et stående A-ark ved print/PDF/SVG-eksport
// uten margin-tilpasning. Brukes av auto-kart (v10.1.x) og «tilpass til
// utskrift»-valget i picker-en.
export const PRINT_ASPECT = Math.SQRT2

// Auto-kart-dimensjoner i A-format. I stedet for å strekke N/S til hele skjerm-
// formatet (~1:2.2 på portrett-mobil → smalt, lite slingringsrom øst/vest)
// BEHOLDER vi den skjerm-utledede HØYDEN og utvider bredden til A-format. Det
// gir «litt ekstra venstre/høyre» (man kan dra utover uten å zoome først) og et
// print-klart utsnitt. Returnerer { halfKm, aspect } klart til buildMapFromCenter.
//   høyde = 2·halfKm·viewportAspect()   (uendret fra før)
//   bredde = høyde / √2                 (A-format)
export function autoMapAFormat(halfKm) {
  const heightKm = 2 * halfKm * viewportAspect()
  const widthKm = heightKm / PRINT_ASPECT
  return { halfKm: widthKm / 2, aspect: PRINT_ASPECT }
}

// Auto-kart-dimensjoner i kvadrat (default for forsidens søk/GPS-flyt, v11.0.32).
// Vi BEHOLDER den skjerm-utledede høyden (samme som autoMapAFormat) og utvider
// bredden til den matcher høyden — så utsnittet blir kvadratisk i stedet for et
// smalt A-format-portrett. Returnerer { halfKm, aspect } klart til
// buildMapFromCenter.
//   høyde = 2·halfKm·viewportAspect()   (uendret fra A-format)
//   bredde = høyde                      (kvadrat ⇒ aspect = 1)
export function autoMapSquare(halfKm) {
  const heightKm = 2 * halfKm * viewportAspect()
  return { halfKm: heightKm / 2, aspect: 1 }
}

// Minste avstand (meter) mellom to holdeplass-symboler før vi anser dem som
// «samme stopp» og slår dem sammen. Store buss-/togterminaler (Asker, Sandvika)
// har én OSM-node pr busslomme/p-plass; ett ISOM-symbol pr lomme blir en uleselig
// klynge. Holdt lavt (25 m) så genuint atskilte stopp tett på hverandre overlever
// — f.eks. holdeplass på BEGGE sider av en jernbanelinje/vei. Se clusterHoldeplasser().
export const HOLDEPLASS_MIN_SEP_M = 25

// Tilnærmet avstand i meter mellom to lat/lon-punkter (ekvirektangulær — god nok
// for klynge-radius på titalls meter, ingen proj4 nødvendig).
function metersBetween(a, b) {
  const R = 6371000
  const lat0 = ((a.lat + b.lat) / 2) * (Math.PI / 180)
  const dLat = (b.lat - a.lat) * (Math.PI / 180)
  const dLon = (b.lon - a.lon) * (Math.PI / 180) * Math.cos(lat0)
  return R * Math.hypot(dLat, dLon)
}

/**
 * Tynner ut holdeplass-noder så vi ikke renderer en tett klynge av identiske
 * buss-/tog-symboler (typisk på terminaler der hver busslomme/p-plass er sin
 * egen OSM-node). Regel: holdeplasser repeteres ikke med mindre det er minst
 * `minSepM` meter mellom punktene.
 *
 * Klyngene bygges med single-linkage union-find (to noder under `minSepM` havner
 * i samme klynge, transitivt — en sammenhengende terminal blir én klynge). For
 * hver klynge beholdes den MIDTERSTE noden (den nærmest klyngens tyngdepunkt) og
 * resten skjules. Enkeltstående holdeplasser (ingen nabo innen `minSepM`) er sin
 * egen klynge og beholdes uendret.
 *
 * O(n²) avstands-sjekk er trivielt her — antall holdeplasser i et kart-utsnitt
 * er lite (titalls, ikke tusener).
 *
 * @param {Array} nodes  OSM-noder ({ type:'node', lat, lon, tags })
 * @param {number} minSepM  minste avstand i meter (default HOLDEPLASS_MIN_SEP_M)
 * @returns {Array}  representant-noder (én pr klynge), i opprinnelig rekkefølge
 */
export function clusterHoldeplasser(nodes, minSepM = HOLDEPLASS_MIN_SEP_M) {
  const pts = (nodes || []).filter(
    n => n && n.type === 'node' && Number.isFinite(n.lat) && Number.isFinite(n.lon)
  )
  const n = pts.length
  if (n <= 1) return pts.slice()

  // Union-find (med sti-kompresjon) over par som ligger nærmere enn minSepM.
  const parent = pts.map((_, i) => i)
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (metersBetween(pts[i], pts[j]) < minSepM) union(i, j)
    }
  }

  // Grupper på rot, og velg representant = noden nærmest klyngens tyngdepunkt.
  const groups = new Map()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(pts[i])
  }
  const keep = new Set()
  for (const g of groups.values()) {
    if (g.length === 1) { keep.add(g[0]); continue }
    let clat = 0, clon = 0
    for (const p of g) { clat += p.lat; clon += p.lon }
    clat /= g.length; clon /= g.length
    let best = g[0], bestD = Infinity
    for (const p of g) {
      const d = metersBetween(p, { lat: clat, lon: clon })
      if (d < bestD) { bestD = d; best = p }
    }
    keep.add(best)
  }
  // Bevar opprinnelig rekkefølge (stabil output, lettere å diffe).
  return pts.filter(p => keep.has(p))
}

// Parkerings-uttynning (min-avstand + utfart-unntak) bor i parkingRules.js
// (delt med Ruteplanleggeren, v12.1.16) — re-eksporteres her så eksisterende
// imports/tester er uendret.
export { thinParkering, PARKERING_MIN_SEP_M } from './parkingRules.js'

// v9.1.7: 1 desimal i meter-rom = 0.1 m ≈ 0.01 mm @ 1:10 000 — langt under
// sub-piksel, men sparer ~1 tegn pr koordinat (mindre SVG, raskere parse).
function fmt(n) { return Number(n.toFixed(1)) }

/**
 * Forenkle et pier-/havnestruktur-polygon (ISOM 551) til en ren form med maks
 * `maxV` hjørner. Sjøkart-WFS gir ofte forvridde ringer med mange punkter for
 * kaier/moloer; vi trenger ikke den eksakte fasongen — bare at strukturen er
 * identifiserbar.
 *
 * Strategi: Visvalingam-Whyatt — fjern gjentatte ganger det hjørnet som danner
 * minst triangel-areal med naboene (minst form-tap) til vi er nede i maxV
 * hjørner. I motsetning til konveks innhylling BEVARER dette konkaviteter, så
 * en L-formet molo beholder knekken (signifikant hjørne = stort areal = beholdt)
 * mens støy-punkter på rette strekk fjernes. maxV=6 gir rom for L-formen
 * (sekskant), trekanter/firkanter/femkanter faller naturlig ut for enklere kaier.
 *
 * @param {Array<[number,number]>} pts  projiserte [x,y]-punkter (lukket ring, kan ha gjentatt startpunkt)
 * @param {number} [maxV=6]
 * @returns {Array<[number,number]>}  forenklet ring (uten gjentatt startpunkt)
 */
function simplifyPierPolygon(pts, maxV = 6) {
  // Fjern gjentatt sluttpunkt + sammenfallende nabo-punkter (degenererte kanter)
  const ring = []
  for (const p of pts) {
    const last = ring[ring.length - 1]
    if (last && Math.abs(last[0] - p[0]) < 0.05 && Math.abs(last[1] - p[1]) < 0.05) continue
    ring.push(p)
  }
  if (ring.length > 1) {
    const a = ring[0], b = ring[ring.length - 1]
    if (Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05) ring.pop()
  }
  if (ring.length <= 3) return ring
  const triArea = (a, b, c) =>
    Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
  while (ring.length > maxV) {
    let minArea = Infinity
    let minIdx = -1
    for (let i = 0; i < ring.length; i++) {
      const prev = ring[(i - 1 + ring.length) % ring.length]
      const next = ring[(i + 1) % ring.length]
      const a = triArea(prev, ring[i], next)
      if (a < minArea) { minArea = a; minIdx = i }
    }
    ring.splice(minIdx, 1)
  }
  return ring
}

/**
 * Mutate ring i-place så orienteringen passer polygon-clipping (CCW i
 * standard y-up math = positivt shoelace signed area). I SVG y-down
 * blir det visuelt CW. Hvis ringen er feil vei, reverseres den.
 *
 * Polygon-clipping forutsetter strikt CCW outer + CW holes; uten denne
 * fix-en tolker biblioteket innkommende CW-rings som hull og produserer
 * invertert union (wedger).
 */
function ensureCCWForPolygonClipping(ring) {
  if (ring.length < 3) return
  // Shoelace med y-up math-konvensjon
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  // Negativt = CW i y-up = visuelt CCW i y-down → reverser så y-up blir CCW
  if (a < 0) ring.reverse()
}

// XML-escaping for tekst OG attributtverdier. Brukes overalt navn/etiketter
// fra OSM legges inn i SVG-en (data-name="…", <text>…</text>). Må dekke BÅDE
// innholds- og attributt-konteksten, ellers blir hele SVG-en ugyldig XML og
// MapView feiler med «Ugyldig SVG»:
//   - " (og ') escapes — et anførselstegn i et navn (vanlig i store byer som
//     Stockholm, sjeldnere på norske kart) lukket ellers data-name="…"-attr-
//     ibuttet midt i og brøt parsingen. DETTE var Stockholm-buggen.
//   - C0-kontrolltegn (untatt tab/LF/CR) er ULOVLIGE i XML 1.0 selv escaped,
//     så de strippes — et stray kontrolltegn i et OSM-navn ga ellers parsererror.
function xmlEscape(s) {
  return String(s)
    // Strip C0-kontrolltegn (untatt tab/LF/CR) — ulovlige i XML 1.0 selv escaped.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Sy sammen OSM-multipolygon relation-medlemmer til lukkede ringer.
 *
 * OSM lagrer multipolygon-relations som array av ways, der hver way er
 * et SEGMENT av en ring (ikke nødvendigvis lukket polygon). For å
 * rendre korrekt må vi greedy-joine segmenter med matchende endepunkter
 * til lukkede ringer.
 *
 * Tidligere bug: vi rendret hver way som sin egen polygon (path med Z),
 * så et lake-relation med 4 shore-segmenter ble 4 trekanter (wedger!).
 *
 * @param {Array<{type, geometry, role}>} members  relation.members
 * @param {string} role  'outer' eller 'inner'
 * @returns {Array<Array<{lat,lon}>>}  liste av sammensydde ringer
 */
function assembleRelationRings(members, role) {
  // Aksepter både eksplisitt rolle og tom rolle. OSM multipolygon-relations
  // bruker konsekvent 'outer'/'inner', men place=island/islet-relations har
  // ofte tom rolle ('') — de mangler outer/inner-distinksjon siden hele
  // relasjonen ER én øy. Når role='outer' og ingen members har den rollen,
  // faller vi tilbake til members med tom rolle (= alle relevante ways).
  const explicit = members
    .filter(m => m.type === 'way' && m.role === role && Array.isArray(m.geometry) && m.geometry.length >= 2)
  const fallback = role === 'outer' && explicit.length === 0
    ? members.filter(m => m.type === 'way' && (m.role === '' || m.role == null) && Array.isArray(m.geometry) && m.geometry.length >= 2)
    : []
  const segments = [...explicit, ...fallback].map(m => m.geometry.slice())
  const eps = 1e-6  // grader (~0.1 m ved 60° N)
  const samePt = (a, b) => Math.abs(a.lat - b.lat) < eps && Math.abs(a.lon - b.lon) < eps
  const rings = []
  while (segments.length > 0) {
    let chain = segments.shift()
    // Allerede lukket?
    if (samePt(chain[0], chain[chain.length - 1])) {
      rings.push(chain)
      continue
    }
    // Greedy: prøv å append/prepend andre segmenter til chain blir lukket
    let merged = true
    while (merged) {
      merged = false
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        const head = chain[0], tail = chain[chain.length - 1]
        const sHead = seg[0], sTail = seg[seg.length - 1]
        if (samePt(tail, sHead)) {
          chain = chain.concat(seg.slice(1))
          segments.splice(i, 1); merged = true; break
        }
        if (samePt(tail, sTail)) {
          chain = chain.concat(seg.slice(0, -1).reverse())
          segments.splice(i, 1); merged = true; break
        }
        if (samePt(head, sTail)) {
          chain = seg.slice(0, -1).concat(chain)
          segments.splice(i, 1); merged = true; break
        }
        if (samePt(head, sHead)) {
          chain = seg.slice(1).reverse().concat(chain)
          segments.splice(i, 1); merged = true; break
        }
      }
      // Lukket?
      if (samePt(chain[0], chain[chain.length - 1])) break
    }
    if (chain.length >= 3) rings.push(chain)
  }
  return rings
}

/**
 * Slå sammen ways som har samme `name`-tag til én polygon. Bruker
 * polygon-clipping union på SVG-projiserte ringer. Returnerer en
 * blanding av originale (unike eller navnløse) ways og syntetiske
 * "merged-water"-elementer med _mergedRings (polygon-clipping format:
 * MultiPolygon = array av polygoner, hver polygon = array av ringer).
 *
 * Fanger opp typisk OSM-tilfelle der en innsjø er delt over et sund/bro
 * og hver del har samme navn (f.eks. Setten med Hestesund-bro).
 */
function unionByName(elements, project) {
  const byName = new Map()
  const result = []

  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 3) {
      result.push(el)
      continue
    }
    const name = el.tags?.name?.trim()
    if (!name) {
      result.push(el)
      continue
    }
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name).push(el)
  }

  for (const [name, group] of byName) {
    if (group.length === 1) {
      result.push(group[0])
      continue
    }
    try {
      const inputs = group.map(el => {
        const ring = el.geometry.map(g => {
          const p = project(g.lat, g.lon)
          return [p.x, p.y]
        })
        if (ring.length > 0) {
          const f = ring[0], l = ring[ring.length - 1]
          if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]])
        }
        // polygon-clipping krever CCW outer-rings (positivt signed area i
        // standard y-up matematikk-konvensjon). Vi jobber i SVG y-down,
        // så CCW visuelt = NEGATIVT signed area i shoelace-formula.
        // Hvis ringen er CW visuelt (positivt signed area i y-down =
        // negativt y-up), reverser så biblioteket tolker den som outer
        // istedenfor hull. Bug-en før dette fix-en var at polygon-clipping
        // tolket CW-rings som "hull" og produserte invertert union →
        // wedger og merkelige polygoner.
        ensureCCWForPolygonClipping(ring)
        return [[ring]]
      })
      const merged = polygonClipping.union(...inputs)
      result.push({
        type: 'merged-water',
        id: group[0].id,
        tags: { ...group[0].tags },
        _mergedRings: merged,
        _mergedFromCount: group.length,
      })
      console.log(`[Vann-merge] "${name}": ${group.length} → 1 multipolygon`)
    } catch (e) {
      console.warn(`[Vann-merge] "${name}" feilet (${e.message}) — beholder originalene`)
      result.push(...group)
    }
  }

  return result
}

// Layer-rekkefølge (z-order, bunn til topp). Inspirert av ISOM 2017.
//
// Merk: ISOM 522 (tett bebyggelse) er ikke listet her — den rendres
// separat fra urbanMassMultiPoly mellom GROUND_CODES og WATER_CODES
// slik at vann og høydekurver legger seg over bymassen og forblir
// lesbare i tett bebygde områder (f.eks. Oslo sentrum). v8.9.28: 522
// toggles sammen med 521 under «Bygninger»-bryteren (categoryFor →
// 'bygning'), men beholdes som eget render-pass for å holde SVG-
// størrelsen i sjakk i tettbygde områder.
// 512 (slalombakke) er areal-feature og rendres som ground sammen med
// vegetasjon — under vann og over skog så bakken vises tydelig.
// 513 (idrettsanlegg: stadion/idrettsbane/travbane/hoppbakke/arena) rendres
// samme sted — et bunn-areal med anleggets «baneform» som stier/konturer/
// veier legger seg lesbart oppå. Eget toggle-lag («Idrettsanlegg»).
const GROUND_CODES = ['401', '403', '404', '406', '407', '408', '409', '210', '512', '513']
// Vann-stack: dybdeareal (Sjøkart 307, diskrete blå-bånd pr dybde) først,
// så myr-pattern, så ISOM 303/301/302 (mer mettete blå overstyrer for navn-
// gitte vann), så bekker.
// v8.9.25: ISOM 306 (dybdekontur-linjer) er fjernet — de lå alt for tett
// og maskerte fargebåndene. Dybde formidles nå via 307-polygonens
// fargeskala (depthToColor) som har 4 distinkte blå-bånd.
const WATER_CODES  = ['307', '308', '309', '303', '301', '302', '304', '305']
// Land-overlay: OSM `place=island/islet` polygoner i kremgul som dekker
// over feilplassert OSM-vann. Renders ETTER vann-stacken.
const LAND_OVERLAY_CODES = ['001']
// Strand / badeplass (ISOM-derivert 556, v9.3.37): sand-stippel-areal i
// strandens faktiske form. Renders ETTER vann + øy-overlay (sand ligger på
// strandlinja, over vannet) men FØR konturer/veier. Eget toggle-lag
// (categoryFor → 'strand'), default PÅ i MapView.
const STRAND_CODES = ['556']
// Naturreservat / verneområde (ISOM 520-derivert): semi-transparent grønn
// overlay rendret ETTER vann men FØR konturer/veier, slik at underliggende
// terreng forblir lesbart og konturer/stier tydelig tegnes oppå.
const PROTECTED_CODES = ['520']
const ROAD_CODES   = ['501', '502', '503', '504', '515', '505', '506', '507', '510', '511']
// 551 (kai/brygge/molo) + 552 (fareområde) — Sjøkart-areal-koder. Sparsomme,
// rendres øverst sammen med øvrige man-made-areal. 551 → eget lag (categoryFor
// 'kai', egen drawer-toggle, default PÅ); 552 → 'sjo-poi'.
const UPPER_CODES  = ['521', '525', '528', '551', '552']
// Plassholder-koder for lag som rendres separat (konturer/stupkanter).
const PLACEHOLDER_CODES = ['101', '102', '103', '104', '201', '203']
const LAYER_ORDER = [
  ...GROUND_CODES,
  ...WATER_CODES,
  ...LAND_OVERLAY_CODES,
  ...STRAND_CODES,
  ...PROTECTED_CODES,
  ...PLACEHOLDER_CODES,
  ...ROAD_CODES,
  ...UPPER_CODES,
  '522',
]

// Fase 3: marine / padle-POI som rendres som punkt-symboler (eget render-
// pass, ikke via LAYER_ORDER/layerSvg). `requireWater` styrer topologisk
// validering (Marker ∈ Water): skjær og flytende sjømerker er nonsens på
// land og droppes hvis de faller utenfor den autoritative kysten. Fyr,
// landingssteder, marina, toalett og drikkevann er land-/strand-side og
// beholdes uansett. Symbol + størrelse hentes fra isomCatalog pr kode.
const MARINE_POINT_CODES = {
  '211': { requireWater: true, flagIfDry: true },   // skjær / grunne — FARE: flagg, ikke slett
  '533': { requireWater: false },  // fyr / lykt / lanterne
  '540': { requireWater: true },   // sjømerke babord
  '541': { requireWater: true },   // sjømerke styrbord
  '542': { requireWater: true },   // cardinal-sjømerke
  '543': { requireWater: true },   // sjømerke (generisk beacon/buoy)
  '550': { requireWater: false },  // slipp / landingssted
  '553': { requireWater: false },  // småbåthavn / marina
  '554': { requireWater: false },  // toalett
  '555': { requireWater: false },  // drikkevann
  // 556 (strand) er flyttet fra punkt-ikon til AREAL (sand-stippel-flate) i
  // v9.3.37 — se STRAND_CODES + POLYGON_CODES. Ikonet er fjernet helt.
}

// Slipp/landingssted (550): Sjøkart-datasettet har én app:Slipp-feature pr
// fysisk båtslipp, så en småbåthavn gir 15–20 identiske blå piler på samme
// strand (rapportert Kirkenes, v12.1.52). Klynges som holdeplasser: 550-
// punkter nærmere enn minSepM slås transitivt sammen (union-find), og
// representanten nærmest klyngens tyngdepunkt beholdes. Andre marine koder
// røres IKKE — skjær og sjømerker er individuelt navigasjons-relevante.
// Opererer på ferdig prosjiserte punkter ({ code, p: {x, y} } i meter) og
// bevarer opprinnelig rekkefølge.
export function clusterLandingssteder(placed, minSepM = 40) {
  const idx = []
  for (let i = 0; i < placed.length; i++) {
    if (placed[i].code === '550') idx.push(i)
  }
  if (idx.length <= 1) return placed.slice()

  const parent = idx.map((_, i) => i)
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  for (let i = 0; i < idx.length; i++) {
    for (let j = i + 1; j < idx.length; j++) {
      const a = placed[idx[i]].p, b = placed[idx[j]].p
      if (Math.hypot(a.x - b.x, a.y - b.y) < minSepM) union(i, j)
    }
  }

  const groups = new Map()
  for (let i = 0; i < idx.length; i++) {
    const r = find(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(idx[i])
  }
  const keep = new Set()
  for (const g of groups.values()) {
    if (g.length === 1) { keep.add(g[0]); continue }
    let cx = 0, cy = 0
    for (const i of g) { cx += placed[i].p.x; cy += placed[i].p.y }
    cx /= g.length; cy /= g.length
    let best = g[0], bestD = Infinity
    for (const i of g) {
      const d = Math.hypot(placed[i].p.x - cx, placed[i].p.y - cy)
      if (d < bestD) { bestD = d; best = i }
    }
    keep.add(best)
  }
  return placed.filter((q, i) => q.code !== '550' || keep.has(i))
}

const POLYGON_CODES = new Set(['001', '401', '403', '404', '406', '407', '408', '409', '210', '301', '302', '303', '307', '308', '309', '512', '513', '520', '521', '522', '551', '552', '556'])
const LINE_CODES = new Set(['304', '305', '501', '502', '503', '504', '505', '506', '507', '510', '511', '515', '525', '528', '201', '203', '101', '102', '103', '104'])

/**
 * Bygg ferdig SVG-streng for et bbox + Overpass-elementer. ISOM-inspirert
 * symbolisering med mm-baserte streker for print.
 *
 * @param {Array} elements   - Overpass-elementer
 * @param {Object} bbox      - { south, west, north, east } i WGS84
 * @param {Object} [options]
 * @param {number} [options.scaleDenom=10000]
 * @param {boolean} [options.printSize=true]
 * @param {Object} [options.dem]               Pre-prosessert DEM (valgfritt)
 * @param {number} [options.contourIntervalM=5]
 * @param {boolean} [options.includeCliffs=true]
 * @returns {{ svg: string, counts: object, meta: object }}
 */
export function buildSvg(elements, bbox, options = {}) {
  const {
    scaleDenom = 10000,
    printSize = true,
    dem = null,
    dom = null,                    // Digital overflate-modell for CHM/vegetasjon
    contourIntervalM = 5,
    includeCliffs = true,
    includeKnauser = true,
    includeBuildingMass = true,    // ISOM 522 tett-bebyggelse (tung union)
    skipContoursIfSynthetic = false,
    skipDemSea = false,
    utmBbox = null,                // authoritativ UTM-extent fra kalleren (se under)
    coastal = null,                // true=kyst (ekte sjø), false=innland, null=ukjent.
                                   // Settes av createMapFlow (DEM-havflate + OSM-kystlinje/
                                   // saltvann). Brukes av MapView til å være ærlig om at
                                   // ~0 m over en innlands-vannflate er en DEM-artefakt.
    sjokartStatus = null,          // utfall av Sjøkart-WFS-hentingen (summarizeSjokartStatus)
    kulturminner = [],             // Kulturminnesøk brukerminner (hentet i createMapFlow)
  } = options

  // «Fjern routes generelt» (v10.2.43): rute-relasjoner og rute-taggede
  // elementer (buss/sykkel/vandre-linjer, ferge-ruter, løyper — type=route /
  // route_master eller route=*) er aldri ekte kart-areal. Navnet deres er
  // typisk en lang «A – B / A – (C) – B»-streng (busslinje) som forurenset
  // område-navn-laget OG søk/highlight. De skal ikke bidra til NOE i pipelinen,
  // så vi luker dem ut helt før all videre prosessering.
  elements = (elements ?? []).filter(el => {
    const t = el?.tags
    if (!t) return true
    return !(t.route || t.type === 'route' || t.type === 'route_master')
  })

  // Lett timing-instrumentering: måler de tunge stegene og returneres som
  // `timings` (logges av createMapFlow). includeCliffs/includeBuildingMass = false
  // (progressiv fase-1) hopper over de to dyreste CPU-lagene.
  const timings = {}
  const _now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const _time = (label, fn) => {
    const t0 = _now()
    const r = fn()
    timings[label] = +(_now() - t0).toFixed(1)
    return r
  }

  // Hvis DEM er syntetisk og bruker har bedt om at vi skal hoppe over
  // konturer i det tilfellet, bruk DEM kun til ingenting (eller faktisk
  // dropp den helt slik at hopp-igjennom-koden ikke prøver å bygge konturer)
  const isSyntheticDEM = dem?.source?.startsWith('synthetic')
  const usableDem = (skipContoursIfSynthetic && isSyntheticDEM) ? null : dem

  // UTM-extent. Foretrekk en authoritativ utmBbox fra kalleren (createMapFlow
  // sender sin snappede bboks så viewBox + DEM-extent er bit-eksakt like, og
  // periferi-fliser får sin eksakte rutenett-bboks). Ellers utled fra WGS84-
  // bboksen med ALLE fire hjørner (utm32BboxFromWgs84) så kartet blir kvadratisk
  // uavhengig av meridiankonvergens — SW+NE-diagonalen alene ga portrett-kart.
  const { minE, maxE, minN, maxN } = utmBbox ?? utm32BboxFromWgs84(bbox)
  const widthM = maxE - minE
  const heightM = maxN - minN

  const project = (lat, lon) => {
    const utm = wgs84ToUtm32(lat, lon)
    return {
      x: utm.e - minE,
      y: heightM - (utm.n - minN),
    }
  }

  // Som pathFromGeometry, men returnerer også featurens bbox (beregnet fra
  // post-simplify-punktene — gratis, de er allerede i hånden). Bboksen driver
  // romlig bucketing + data-bbox-emisjon (se spatialBucket.js).
  const pathAndBboxFromGeometry = (geom, close = false, simplifyToleranceM = 0) => {
    if (!geom || geom.length === 0) return { d: '', bbox: null }
    let pts = geom.map(g => {
      const p = project(g.lat, g.lon)
      return [p.x, p.y]
    })
    if (simplifyToleranceM > 0 && pts.length > 3) {
      pts = simplifyDP(pts, simplifyToleranceM)
    }
    if (pts.length === 0) return { d: '', bbox: null }
    // v11.0.50: heltalls-meter for polygon-koordinater (vegetasjon/vann/bygg).
    // 1 m = 0,1 mm @ 1:10 000 — under en piksel, usynlig — men kutter ~10–15 %
    // av path-bytene på de polygon-tunge lagene (vs. 1-desimal). Rund FØR både
    // d og bbox bygges, så data-bbox-en (culling) matcher de emitterte koordene
    // eksakt. `fmt` brukes også for mm-symbolstørrelser og røres ikke.
    const rpts = pts.map((p) => [Math.round(p[0]), Math.round(p[1])])
    let d = `M${rpts[0][0]},${rpts[0][1]}`
    for (let i = 1; i < rpts.length; i++) {
      d += `L${rpts[i][0]},${rpts[i][1]}`
    }
    if (close) d += 'Z'
    return { d, bbox: bboxOfPoints(rpts) }
  }
  const pathFromGeometry = (geom, close = false, simplifyToleranceM = 0) =>
    pathAndBboxFromGeometry(geom, close, simplifyToleranceM).d

  // Beregn approksimert polygon-areal i m² for et OSM-way
  const polygonAreaM2 = (geom) => {
    if (!geom || geom.length < 3) return 0
    const pts = geom.map(g => project(g.lat, g.lon))
    let a = 0
    for (let i = 0, n = pts.length; i < n; i++) {
      const j = (i + 1) % n
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
    }
    return Math.abs(a) / 2
  }

  // Areal-vektet polygon-sentroid i SVG-koord. Returnerer null for
  // degenererte polygoner (areal ≈ 0). Brukes til å plassere
  // elevasjons-label inne i innsjø-polygoner.
  const polygonCentroid = (geom) => {
    if (!geom || geom.length < 3) return null
    const pts = geom.map(g => project(g.lat, g.lon))
    let cx = 0, cy = 0, area = 0
    for (let i = 0, n = pts.length; i < n; i++) {
      const j = (i + 1) % n
      const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y
      cx += (pts[i].x + pts[j].x) * cross
      cy += (pts[i].y + pts[j].y) * cross
      area += cross
    }
    area /= 2
    if (Math.abs(area) < 1e-6) return null
    return { x: cx / (6 * area), y: cy / (6 * area) }
  }

  // Per-kategori forenkling og filtrering. Tunet for å holde SVG <1.5 MB
  // selv i tett bebygde områder som Vardåsen-bbox.
  //
  // v8.10.3 — Perf: skalér tersklene med kart-størrelse. Et 10×10 km kart
  // har 4× areal av et 5×5 km — uten skalering blir det fire ganger så mange
  // DOM-noder å rendre på samme skjerm. simplifyM skaleres med √(factor)
  // (mildere — bevarer hjørne-detalj på små polygoner), mens minAreaM2
  // skaleres lineært (filtrerer aggressivt på små features som likevel ikke
  // er synlige i 1:10000 ved fullt utzoomet kart). Referanse-størrelse 5 km;
  // factor er clampet [0.7, 2.5] så ekstreme bbox ikke kollapser geometri.
  const sizeFactor = Math.max(0.7, Math.min(2.5, widthM / 5000))
  const simpScale = Math.sqrt(sizeFactor)
  const areaScale = sizeFactor
  // Fast vegetasjons-DP i bakke-meter (se POLYGON_FILTER under). 3.0 m =
  // 0,3 mm @ 1:10 000 — skarpe nok grenser, uavhengig av kart-størrelse.
  const VEG_SIMPLIFY_M = 3.0
  const POLYGON_FILTER = {
    // v8.9.30: senket bygning-terskelene så hytter (typisk 20–60 m²) ikke
    // forsvinner. 80 m² filtrerte bort hele kategorier av småhytter i
    // marka, og simplifyM 3.0 kollapset korner på små rektangler
    // (4×4 m polygon med DP 3.0 → degenerert). 10 m² + 1.5 m DP bevarer
    // hytter og spikertelt, mens skur < 10 m² fortsatt filtreres bort.
    // v11.0.47: vegetasjons-FORENKLING bindes til BAKKE-METER (fast 3.0 m),
    // ikke kart-areal. Tidligere vokste den med √(sizeFactor) → opptil ~6,3 m
    // DP på et 20 km-kart, som blobbet vegetasjonsgrensene mens konturene (fast
    // DP i dem.js) holdt seg skarpe — en mismatch som leses som «feil».
    // Vegetasjonsgrenser er navigasjons-håndtak (kanten av en lysning/grønntunge),
    // så formtroskap teller mer enn de få ekstra bytene. minAreaM2 beholder
    // areal-skaleringen — å DROPPE hele små polygoner er den legitime perf-leveren.
    bygning: { simplifyM: 1.5 * simpScale, minAreaM2: 10 * areaScale },
    skog:    { simplifyM: VEG_SIMPLIFY_M, minAreaM2: 300 * areaScale },
    eng:     { simplifyM: VEG_SIMPLIFY_M, minAreaM2: 300 * areaScale },
    aker:    { simplifyM: VEG_SIMPLIFY_M, minAreaM2: 300 * areaScale },
    myr:     { simplifyM: 2.5 * simpScale, minAreaM2: 150 * areaScale },
    vann:    { simplifyM: 2.0 * simpScale, minAreaM2: 50 * areaScale },
    aapen:   { simplifyM: VEG_SIMPLIFY_M, minAreaM2: 300 * areaScale },
    // Naturreservat: maxAreaM2 = 200 km² er forsvar mot OSM-mistags. Norges
    // største naturreservat (Mølen) er ~7 km²; største landskapsvernområde
    // (Trillemarka-Rollagsfjell) er 147 km². 200 km² catcher alle ekte
    // verneområder mens markalov-/friluftslivs-mistags (Oslomarka ~1700 km²)
    // filtreres bort. Område-cappingen lever i layerSvg() siden den er
    // POLYGON_FILTER-drevet.
    naturreservat: { simplifyM: 3.0 * simpScale, minAreaM2: 1000 * areaScale, maxAreaM2: 200_000_000 },
  }
  const LINE_SIMPLIFY = {
    'vei-stor':  1.5 * simpScale,
    'vei-liten': 2.5 * simpScale,
    sti:         2.5 * simpScale,
    bekk:        2.0 * simpScale,
    tog:         2.0 * simpScale,
  }

  // Bucket pr ISOM-kode
  const buckets = {}
  for (const code of LAYER_ORDER) buckets[code] = []
  const peaks = []
  const places = []
  const huler = []         // ISOM 215 (cave entrance)
  const gruver = []        // ISOM 216 (mine / sjakt)
  const trigpunkter = []   // ISOM 113 (trigonometric point)
  const kirker = []        // ISOM 532-derivert (kirker / chapels)
  const parkeringer = []   // ISOM 534-derivert (amenity=parking)
  const holdeplasser = []  // ISOM 560-derivert (buss/tog-holdeplass)
  const broer = []         // ISOM 509-derivert (bridge=yes på highway/path)
  const bommer = []        // ISOM 526-derivert (barrier=gate/lift_gate/...)
  const marinePoints = []  // Fase 3: { el, code } for marine/padle-POI-symboler
  const soundings = []     // Sjøkart dybdepunkt — skjult detalj-lag (inset-only)
  const dybdekonturer = [] // Sjøkart dybdekurve (306) — skjult detalj-lag (inset-only)

  const counts = { peak: 0, place: 0, hule: 0, gruve: 0, trig: 0, kirke: 0, parkering: 0, holdeplass: 0, bro: 0, bom: 0 }
  for (const code of LAYER_ORDER) counts[code] = 0

  for (const el of elements) {
    // Marine navne-noder (bukt/vik/sund/nes/grunne/holme/øy) har ingen
    // geometri å rendre — navnet samles separat som sjønavn-etikett (eget
    // «Sjønavn»-lag, se seaNames under). Hopp over videre klassifisering så de
    // ikke havner som tomme vann-/sted-buckets eller duplikat-stedsnavn.
    // Way/relasjon (øy-flate, bukt-flate) fortsetter til geometri-
    // klassifisering som før; sjømerke-skjær beholder sitt 211-symbol.
    if (el.type === 'node' && isMaritimeNameOnlyNode(el.tags)) continue
    // Way-kirker (building=church / amenity=place_of_worship på en
    // bygnings-polygon) plukker vi opp UANSETT om classifyToIsom returnerer
    // bygnings-koden — også way-er som kun har amenity=place_of_worship
    // (uten building-tag) skal få korsmarkør.
    if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
      const t = el.tags ?? {}
      if (t.amenity === 'place_of_worship' || t.building === 'church' || t.building === 'chapel') {
        kirker.push(el)
        counts.kirke++
      }
    }
    // Way-parkering: polygon med amenity=parking → ett P-symbol på centroid.
    // classifyToIsom returnerer '534' både for nodes og ways, men ways skal
    // ikke fortsette inn i buckets — vi rendrer dem som point her.
    if (el.type === 'way' && el.geometry && el.geometry.length >= 3 && el.tags?.amenity === 'parking') {
      parkeringer.push(el)
      counts.parkering++
    }
    // Bro-deteksjon: way med bridge=yes (eller annen truthy bridge-verdi)
    // langs en høyveg-, sti-, fot-, eller togtrasé. Hele way-ens geometri er
    // selve bro-spennet — den rendres som to parallelle parapet-linjer langs
    // full lengde (se broSvg). OSM-verdien `no` regnes som ikke-bro; alt
    // annet (yes, viaduct, aqueduct, boardwalk, movable osv.) regnes som bro.
    if (el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      const b = el.tags?.bridge
      if (b && b !== 'no') {
        // Bare når way-en faktisk er en sti eller veg som vi rendrer.
        const t = el.tags
        const isRoute = !!(t.highway || t.railway || t.aerialway || t['piste:type'] || (t.leisure === 'track' && t.sport === 'skiing'))
        if (isRoute) {
          broer.push(el)
          counts.bro++
        }
      }
    }
    const cls = classifyToIsom(el)
    if (!cls) continue
    if (cls.cat === 'point') {
      if (cls.code === 'peak') { peaks.push(el); counts.peak++ }
      else if (cls.code === 'place') { places.push(el); counts.place++ }
      else if (cls.code === '215') { huler.push(el); counts.hule++ }
      else if (cls.code === '216') { gruver.push(el); counts.gruve++ }
      else if (cls.code === '113') { trigpunkter.push(el); counts.trig++ }
      else if (cls.code === '532') { kirker.push(el); counts.kirke++ }
      else if (cls.code === '534') {
        // Node-parkering (way-varianten ble allerede plukket over).
        if (el.type === 'node') { parkeringer.push(el); counts.parkering++ }
      }
      else if (cls.code === '560') { if (el.type === 'node') { holdeplasser.push(el); counts.holdeplass++ } }
      else if (cls.code === '526') { bommer.push(el); counts.bom++ }
      else if (cls.code === 'dybdepunkt') { soundings.push(el) }
      else if (MARINE_POINT_CODES[cls.code]) { marinePoints.push({ el, code: cls.code }) }
      continue
    }
    // Dybdekurver (Sjøkart 306) — samles til skjult detalj-lag (kun synlig
    // i long-press-inset-en). 306 er ikke i LAYER_ORDER, så uten dette
    // droppes den.
    if (cls.code === '306') { dybdekonturer.push(el); continue }
    if (buckets[cls.code]) {
      buckets[cls.code].push(el)
      counts[cls.code]++
    }
  }

  // ── Vann-polygoner med samme navn slås sammen ────────────────────────
  // OSM deler ofte store innsjøer i flere polygoner (f.eks. Setten med
  // Hestesund som strait på midten — mappet som to separate ways). Hvis
  // de har samme `name`-tag, slår vi dem sammen til én polygon med
  // polygon-clipping union, slik at innsjøen renders som én sammen-
  // hengende blå flate med bro/vei oppå.
  for (const code of ['301', '302', '303']) {
    if (buckets[code].length < 2) continue
    buckets[code] = unionByName(buckets[code], project)
  }

  // ── Vegetasjons-klassifisering via CHM (DOM − DTM) ───────────────────
  // For hvert OSM-skog-polygon: sample CHM og bestem ISOM-kode basert
  // på vegetasjonshøyde og varians. Beveger features mellom buckets.
  let chm = null
  let vegReclassified = 0
  if (dem && dom) {
    try {
      chm = computeCHM(dem, dom)
      console.log(`[CHM] Beregnet ${chm.cols}×${chm.rows} celler`)
      const oldSkogCodes = ['405', '406', '407', '408', '409']
      const allSkog = []
      for (const c of oldSkogCodes) {
        for (const el of buckets[c] ?? []) allSkog.push({ code: c, el })
        buckets[c] = []
        counts[c] = 0
      }
      for (const { code, el } of allSkog) {
        if (el.type === 'way' && el.geometry) {
          const ring = el.geometry.map(g => {
            const p = project(g.lat, g.lon)
            return [p.x, p.y]
          })
          const stats = sampleCHMInPolygon(chm, ring)
          const newCode = classifyVegetationFromCHM(stats, code)
          if (buckets[newCode]) {
            buckets[newCode].push(el)
            counts[newCode]++
            if (newCode !== code) vegReclassified++
          }
        } else {
          buckets[code].push(el)
          counts[code]++
        }
      }
      console.log(`[CHM] Re-klassifiserte ${vegReclassified} vegetasjons-features`)
    } catch (e) {
      console.warn(`[CHM] Klassifisering feilet: ${e.message}`)
    }
  }

  // ── ISOM 522: tette bebyggelse-klynger ───────────────────────────────
  // Slå sammen tett bebygde områder til urbanmasse-multipolygoner med
  // pattern-fyll. Kritisk for å holde SVG-størrelsen i sjakk i tette
  // strøk — uten dette får nettleseren tusenvis av enkelt-bygnings-
  // polygoner som gjør pinch/zoom og pan tregt.
  //
  // v8.9.28: Toggler sammen med 521 under «Bygninger» (categoryFor →
  // 'bygning'). Tidligere v8.9.27 forsøk på å fjerne urbanMass helt
  // ga uakseptabel ytelse i bymiljø-kart.
  let urbanMassMultiPoly = []
  if (includeBuildingMass && buckets['521'].length >= 5) {
    const buildingsXY = buckets['521']
      .filter(el => el.geometry && el.geometry.length >= 3)
      .map(el => ({
        ring: el.geometry.map(g => {
          const p = project(g.lat, g.lon)
          return [p.x, p.y]
        }),
        original: el,
      }))
    // v8.9.29: tilbake til 15 m naboradius (original v6.3.0-verdi).
    // 50/100 m var for slappe — eneboligfelt med store tomter ble
    // aldri klyngetegnet, og SVG-en blåste opp i tettbygde områder.
    // Min klyngestørrelse holdes på 5 så enslige tun ikke slukes.
    const { urbanMass, scattered } = _time('buildingMass', () => classifyBuildings(buildingsXY, {
      neighborRadiusM: 15,
      minClusterSize: 5,
      bufferM: 6,
    }))
    if (urbanMass.length > 0) {
      urbanMassMultiPoly = urbanMass
      buckets['521'] = scattered.map(b => b.original)
      counts['521'] = buckets['521'].length
      counts['522'] = urbanMass.length
    }
  }

  // ── DEM-deriverte features (konturer, knauser, stupkanter, sjø) ──────
  let demFeatures = { contours: { features: [] }, cliffs: [], equidistanceM: null }
  let demSeaPolygons = []
  let demSeaBands = []
  let demSummits = []
  if (usableDem) {
    const c = _time('contours', () => buildContours(usableDem, contourIntervalM, 5))
    const cl = includeCliffs ? _time('cliffs', () => detectCliffs(usableDem, 45, 10)) : []
    // v9.1.17 — knauser tilbake som ÉN merged vektor-<path> (ISOM 213). Etter
    // raster-eksperimentet (v9.1.7–9.1.16, blurry «vorter» + mobil-GPU-kost):
    // vektor er 1 DOM-node, knivskarp ved enhver zoom, og solid strek = like
    // billig å rastere som høydekurvene (ingen dash → ingen gest-lag). TPI-
    // terskel 2.5m gir et fornuftig antall markante knauser.
    // v9.1.18 — knaus vises KUN ved 5 m ekvidistanse (ISOM-detaljnivå). På
    // grovere ekvidistanse (10/20/25/50/100 m) er kartet oversiktspreget og
    // knaus-detalj hører ikke hjemme.
    const k = (includeKnauser && contourIntervalM === 5) ? _time('knauser', () => detectKnauser(usableDem, 5, 2.5)) : []
    demFeatures = { contours: c, cliffs: cl, knauser: k, equidistanceM: contourIntervalM }
    // Ekte topper (lokale høyde-maksima) for «topp»-søket. Brukes kun når kartet
    // ikke har OSM-toppmarkører; emitteres som skjult søkbart lag uansett.
    demSummits = _time('summits', () => detectSummits(usableDem, { windowM: 250, minProminenceM: 15, maxCount: 60 }))
    // Sjø-deteksjon fra DTM: Kartverket NHM_DTM_25832 returnerer havflaten på
    // 0 m. Områder ≤ 0.5 m blir blå sjø-polygon (ISOM 303). FALLBACK når
    // WMTS-vannmaske ikke leverte data — heuristikken kan "smitte" inn på
    // lavtliggende øyer DEM-resolusjonen ikke fanger, så WMTS foretrekkes
    // når det er tilgjengelig (skipDemSea=true).
    if (!skipDemSea) {
      // voidMask (fra Terrarium-fyllet) lar sjø-deteksjonen skille «void fylt
      // med grov global landhøyde» fra ekte målt land — kritisk i smale sund.
      const seaResult = buildSeaFromDem(usableDem, {
        thresholdM: 0.5, minAreaM2: 2000, simplifyM: 2, requireBoundaryTouch: true,
        voidMask: usableDem.voidMask ?? null,
      })
      demSeaPolygons = seaResult.polygons
      if (demSeaPolygons.length) {
        const shallow = buildSeaShallowBands(usableDem, {
          thresholdM: 0.5, bandDistancesM: [50, 200], simplifyM: 2,
          voidMask: usableDem.voidMask ?? null,
        })
        demSeaBands = shallow.bands
      }
    }
  }

  // ── Vektor-vann er autoritativt — trekk ferskvann fra DEM-sjøen ───────
  // Steg 2 av vann-omleggingen. buildSeaFromDem klassifiserer ALT ≤0.5m-areal
  // som rører kart-kanten som SJØ. Store INNSJØER (Tyrifjorden) leser ~0 m i
  // NHM_DTM og strekker seg ut av kartet, så de feilklassifiseres som sjø →
  // 303-blå med trappetrinns-kyst + teal grunn-bånd. DEM kan ikke skille sjø fra
  // en 0-lesende innsjø; det kan VEKTOR-data (N50/OSM vet at det er ferskvann,
  // 301/302). Prinsipp: vektor-vann er autoritativt for HVA som er vann og av
  // hvilken type; DEM-sjø er kun en CORS-trygg fallback DER vektor mangler.
  // Implementasjon: mengde-differanse (polygon-clipping) — der ferskvann dekker
  // DEM-sjøen forsvinner den falske sjøen (innsjøen rendres som ekte vektor-301
  // i stedet), mens ekte kyst-sjø uten ferskvanns-overlapp overlever uendret.
  if (demSeaPolygons.length) {
    const freshwaterMP = []
    const projRing = (geom) => geom.map(g => { const p = project(g.lat, g.lon); return [p.x, p.y] })
    for (const code of ['301', '302']) {
      for (const el of buckets[code] ?? []) {
        if (el.type === 'merged-water' && el._mergedRings) {
          for (const polygon of el._mergedRings) if (polygon?.length) freshwaterMP.push(polygon)
        } else if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
          freshwaterMP.push([projRing(el.geometry)])
        } else if (el.type === 'relation' && el.members) {
          for (const ring of assembleRelationRings(el.members, 'outer')) {
            if (ring.length >= 3) freshwaterMP.push([projRing(ring)])
          }
        }
      }
    }
    if (freshwaterMP.length) {
      // Per DEM-sjø-polygon: er den HOVEDSAKELIG dekket av vektor-ferskvann, er
      // det en innsjø feillest som sjø → dropp hele polygonet (alt-eller-intet,
      // så vi ikke etterlater teal slivere langs strandlinja der DEM-0m-kanten og
      // vektor-kysten ikke flukter eksakt). Ekte kyst-sjø har ~0 % ferskvanns-
      // overlapp og beholdes uendret.
      const ringAreaM2 = (ring) => {
        if (!ring || ring.length < 3) return 0
        let a = 0
        for (let i = 0, n = ring.length; i < n; i++) {
          const j = (i + 1) % n
          a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1]
        }
        return Math.abs(a) / 2
      }
      const mpAreaM2 = (mp) => mp.reduce((s, poly) => s + ringAreaM2(poly[0]), 0)
      const mostlyFreshwater = (poly) => {
        const area = ringAreaM2(poly[0])
        if (area <= 0) return true
        try {
          const inter = polygonClipping.intersection([poly], freshwaterMP)
          return mpAreaM2(inter) / area > 0.5
        } catch { return false }
      }
      try {
        demSeaPolygons = demSeaPolygons.filter(p => !mostlyFreshwater(p))
        demSeaBands = demSeaBands
          .map(b => ({ ...b, polygons: b.polygons.filter(p => !mostlyFreshwater(p)) }))
          .filter(b => b.polygons.length)
      } catch (e) {
        console.warn(`[DEM-sjø] ferskvanns-vurdering feilet (${e?.message ?? e}) — beholder rå DEM-sjø`)
      }
    }
  }

  // ── Én autoritativ sjø-geometri (Fase 1: single coastline) ───────────
  // Fundamentet for topologisk normalisering: ett sett sjø-polygoner i
  // SVG-meter-rom som alt marint klippes/valideres mot. Kilde-prioritet:
  //
  //   1. DEM-0m-isobat (seaFromDem) — CORS-trygg, og marching-squares gir
  //      ekte øy-HULL (kritisk for at dybde ikke males over øyer).
  //   2. N50 Havflate (buckets['303'] fra _source='n50') — fallback når
  //      DEM mangler/er syntetisk. Merk: N50-fetcheren dropper indre ringer,
  //      så øyer blir ikke hull herfra — derfor er DEM foretrukket.
  //
  // Tom array = innlands-kart (ingen sjø): all marin normalisering blir
  // no-op, og rendering er byte-identisk med før.
  let authoritativeSea = []
  let authoritativeSeaSource = null   // 'dem' | 'n50' | null
  if (demSeaPolygons.length) {
    authoritativeSea = unionPolygonsToSea(demSeaPolygons)
    if (authoritativeSea.length) authoritativeSeaSource = 'dem'
  } else {
    const n50SeaRings = []
    for (const el of buckets['303'] ?? []) {
      if (el._source !== 'n50') continue
      if (el.type === 'merged-water' && el._mergedRings) {
        for (const polygon of el._mergedRings) {
          if (polygon[0]) n50SeaRings.push(polygon[0])
        }
      } else if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
        n50SeaRings.push(el.geometry.map(g => {
          const p = project(g.lat, g.lon)
          return [p.x, p.y]
        }))
      }
    }
    if (n50SeaRings.length) {
      authoritativeSea = unionRingsToSea(n50SeaRings)
      if (authoritativeSea.length) authoritativeSeaSource = 'n50'
    }
  }

  const hasAuthoritativeSea = authoritativeSea.length > 0


  // Bygg ISOM-id-mapene (patterns + symbols) som kroppen trenger. Selve
  // defs- og CSS-strengene bygges LAZY etter at kroppen er satt sammen, så vi
  // kun emitterer det som faktisk brukes (se nær return). widthM → label-skala.
  const { patternIds, symbolIds, patternDefs, symbolDefs } = buildIsomDefs(isomCatalog)

  const layerSvg = (code, phase = 'both') => {
    const els = buckets[code]
    if (!els.length) return `  <g data-layer="${categoryFor(code)}" data-iso="${code}"></g>\n`
    const cat = categoryFor(code)

    if (POLYGON_CODES.has(code)) {
      const filter = POLYGON_FILTER[cat] ?? { simplifyM: 0, minAreaM2: 0 }
      // v8.10.4: Kombinér paths som deler stil (samme data-src, samme isSmall,
      // ingen inline-style, ingen navn) til ÉN stor <path d="M... M..."> per
      // bucket. Browseren rendrer det som ett pass og DOM-tallet i en
      // bygnings-tung bbox synker fra ~5k til ~10 nodes. Named features
      // (data-name) og inline-stylede features (f.eks. ISOM 307 dybdeareal)
      // emitteres fortsatt standalone så søk og per-feature-fyll fungerer.
      const standalonePaths = []
      // v10.2.9: merge-signaturen inkluderer grid-celle (spatialBucket.cellKeyFor)
      // så hver merged path får små, reelle bounds — nettleserens raster-tile-
      // culling og MapViews viewport-culling (data-bbox) virker da per celle i
      // stedet for aldri (mega-path med bounds = hele kartet).
      const groups = new Map()  // sig (src|isSmall|celle) → { ds: [], src, isSmall, bbox }
      const pushToGroup = (d, src, isSmall, bbox) => {
        const sig = `${src}|${isSmall ? '1' : '0'}|${cellKeyFor(bbox)}`
        let g = groups.get(sig)
        if (!g) { g = { ds: [], src, isSmall, bbox: null }; groups.set(sig, g) }
        g.ds.push(d)
        g.bbox = unionBbox(g.bbox, bbox)
      }
      for (const el of els) {
        let d = ''
        let bbox = null
        let src = el._source ?? (el._mergedRings ? 'merged' : el.type)
        let isSmall = false
        // Settes for lineære havne-strukturer (551) som skal strekes, ikke
        // fylles — se 551-grenen under. Tom = vanlig fylt areal.
        let strokeOnlyStyle = ''
        const name = el.tags?.name ?? el.tags?.navn ?? ''
        // natural=bay/strait er NAVNE-bærere, ikke vann-geometri: de hentes
        // fra Overpass for å gi bukt/sund en etikett (sjo-navn/lakeLabels),
        // men en LUKKET bukt-polygon (Korsvika i Trondheim, mappet som OSM-
        // relation) ble klassifisert 303 og malt som flat saltvanns-flate
        // OPPÅ den graderte Sjøkart-/DEM-sjøen — en mørkere polygon med
        // harde, rette sjøkanter midt i fjorden. Når kartet har autoritativ
        // sjø (DEM-0m/N50) er bukt-fyllet rent duplikat → hopp over. Uten
        // autoritativ sjø (sjelden CORS-svikt) beholdes det som før, som
        // eneste blå flate. (Åpne bay/strait-LINJER stoppes av wedge-vakten
        // under uansett.)
        if (cat === 'vann' && hasAuthoritativeSea &&
            (el.tags?.natural === 'bay' || el.tags?.natural === 'strait')) continue
        if (el.type === 'merged-water' && el._mergedRings) {
          // polygon-clipping output: én <path> per topologisk polygon
          // (outer + dens hull), så holes virker via evenodd uten at
          // separate polygoner kanselleres mot hverandre.
          for (let pi = 0; pi < el._mergedRings.length; pi++) {
            const polygon = el._mergedRings[pi]
            const ringPaths = []
            let polyBbox = null
            for (let ring of polygon) {
              if (ring.length < 3) continue
              if (filter.simplifyM > 0 && ring.length > 3) {
                ring = simplifyDP(ring, filter.simplifyM)
                if (ring.length < 3) continue
              }
              let rd = `M${fmt(ring[0][0])},${fmt(ring[0][1])}`
              for (let i = 1; i < ring.length; i++) rd += `L${fmt(ring[i][0])},${fmt(ring[i][1])}`
              rd += 'Z'
              ringPaths.push(rd)
              polyBbox = unionBbox(polyBbox, bboxOfPoints(ring))
            }
            if (ringPaths.length > 0) {
              // Merged-water beholder data-name så søk på innsjø-navn fungerer.
              standalonePaths.push(
                `    <path d="${ringPaths.join(' ')}" fill-rule="evenodd"${bboxAttr(polyBbox, fmt)} data-src="merged" data-name="${xmlEscape(name)}"/>`
              )
            }
          }
          continue
        }
        if (el.type === 'way' && el.geometry) {
          const areaM2 = polygonAreaM2(el.geometry)
          if (filter.minAreaM2 && areaM2 < filter.minAreaM2) continue
          if (filter.maxAreaM2 && areaM2 > filter.maxAreaM2) continue
          // Vann-flate fra en ÅPEN way = wedge-fella. natural=strait/bay
          // hentes navngitt fra Overpass for å gi sund/bukt en etikett, men
          // tegnes i OSM ofte som en åpen LINJE midt i sundet. classifyToIsom
          // gir den vann-kode 303, og else-grenen under tvangslukker enhver
          // way til polygon (pathAndBboxFromGeometry forceClose=true) — en
          // åpen linje ble da en diger trekant som skar tvers over sundet og
          // dekket holmer (Kjerringholmen, Hvaler). Ekte OSM-vannflater er
          // ALLTID eksplisitt lukkede ringer, så en åpen vann-way kan trygt
          // hoppes over: den ekte sjøen kommer fra DEM-sjø/N50/natural=water,
          // og sund-/bukt-navnet samles uansett separat i sjo-navn-laget.
          if (cat === 'vann') {
            const g0 = el.geometry[0]
            const gN = el.geometry[el.geometry.length - 1]
            const isClosedRing = el.geometry.length >= 4 &&
              Math.abs(g0.lat - gN.lat) < 1e-7 && Math.abs(g0.lon - gN.lon) < 1e-7
            if (!isClosedRing) continue
          }
          // ISOM 521: små bygg (< 500 m², typisk hytter/uthus inkludert
          // turisthytter) erstattes med standardisert kvadrat-symbol
          // (13 m × 13 m = 1.3 mm @ 1:10k) sentrert på OSM-bygnings-
          // centroid. Faktiske små OSM-polygoner er ofte irregulære og
          // masketes lett av nærliggende stier; et rent, lett over-
          // dimensjonert kvadrat med tynt omriss leses klart på alle
          // zoom-nivåer (Kartverket-konvensjon). v8.10.9: terskelen er
          // hevet fra 70 → 500 m² så også turisthytter (Sjusjøstua,
          // Glitterheim osv.) får hytte-symbol istedenfor å forsvinne.
          if (code === '521' && areaM2 < 500) {
            const c = polygonCentroid(el.geometry)
            if (!c) continue
            const half = 6.5
            d = `M${fmt(c.x - half)},${fmt(c.y - half)}L${fmt(c.x + half)},${fmt(c.y - half)}L${fmt(c.x + half)},${fmt(c.y + half)}L${fmt(c.x - half)},${fmt(c.y + half)}Z`
            bbox = { minX: c.x - half, minY: c.y - half, maxX: c.x + half, maxY: c.y + half }
            isSmall = true
          } else if (code === '551') {
            // Kai/brygge/molo (Sjøkart-havnestruktur). Sjøkart leverer to
            // geometri-typer, og de MÅ behandles ulikt:
            //
            //  • Areal (KaiBrygge som Polygon) → fyll. WFS gir forvridde
            //    ringer med mye støy; forenkle til en ren ≤6-hjørnet form
            //    (Visvalingam-Whyatt, bevarer konkaviteter så L-formede
            //    moloer beholder knekken).
            //  • Lineær (Molo/Pir/Bølgebryter som LineString) → IKKE fyll.
            //    En åpen linje lukket med Z ble før fylt til en svær trekant
            //    fra siste til første punkt — det er de rare grå sjevronene
            //    på kartet (en molo som strekker seg langt ut i sjøen ga en
            //    diger wedge). Render i stedet som en tykk grå strek.
            const projPts = el.geometry.map(g => { const p = project(g.lat, g.lon); return [p.x, p.y] })
            const g0 = el.geometry[0]
            const gN = el.geometry[el.geometry.length - 1]
            const closed = el.geometry.length >= 4 &&
              Math.abs(g0.lat - gN.lat) < 1e-7 && Math.abs(g0.lon - gN.lon) < 1e-7
            if (closed) {
              const ring = simplifyPierPolygon(projPts)
              if (ring.length < 3) continue
              d = `M${fmt(ring[0][0])},${fmt(ring[0][1])}`
              for (let i = 1; i < ring.length; i++) d += `L${fmt(ring[i][0])},${fmt(ring[i][1])}`
              d += 'Z'
              bbox = bboxOfPoints(ring)
            } else {
              // Åpen molo-/pir-linje: lett DP-forenkling, render som strek
              // (ingen Z). 0.075 mm non-scaling-stroke (CSS-regelen gjør den
              // skjerm-konstant) leser som en kunstig struktur uten å fylle.
              // Bevisst tynn: under pan/zoom-gest er non-scaling-stroke av
              // (perf), så streken skalerer med viewBox-en og blir tjukkere —
              // 0.075 mm holder den lesbar uten å dominere i den tilstanden.
              let line = projPts
              if (line.length > 2) line = simplifyDP(line, 1.5)
              if (line.length < 2) continue
              d = `M${fmt(line[0][0])},${fmt(line[0][1])}`
              for (let i = 1; i < line.length; i++) d += `L${fmt(line[i][0])},${fmt(line[i][1])}`
              bbox = bboxOfPoints(line)
              strokeOnlyStyle = 'fill:none;stroke:#6b6b6b;stroke-width:0.075mm;stroke-linejoin:round;stroke-linecap:round'
            }
          } else {
            const r = pathAndBboxFromGeometry(el.geometry, true, filter.simplifyM)
            d = r.d
            bbox = r.bbox
          }
        } else if (el.type === 'relation' && el.members) {
          // OSM multipolygon: outer/inner-rings er splittet over flere
          // ways. Sy sammen først (greedy join på matchende endepunkter)
          // så vi får ekte lukkede ringer i stedet for segment-trekanter.
          const outerRings = assembleRelationRings(el.members, 'outer')
          const innerRings = assembleRelationRings(el.members, 'inner')
          // maxAreaM2-cap også på relations — naturreservat-mistags er
          // oftest store multipolygoner. Beregn samlet outer-areal og dropp
          // hele relasjonen hvis den overskrider terskelen.
          if (filter.maxAreaM2 && outerRings.length) {
            let totalOuterM2 = 0
            for (const ring of outerRings) {
              totalOuterM2 += polygonAreaM2(ring)
              if (totalOuterM2 > filter.maxAreaM2) break
            }
            if (totalOuterM2 > filter.maxAreaM2) continue
          }
          const subpaths = []
          for (const ring of [...outerRings, ...innerRings]) {
            const r = pathAndBboxFromGeometry(ring, true, filter.simplifyM)
            if (r.d) {
              subpaths.push(r.d)
              bbox = unionBbox(bbox, r.bbox)
            }
          }
          d = subpaths.join(' ')
        }
        // Dybdeareal (307) rendres med Sjøkarts EGEN geometri — øy-hull bevares
        // nå i sjokartFetcher (relation m/ inner-ringer), så dybde males ikke
        // over øyer (Holmen i Drammen). Tidligere ble 307 klippet mot den DEM-
        // deriverte sjøen (DepthArea ∩ DEM-sjø) for å kompensere for tapte hull,
        // men DEM-sjøen er kun areal ≤ 0,5 m som rører kartkanten → elvekanaler
        // (som ligger over havnivå) ble da kappet bort og etterlot dybde-tall
        // flytende på beige land. Med ekte hull er Sjøkart-omrisset (= kysten)
        // autoritativt og klippingen overflødig.
        if (d) {
          // ISOM 307 (Sjøkart dybdeareal): per-polygon fill basert på
          // gjennomsnitts-dybde via depthToColor — kystnær 5-bånds dempet
          // skala (0–2/2–5/5–10/10–20/20+ m), tett i grunt vann der padleren
          // trenger det, lav-kontrast så den ikke konkurrerer med terrenget.
          let inlineStyle = ''
          let dybdeAttr = ''
          let depthClassAttr = ''
          // Lineær havne-struktur (551): strek, ikke fyll — overstyrer
          // gruppe-CSS-fyllet via inline style.
          if (strokeOnlyStyle) inlineStyle = ` style="${strokeOnlyStyle}"`
          if (code === '307' && el.tags) {
            const minD = Number(el.tags.minDybde)
            const maxD = Number(el.tags.maxDybde)
            const avgD = Number.isFinite(minD) && Number.isFinite(maxD) ? (minD + maxD) / 2
                       : Number.isFinite(minD) ? minD
                       : Number.isFinite(maxD) ? maxD
                       : null
            if (avgD != null) {
              // v12.0.17: fyll via CSS-klasse (regler i buildIsomCss) i stedet
              // for per-polygon inline-style — samme tema-bevisste var()-verdi,
              // ~30 B spart per dybdepolygon.
              depthClassAttr = ` class="${depthBandClass(avgD)}"`
              // v8.9.24: data-dybde lar MapView lage depth-shade PNG ved å
              // raster-fylle disse polygonene i gråtoner (Path2D på d-attr).
              dybdeAttr = ` data-dybde="${fmt(avgD)}"`
            }
          }
          const smallAttr = isSmall ? ' data-small="yes"' : ''
          // Standalone hvis features har inline-style/dybdeklasse (per-polygon-
          // fyll), dybde-attr eller et navn (søkbart). Ellers slå sammen til
          // delt path-bucket per (data-src, isSmall).
          if (inlineStyle || depthClassAttr || dybdeAttr || name) {
            standalonePaths.push(
              `    <path d="${d}" fill-rule="evenodd"${depthClassAttr}${inlineStyle}${dybdeAttr}${smallAttr}${bboxAttr(bbox, fmt)} data-src="${xmlEscape(String(src))}" data-name="${xmlEscape(name)}"/>`
            )
          } else if (cat === 'vann') {
            // Vann-flater males OPAKT som egne paths — ALDRI slått sammen i en
            // delt `fill-rule="evenodd"`-bucket. Overlappende/nestede vann-
            // polygoner fra samme kilde (en stor OSM-vann-way som omslutter et
            // mindre tjern, eller et duplikat med samme bbox-senter → samme
            // bucket-celle) kansellerte ellers hverandres fyll (evenodd:
            // vikletall 2 = partall = ikke fylt), så innsjøen ble et beige hull
            // i blått vann (Ulvenvann-tilfellet). Hver polygon beholder sin EGEN
            // evenodd (outer + øy-hull), så holmer kuttes fortsatt korrekt, men
            // separate paths overlapper opakt uten å kansellere.
            standalonePaths.push(
              `    <path d="${d}" fill-rule="evenodd"${smallAttr}${bboxAttr(bbox, fmt)} data-src="${xmlEscape(String(src))}"/>`
            )
          } else {
            pushToGroup(d, src, isSmall, bbox)
          }
        }
      }
      // Bygg grupperte paths fra buckets (én per stil × grid-celle)
      const groupedPaths = []
      for (const g of groups.values()) {
        const smallAttr = g.isSmall ? ' data-small="yes"' : ''
        groupedPaths.push(
          `    <path d="${g.ds.join(' ')}" fill-rule="evenodd"${smallAttr}${bboxAttr(g.bbox, fmt)} data-src="${xmlEscape(String(g.src))}"/>`
        )
      }
      const pathElements = [...groupedPaths, ...standalonePaths]
      if (pathElements.length === 0) {
        return `  <g data-layer="${cat}" data-iso="${code}"></g>\n`
      }
      return `  <g data-layer="${cat}" data-iso="${code}">\n${pathElements.join('\n')}\n  </g>\n`
    }
    if (LINE_CODES.has(code)) {
      const tol = LINE_SIMPLIFY[cat] ?? 0
      // Jernbane (515) trenger to paths per geometri: solid sort base +
      // hvit dasharray-overlay som danner ladder-stripes (sviller).
      // CSS-regelen for `.overlay` settes opp i symbolizer.js.
      //
      // Tunnel-deteksjon: railway-ways tagget `tunnel=yes` rendres som
      // grå dashed phantom-linje uten sviller, og start/slutt-noder får
      // perpendikulære tunnel-portal-streker så det blir tydelig at
      // toget går under bakken (Lieråstunnelen mellom Asker og Drammen).
      if (code === '515') {
        // v8.10.4: combine paths per (isTunnel, isOverlay) bucket så DOM-
        // tallet er fast 4 paths i stedet for 2N. Tunnel-portal-streker er
        // alltid separate <line>-elementer.
        const dsNormal = []
        const dsTunnel = []
        let bbNormal = null
        let bbTunnel = null
        const entrances = []
        const TICK_HALF_M = 6  // 12 m total = ~1.2 mm @ 1:10 000
        for (const el of els) {
          const { d, bbox } = pathAndBboxFromGeometry(el.geometry, false, tol)
          if (!d) continue
          const isTunnel = !!el.tags?.tunnel && el.tags.tunnel !== 'no'
          if (isTunnel) { dsTunnel.push(d); bbTunnel = unionBbox(bbTunnel, bbox) }
          else { dsNormal.push(d); bbNormal = unionBbox(bbNormal, bbox) }
          if (isTunnel && el.geometry && el.geometry.length >= 2) {
            const g = el.geometry
            const p0 = project(g[0].lat, g[0].lon)
            const p1 = project(g[1].lat, g[1].lon)
            const len0 = Math.hypot(p1.x - p0.x, p1.y - p0.y)
            if (len0 > 0) entrances.push({ x: p0.x, y: p0.y, ux: (p1.x - p0.x) / len0, uy: (p1.y - p0.y) / len0 })
            const n = g.length
            const pE = project(g[n - 1].lat, g[n - 1].lon)
            const pE2 = project(g[n - 2].lat, g[n - 2].lon)
            const lenE = Math.hypot(pE.x - pE2.x, pE.y - pE2.y)
            if (lenE > 0) entrances.push({ x: pE.x, y: pE.y, ux: (pE.x - pE2.x) / lenE, uy: (pE.y - pE2.y) / lenE })
          }
        }
        const pathParts = []
        // Jernbane buckets ikke (fast 4 paths, sparsom) — men hel-utstreknings-
        // data-bbox er gratis og lar viewport-culling droppe den når toglinja
        // er helt utenfor utsnittet.
        if (dsNormal.length) {
          pathParts.push(`    <path d="${dsNormal.join(' ')}"${bboxAttr(bbNormal, fmt)}/>`)
          pathParts.push(`    <path d="${dsNormal.join(' ')}" class="overlay"${bboxAttr(bbNormal, fmt)}/>`)
        }
        if (dsTunnel.length) {
          pathParts.push(`    <path d="${dsTunnel.join(' ')}" data-tunnel="yes"${bboxAttr(bbTunnel, fmt)}/>`)
          pathParts.push(`    <path d="${dsTunnel.join(' ')}" class="overlay" data-tunnel="yes"${bboxAttr(bbTunnel, fmt)}/>`)
        }
        for (const e of entrances) {
          const px = -e.uy, py = e.ux
          const x1 = e.x - px * TICK_HALF_M, y1 = e.y - py * TICK_HALF_M
          const x2 = e.x + px * TICK_HALF_M, y2 = e.y + py * TICK_HALF_M
          pathParts.push(`    <line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" class="tunnel-portal"/>`)
        }
        return `  <g data-layer="${cat}" data-iso="${code}">\n${pathParts.join('\n')}\n  </g>\n`
      }
      // v8.10.4: alle linjer i samme code/phase deler stil → kombinér til
      // stor <path d="..."> i stedet for N enkelt-paths. Hver M starter
      // en ny subpath i SVG, så visuelt resultat er identisk men DOM-tallet
      // synker drastisk (stier ~3-5k → få noder). Stroke-effekter (linecap,
      // dasharray) er sub-path-agnostiske og forblir korrekte.
      // v10.2.9: merging skjer per grid-celle (hel way per celle, aldri
      // splitting — bevarer dash-fase og linecaps) så hver path får små
      // bounds + data-bbox. Map bevarer insertion-order → casing- og
      // overlay-passet (to-fase veier) produserer identiske bucket-sett.
      // v10.2.44: navngitte vannveier (304 elv/kanal, 305 bekk/grøft) emitteres
      // standalone med data-name — som navngitte vann-AREALER allerede gjør —
      // så MapView kan identifisere hvilken elv/bekk et long-press-punkt ligger
      // på (geometri, ikke bare nærmeste navne-label ~2 km unna). Stilen er
      // identisk: pathen ligger i samme <g data-iso> så CSS-strøken matcher.
      const isNamedWaterway = code === '304' || code === '305'
      const namedLinePaths = []
      const cellBuckets = new Map()  // cellKey → { ds: [], bbox }
      for (const el of els) {
        const { d, bbox } = pathAndBboxFromGeometry(el.geometry, false, tol)
        if (!d) continue
        const name = isNamedWaterway ? (el.tags?.name ?? '').trim() : ''
        if (name) {
          namedLinePaths.push(`    <path d="${d}"${bboxAttr(bbox, fmt)} data-name="${xmlEscape(name)}"/>`)
          continue
        }
        const key = cellKeyFor(bbox)
        let b = cellBuckets.get(key)
        if (!b) { b = { ds: [], bbox: null }; cellBuckets.set(key, b) }
        b.ds.push(d)
        b.bbox = unionBbox(b.bbox, bbox)
      }
      const lineBuckets = [...cellBuckets.values()]
      // v8.1.0: koder som har overlayStroke (f.eks. veier 501-503) får dual
      // path: base = casing (sort, breiere), overlay = farget fyll (smalere,
      // på toppen). CSS i symbolizer.js styler `path.overlay` separat. Gir
      // den klassiske ISOM-veiestilen med tydelig sort omriss rundt farget
      // veifyll — uten en casing forsvinner små veier i bg-cream-fargen.
      // v8.1.2 fix: bruker getIsomDef som slår opp på ISOM-kategori (manmade),
      // ikke UI-kategorien (vei-stor) som ble brukt i v8.1.0/v8.1.1 — derfor
      // ble aldri overlay-pathene emittet og roads ble bare sort casing.
      const hasOverlay = !!getIsomDef(code, isomCatalog, false)?.overlayStroke
      if (hasOverlay) {
        // v8.5.7: To-fase rendering støtter "casing pattern". Når veier
        // emitteres separat som casing- og overlay-pass over flere koder,
        // bryter call-site dette opp slik at sorte omriss ikke stacker
        // oppå nabosegmentets fargefyll i kryss. Default 'both' beholder
        // gammel atferd for andre koder. Casing + overlay emitteres fra
        // samme bucket-liste så tvilling-pathene deler identisk data-bbox
        // og culles sammen.
        const lines = []
        if (phase !== 'overlay') {
          for (const b of lineBuckets) lines.push(`    <path d="${b.ds.join(' ')}"${bboxAttr(b.bbox, fmt)}/>`)
        }
        if (phase !== 'casing') {
          for (const b of lineBuckets) lines.push(`    <path d="${b.ds.join(' ')}" class="overlay"${bboxAttr(b.bbox, fmt)}/>`)
        }
        return `  <g data-layer="${cat}" data-iso="${code}">\n${lines.join('\n')}\n  </g>\n`
      }
      // v12.0.15: koder med casingStroke (stier 505/506) får en kontinuerlig
      // lys underlinje-tvilling FØRST i gruppen (samme d/bbox, class="casing")
      // så den stiplede streken tegnes oppå. CSS-regelen for `.casing` settes
      // i symbolizer.js (farge faller tilbake på var(--bg)).
      const hasCasing = !!getIsomDef(code, isomCatalog, false)?.casingStroke
      const casingLines = hasCasing
        ? lineBuckets.map(b => `    <path d="${b.ds.join(' ')}" class="casing"${bboxAttr(b.bbox, fmt)}/>`)
        : []
      const pathLines = lineBuckets.map(b => `    <path d="${b.ds.join(' ')}"${bboxAttr(b.bbox, fmt)}/>`)
      const allLinePaths = [...casingLines, ...pathLines, ...namedLinePaths]
      return `  <g data-layer="${cat}" data-iso="${code}">\n${allLinePaths.join('\n')}\n  </g>\n`
    }
    return ''
  }

  const labelSvg = () => {
    const parts = []
    for (const el of peaks) {
      const p = project(el.lat, el.lon)
      const rawName = (el.tags?.name ?? '').trim()
      const name = xmlEscape(rawName)
      const ele = el.tags?.ele ?? ''
      const eleNum = parseFloat(ele)
      // Vis navn over og høyde under separat når begge finnes; ellers
      // bare navn. Dette matcher orienteringskart-konvensjon (navn over
      // toppsymbol, høyde italic under). Krever mer plass enn én linje
      // men gir bedre lesbarhet ved zoom.
      // Hvis peak-noden også har trigpunkt-tagger (vanlig i Norge — én
      // OSM-node med både natural=peak og man_made=survey_point), erstatt
      // peak-prikken med trigpunkt-trekant. Beholder navn+ele label slik
      // at brukeren ser «Vardåsen 349» med trekant istedenfor sort prikk.
      const isTrig = isTrigPoint(el.tags)
      const symbol = isTrig
        ? `<use href="#${symbolIds.get('trigpunkt')}" x="-0.8mm" y="-0.8mm" width="1.6mm" height="1.6mm"/>`
        : `<use href="#${symbolIds.get('peak')}" x="-0.7mm" y="-0.7mm" width="1.4mm" height="1.4mm"/>`
      const lines = []
      // claimLabelName: navn rendres kun én gang på hele kartet (global
      // dedup). Er navnet allerede brukt, faller vi tilbake til høyde-only
      // for toppen (symbol + tall beholdes — det er bare navnet vi dropper).
      // v12.0.7 (Stedsnavn-typografi): høyden settes INLINE som <tspan> etter
      // navnet («Stubdalskampen 604» som én lesbar enhet) istedenfor stablet
      // linje under. tspan-en beholder data-label="peak-ele" så den brune,
      // mindre høyde-stilen gjelder. Høyde-only-fallback uendret.
      if (name && claimLabelName(rawName, 'topp', p.x, p.y)) {
        const ele = Number.isFinite(eleNum)
          ? `<tspan dx="1mm" data-label="peak-ele">${Math.round(eleNum)}</tspan>`
          : ''
        lines.push(`<text x="2mm" y="-0.4mm" data-label="peak" data-score="${labelScore('peak', { ele: eleNum })}">${name}${ele}</text>`)
      } else if (Number.isFinite(eleNum)) {
        lines.push(`<text x="2mm" y="1.4mm" data-label="peak-ele">${Math.round(eleNum)}</text>`)
      }
      parts.push(`    <g transform="translate(${fmt(p.x)},${fmt(p.y)})">${symbol}${lines.join('')}</g>`)
    }
    if (!parts.length) return '  <g data-layer="navn"></g>\n'
    return `  <g data-layer="navn">\n${parts.join('\n')}\n  </g>\n`
  }

  // v8.1.0: stedsnavn-overlay (default AV). Vises som eget data-layer
  // med større skrift slik at bruker kan slå på et tydelig områdenavn-
  // overlegg uten å rote til hovedkartet. Inkluderer ALLE place=*-noder
  // (locality, hamlet, village, town, city, suburb, neighbourhood,
  // quarter, isolated_dwelling, farm).
  const stedsnavnSvg = () => {
    // v9.1.20 — Tre viktighets-nivåer, hvert sitt lag (data-layer) så brukeren
    // kan toggle dem hver for seg (f.eks. landsby av, by på). Tekstene beholder
    // data-label="stedsnavn" + data-rank for font-størrelse, utzoom-LOD og søk.
    const byRank = { major: [], mid: [], minor: [] }
    for (const el of places) {
      if (!el.tags?.name) continue
      const p = project(el.lat, el.lon)
      // Global navn-dedup: kun mot andre STEDSNAVN (kind 'sted') — gården/bygda
      // som deler navn med fjellet/øya er en ekte navnetvilling og skal vises.
      if (!claimLabelName(el.tags.name, 'sted', p.x, p.y)) continue
      const rank = placeRank(el.tags.place)
      byRank[rank].push(`    <text x="${fmt(p.x)}" y="${fmt(p.y)}" dy="-0.5mm" text-anchor="middle" data-label="stedsnavn" data-rank="${rank}" data-score="${labelScore('stedsnavn', { rank })}">${xmlEscape(el.tags.name)}</text>`)
    }
    const group = (rank) => byRank[rank].length
      ? `  <g data-layer="stedsnavn-${rank}" style="display:none">\n${byRank[rank].join('\n')}\n  </g>\n`
      : `  <g data-layer="stedsnavn-${rank}" style="display:none"></g>\n`
    return group('major') + group('mid') + group('minor')
  }

  // ── Vann skjuler terreng-detalj via PAINTER'S ORDER, ikke en <mask> ──
  // Tidligere ble konturer/stupkanter/knauser/vegetasjon malt OPPÅ vann og så
  // skjult av en svart <mask id="land-mask"> = to representasjoner av vann (blå
  // fyll + svart maske) som måtte stemme overens. Enhver kilde masken bommet på,
  // eller evenodd-kansellering ved overlappende kilder, lakk konturer ut over
  // vann («høydekurver i vann»-saga-en). Nå males terreng-detalj UNDER det
  // opake vann-fyllet (se body-rekkefølgen): vann-fyllet ER det som dekker
  // konturer over vann. Én representasjon — kan ikke være uenig med seg selv,
  // og ingen evenodd-fallgruve (hvert vann-polygon males opakt, overlapp = bare
  // malt to ganger). Konturer over MYR (308/309, mønster) skinner gjennom, som
  // ISOM tilsier. (v9.3.34 — erstatter land-mask-lappeteppet.)

  // ── Bygg kontur-, knaus- og cliff-lag fra DEM-features ───────────────
  // DEM-transformen (demFetcher / dem.js#gridToWorld) gir world-koord der
  // row=0 (GeoTIFF øverst = NORD i UTM-bbox) maps til y=0. Det er allerede
  // samme konvensjon som OSM-`project` (nord=y=0). Identitet er korrekt;
  // tidligere `heightM - y`-flip ga vertikal speiling = kontur-tall i feil
  // ende av kartet (rapportert v6.20.0, fikset v6.20.1).
  const demProject = ([x, y]) => [x, y]

  // v10.2.9: konturer buckets per grid-celle (hel kontur per celle, samme
  // regel som polygon/linje-merging) så hver kontur-path får data-bbox og
  // reelle bounds. Lange index-konturer får store bbokser og culles sjelden
  // — akseptert; geometri splittes ikke.
  const contourMinorBuckets = new Map()  // cellKey → { ds: [], bbox }
  const contourIndexBuckets = new Map()
  const contourLabels = []
  const pushContour = (buckets, d, bbox) => {
    const key = cellKeyFor(bbox)
    let b = buckets.get(key)
    if (!b) { b = { ds: [], bbox: null }; buckets.set(key, b) }
    b.ds.push(d)
    b.bbox = unionBbox(b.bbox, bbox)
  }
  for (const f of demFeatures.contours.features) {
    // v12.0.17: heltalls-meter også for konturer (samme resonnement som
    // v11.0.50 for polygoner/linjer: 1 m = 0,1 mm @ 1:10 000, godt under
    // DP-toleransen 1,5 m). Konturene er det mest vertex-tunge laget —
    // målt ~28 % færre kontur-d-bytes. Rundes FØR både d og bbox så
    // koordinat-i-bbox-invarianten holder.
    const projected = f.coordinates.map(demProject).map(p => [Math.round(p[0]), Math.round(p[1])])
    // v9.3.37: åpne kontur-løp (splittet mot periferi-void-masken i dem.js)
    // skal IKKE lukkes med Z — ellers trekkes en korde tvers over voidet.
    const d = polylineToPath(projected, f.closed !== false)
    const bbox = bboxOfPoints(projected)
    if (f.isIndex) {
      pushContour(contourIndexBuckets, d, bbox)
      // Legg på elevasjons-tall midt på kurven (forenklet — bare første punkt)
      const mid = projected[Math.floor(projected.length / 2)]
      contourLabels.push({ x: mid[0], y: mid[1], elev: Math.round(f.elevation) })
    } else {
      pushContour(contourMinorBuckets, d, bbox)
    }
  }

  // ── Navn og elevasjon på innsjøer/tjern ──────────────────────────────
  // For hver innsjø/tjern (301/302): rendrer navn (når OSM har `name`-tag)
  // og høyde over havet (når DEM er tilgjengelig). Brukes for orientering
  // og for å lese kartet ved zoom-inn.
  //
  // Terskel:
  //   - Felles MIN_AREA (1500 m², ~40×40 m). Norske tjern er ofte
  //     mindre enn 5000 m², så vi unifiserer: alle vann over terskel
  //     får både navn (hvis OSM har det) og moh (hvis DTM tilgjengelig).
  //
  // Skipped for saltvann (303 ≈ 0) og myr (308/309).
  const MIN_AREA = 1500
  const lakeLabels = []

  // Sample DEM ved et punkt i bbox-relativt koord-rom — samme som
  // `project()` returnerer (x ∈ [0, widthM], y ∈ [0, heightM] med y=0
  // = nord). Transformen (originX/Y=0, positiv pixelHeight) gjør at
  // row=0 (GeoTIFF nord) ↔ yM=0 stemmer direkte.
  const sampleDem = usableDem
    ? (xM, yM) => {
        const t = usableDem.transform
        const col = Math.round((xM - t.originX) / t.pixelWidth)
        const row = Math.round((yM - t.originY) / t.pixelHeight)
        if (col < 0 || col >= usableDem.cols || row < 0 || row >= usableDem.rows) return null
        const v = usableDem.data[row * usableDem.cols + col]
        if (v === usableDem.noData) return null
        return v
      }
    : null

  // Areal og sentroid fra en SVG-projisert ring (brukes for merged-water).
  const ringAreaCentroid = (ring) => {
    if (!ring || ring.length < 3) return null
    let a = 0, cx = 0, cy = 0
    for (let i = 0, n = ring.length; i < n; i++) {
      const j = (i + 1) % n
      const cr = ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1]
      a += cr
      cx += (ring[i][0] + ring[j][0]) * cr
      cy += (ring[i][1] + ring[j][1]) * cr
    }
    if (Math.abs(a) < 1e-6) return null
    return { areaM2: Math.abs(a) / 2, x: cx / (3 * a), y: cy / (3 * a) }
  }

  // v11.0.79: navne-plassering for vann som bare delvis er i utsnittet.
  // Et stort vann (f.eks. Setten, 11,6 km²) der mesteparten ligger utenfor
  // bboksen har sitt ekte tyngdepunkt utenfor lerretet — navnet havnet da
  // off-canvas (usynlig + utenfor søkeindeksen). Disse hjelperne klipper
  // ringen mot kart-rektangelet [0,widthM]×[0,heightM] og finner et punkt
  // GARANTERT på den synlige biten. Ren label-geometri; vann-fyllet røres
  // ikke (det klippes allerede av viewBox).
  const clipRingToBounds = (ring) => {
    if (!ring || ring.length < 3) return []
    const clipEdge = (pts, inside, intersect) => {
      const out = []
      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i]
        const prev = pts[(i + pts.length - 1) % pts.length]
        const curIn = inside(cur)
        if (inside(prev)) {
          if (curIn) out.push(cur)
          else out.push(intersect(prev, cur))
        } else if (curIn) {
          out.push(intersect(prev, cur))
          out.push(cur)
        }
      }
      return out
    }
    let pts = ring
    pts = clipEdge(pts, p => p[0] >= 0, (a, b) => { const t = (0 - a[0]) / (b[0] - a[0]); return [0, a[1] + t * (b[1] - a[1])] })
    if (pts.length < 3) return []
    pts = clipEdge(pts, p => p[0] <= widthM, (a, b) => { const t = (widthM - a[0]) / (b[0] - a[0]); return [widthM, a[1] + t * (b[1] - a[1])] })
    if (pts.length < 3) return []
    pts = clipEdge(pts, p => p[1] >= 0, (a, b) => { const t = (0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), 0] })
    if (pts.length < 3) return []
    pts = clipEdge(pts, p => p[1] <= heightM, (a, b) => { const t = (heightM - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), heightM] })
    return pts.length >= 3 ? pts : []
  }

  const pointInRing = (pt, ring) => {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
      if (((yi > pt[1]) !== (yj > pt[1])) &&
          (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside
    }
    return inside
  }

  // Punkt godt inne i en (klippet) ring: sentroiden hvis den ligger inni,
  // ellers det rutenett-punktet med størst avstand til kanten (grov
  // «pole of inaccessibility»). Garanterer navn PÅ vann, ikke på land.
  const interiorLabelPoint = (ring) => {
    const ac = ringAreaCentroid(ring)
    if (ac && pointInRing([ac.x, ac.y], ring)) return { x: ac.x, y: ac.y }
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
    for (const p of ring) {
      if (p[0] < minx) minx = p[0]
      if (p[0] > maxx) maxx = p[0]
      if (p[1] < miny) miny = p[1]
      if (p[1] > maxy) maxy = p[1]
    }
    const segDistSq = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay
      const l2 = dx * dx + dy * dy
      let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const qx = ax + t * dx, qy = ay + t * dy
      return (px - qx) * (px - qx) + (py - qy) * (py - qy)
    }
    const N = 12
    let best = null, bestD = -Infinity
    for (let ix = 1; ix < N; ix++) {
      for (let iy = 1; iy < N; iy++) {
        const x = minx + (maxx - minx) * ix / N
        const y = miny + (maxy - miny) * iy / N
        if (!pointInRing([x, y], ring)) continue
        let d = Infinity
        for (let i = 0, n = ring.length; i < n; i++) {
          const j = (i + 1) % n
          const dd = segDistSq(x, y, ring[i][0], ring[i][1], ring[j][0], ring[j][1])
          if (dd < d) d = dd
        }
        if (d > bestD) { bestD = d; best = { x, y } }
      }
    }
    return best ?? (ac ? { x: ac.x, y: ac.y } : null)
  }

  // v7.1.14: utvidet med 303 (saltvann/bukt/sund/fjord). For padlekart er
  // navn på bukter/sund/poll viktige orienteringspunkter. 303-features
  // kommer fra OSM-relations med natural=bay/strait/water=sea og har ofte
  // name-tag. Vi skipper elev-sampling for saltvann (det er ~0 moh per
  // definisjon).
  for (const code of ['301', '302', '303']) {
    const isSeawater = code === '303'
    for (const el of buckets[code] ?? []) {
      let areaM2 = 0
      let centroid = null
      let outerRingSvg = null

      if (el.type === 'merged-water' && el._mergedRings && el._mergedRings.length) {
        // Bruk største outer-ring (første polygon, første ring) som proxy
        const ring = el._mergedRings[0]?.[0]
        const ac = ringAreaCentroid(ring)
        if (!ac) continue
        areaM2 = ac.areaM2
        centroid = { x: ac.x, y: ac.y }
        outerRingSvg = ring
      } else if (el.type === 'way' && el.geometry) {
        areaM2 = polygonAreaM2(el.geometry)
        centroid = polygonCentroid(el.geometry)
        outerRingSvg = el.geometry.map(g => {
          const p = project(g.lat, g.lon)
          return [p.x, p.y]
        })
      } else if (el.type === 'relation' && el.members) {
        // OSM-relation (typisk for saltvann/fjord). Bygg outer-rings og
        // bruk største ring som sentroid-proxy.
        const outerRings = assembleRelationRings(el.members, 'outer')
        if (outerRings.length === 0) continue
        const projectedRings = outerRings.map(ring =>
          ring.map(g => {
            const p = project(g.lat, g.lon)
            return [p.x, p.y]
          })
        )
        let largest = null, largestArea = 0, largestRing = null
        for (const r of projectedRings) {
          const ac = ringAreaCentroid(r)
          if (ac && ac.areaM2 > largestArea) { largest = ac; largestArea = ac.areaM2; largestRing = r }
        }
        if (!largest) continue
        areaM2 = largestArea
        centroid = { x: largest.x, y: largest.y }
        outerRingSvg = largestRing
      } else {
        continue
      }
      if (!centroid) continue

      // Faller tyngdepunktet utenfor lerretet (stort vann bare delvis i
      // utsnittet)? Klipp ringen mot kart-rektangelet og plasser navnet på
      // den synlige biten i stedet — ellers blir det rendret off-canvas og
      // forsvinner fra både kart og søk.
      const inView = centroid.x >= 0 && centroid.x <= widthM &&
                     centroid.y >= 0 && centroid.y <= heightM
      if (!inView) {
        const clipped = outerRingSvg ? clipRingToBounds(outerRingSvg) : []
        const pt = clipped.length ? interiorLabelPoint(clipped) : null
        if (!pt) continue
        centroid = pt
      }

      // Saltvann har lavere areal-terskel siden et lite "Pollen" eller
      // "Bukta" er like viktig for orientering som en stor fjord.
      const minArea = isSeawater ? Math.max(MIN_AREA / 4, 500) : MIN_AREA
      if (areaM2 < minArea) continue
      const name = (el.tags?.name ?? '').trim()
      // Saltvann uten navn er ikke verdt å rendre (brukeren ser jo at
      // det er sjø). Innsjøer uten navn kan likevel ha elev som info.
      if (isSeawater && !name) continue

      let elev = null
      if (!isSeawater && sampleDem) {
        const v = sampleDem(centroid.x, centroid.y)
        if (v != null && Number.isFinite(v)) elev = Math.round(v)
      }

      if (name || elev != null) {
        lakeLabels.push({ x: centroid.x, y: centroid.y, name, elev, areaM2 })
      }
    }
  }

  // ── Områdenavn (v8.10.9) ──────────────────────────────────────────────
  // Navn på hytter, myrer, husmannsplasser, gløtter, sletter osv — alt
  // navngitt polygon-areal som IKKE er vannflate eller fjelltopp (de er
  // allerede labelet). Hytter (små bygg med name) får navnet vist ved
  // siden av symbolet. Større arealer (myr, heath, grassland, meadow,
  // locality-polygoner) får navn ved sentroiden.
  const omradenavnLabels = []
  const omradeSeen = new Set()
  // Lange bygningsnavn er nesten alltid institusjons-/avdelingsnavn
  // (universitetscampus o.l.: «Menneskerettighetshuset», «Universitets-
  // ledelsen», «Seksjon for …») som klumper seg sammen og spammer kartet
  // midt i det som ISOM-messig ser ut som skog/åpen mark. Ekte hytte-/stue-
  // navn er korte, så en lengde-cap luker bort klyngene uten å miste dem.
  // Treffer KUN bygningsnavn — vann-/sted-/naturreservat-navn rendres via
  // egne rutiner og er uberørt. (v10.2.42)
  const MAX_BUILDING_LABEL_LEN = 16
  for (const el of elements) {
    const name = el.tags?.name?.trim()
    if (!name) continue
    const tags = el.tags
    // Vannflater og bekker labels håndteres av lakeLabels/waterwayLabels
    const isWater = tags.natural === 'water' || !!tags.water ||
                    tags.natural === 'bay' || tags.natural === 'strait' ||
                    tags.place === 'sea' || tags.place === 'ocean' ||
                    !!tags.waterway
    if (isWater) continue
    // Fjelltopper rendrer egen label via peaksSvg
    if (tags.natural === 'peak' || tags.natural === 'saddle') continue
    // place=*-noder rendrer egen label via stedsnavnSvg / places
    if (el.type === 'node' && tags.place) continue
    // Lineære features (vei, sti, jernbane, gjerde, kraftlinje) og rute-
    // relasjoner (busslinjer o.l.) er IKKE arealer og skal aldri få et
    // areal-navn. Rute-relasjonens way-medlemmer har TOM rolle, så
    // assembleRelationRings(..,'outer') plukker dem opp som «outer» (fallback),
    // og polygonAreaM2 wrapper den åpne traséen (shoelace %n) til et falskt
    // areal > minArea. Resultat: lange «A – B / A – (C) – B»-rutenavn ble
    // labelet som område-navn — og lengde-cappen under er building-only, så
    // den traff dem aldri. (v10.2.43)
    if (tags.highway || tags.railway || tags.route || tags.type === 'route' ||
        tags.public_transport || tags.barrier || tags.power) continue

    // Hoppbakke (sport=ski_jumping): brukeren vil ha disse navngitt. De
    // mappes i OSM ofte som en ÅPEN profil-linje (way) eller en enkelt node,
    // ikke et lukket areal — så de hoppes over av areal-logikken under. Vi
    // navngir dem uansett: åpen way → midtpunkt av linja, node → punktet selv.
    const isSkiJump = tags.sport === 'ski_jumping'
    let cent = null
    let areaM2 = 0
    if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
      // Bare LUKKEDE ways er arealer. En åpen polylinje er lineær —
      // polygonAreaM2 wrapper den (%n) og gir et falskt areal, så åpne
      // navngitte ways ville ellers fått en område-label (samme rot som over).
      const g0 = el.geometry[0]
      const gN = el.geometry[el.geometry.length - 1]
      const closed = Math.abs(g0.lat - gN.lat) < 1e-9 && Math.abs(g0.lon - gN.lon) < 1e-9
      if (!closed) {
        if (!isSkiJump) continue
        // Åpen hoppbakke-profil: label på midt-noden i linja.
        const gm = el.geometry[Math.floor(el.geometry.length / 2)]
        cent = project(gm.lat, gm.lon)
      } else {
        areaM2 = polygonAreaM2(el.geometry)
        cent = polygonCentroid(el.geometry)
      }
    } else if (el.type === 'node' && isSkiJump) {
      cent = project(el.lat, el.lon)
    } else if (el.type === 'way' && el.geometry && el.geometry.length === 2 && isSkiJump) {
      const gm = el.geometry[0]
      cent = project(gm.lat, gm.lon)
    } else if (el.type === 'relation' && el.members) {
      const outerRings = assembleRelationRings(el.members, 'outer')
      if (outerRings.length === 0) continue
      let largestArea = 0
      let largestCent = null
      for (const ring of outerRings) {
        const projected = ring.map(g => {
          const p = project(g.lat, g.lon)
          return [p.x, p.y]
        })
        const ac = ringAreaCentroid(projected)
        if (ac && ac.areaM2 > largestArea) {
          largestArea = ac.areaM2
          largestCent = { x: ac.x, y: ac.y }
        }
      }
      if (!largestCent) continue
      areaM2 = largestArea
      cent = largestCent
    } else {
      continue
    }
    if (!cent) continue

    const isBuilding = !!tags.building
    // Naturreservat/nasjonalpark får dedikert grønn-på-hvit label (matcher
    // visuell hierarki for vann/innsjø som er blå-på-hvit). Speiler classify-
    // ToIsom-reglene for kode 520 så samme polygoner som får grønn overlay
    // også får grønn navn-label.
    const isNatRes = (
      tags.leisure === 'nature_reserve' ||
      tags.boundary === 'national_park' ||
      (tags.boundary === 'protected_area' && /^(1|1a|1b|4)$/.test(String(tags.protect_class ?? '')))
    )
    // Hytter rendrer som lite symbol (13×13 m kvadrat) — minst krav er at
    // bygget er gjenkjent. Andre arealer trenger større minimum for å unngå
    // å spamme bbox med navn på tiny features.
    const minArea = isBuilding || isSkiJump ? 0 : 1000
    if (areaM2 < minArea) continue
    // Naturreservat-mistags (gigantiske polygoner) labels også droppes —
    // speiler maxAreaM2-cappingen i POLYGON_FILTER.naturreservat.
    if (isNatRes && areaM2 > 200_000_000) continue
    // Bare label hytter (små bygg < 500m²) — store bygninger får ikke navn
    // for å unngå rot i tette boligområder. 521-terskel ovenfor speiles her.
    if (isBuilding && areaM2 >= 500) continue
    // Dropp lange bygningsnavn (institusjons-/avdelingsklynger, se over).
    if (isBuilding && name.length > MAX_BUILDING_LABEL_LEN) continue

    // Dedupe: samme navn innen ~80 m bucket (få store myr/heath kan ha
    // flere subareal-polygoner med samme navn — vi vil bare ha én label)
    const key = `${name}|${Math.round(cent.x / 80)}|${Math.round(cent.y / 80)}`
    if (omradeSeen.has(key)) continue
    omradeSeen.add(key)

    omradenavnLabels.push({
      x: cent.x, y: cent.y, name, isBuilding, isNatRes, areaM2,
    })
  }

  // v9.1.17 — knaus (ISOM 213) som ÉN merged vektor-<path>. Katalog-symbolet
  // er en liten halvmåne «M-0.6 0.4 A0.6 0.4 0 0 0 0.6 0.4» i symbol-viewBox
  // «-1 -1 2 2», vist i scaleMm=1.2mm. viewBox er i meter, og 1 mm = scaleDenom/
  // 1000 enheter, så 1 symbol-enhet = (1.2/2)·(scaleDenom/1000) viewBox-enheter.
  // Vi stamper halvmånen inn pr knaus-senter — 1 node, knivskarp, solid strek.
  const symUnit = (1.2 / 2) * (scaleDenom / 1000)   // viewBox-enheter pr symbol-enhet
  const krx = 0.6 * symUnit
  const kry = 0.4 * symUnit
  const kdy = 0.4 * symUnit                          // halvmånens y-offset (0.4 i symbolet)
  // v10.2.9: knaus-halvmånene buckets per grid-celle (de er 1–2 m hver, så
  // celle-tildeling er triviell) — én path per celle med data-bbox i stedet
  // for én kart-dekkende merged path.
  const knausBuckets = new Map()  // cellKey → { ds: [], bbox }
  for (const k of (demFeatures.knauser ?? [])) {
    const [x, y] = demProject([k.x, k.y])
    const d = `M${fmt(x - krx)} ${fmt(y + kdy)}A${fmt(krx)} ${fmt(kry)} 0 0 0 ${fmt(x + krx)} ${fmt(y + kdy)}`
    const bbox = { minX: x - krx, minY: y - kry + kdy, maxX: x + krx, maxY: y + kry + kdy }
    const key = cellKeyFor(bbox)
    let b = knausBuckets.get(key)
    if (!b) { b = { ds: [], bbox: null }; knausBuckets.set(key, b) }
    b.ds.push(d)
    b.bbox = unionBbox(b.bbox, bbox)
  }
  // Knauser maskeres også av vann — DEM-deriverte punkt-symboler skal ikke
  // ligge oppå en innsjø (samme begrunnelse som stupkanter/konturer).
  const knauserLayerSvg = knausBuckets.size
    ? `  <g data-layer="stein" data-iso="213">${[...knausBuckets.values()].map(b =>
        `<path d="${b.ds.join('')}" fill="none" stroke="#7f4f24" stroke-width="0.12mm"${bboxAttr(b.bbox, fmt)}/>`).join('')}</g>\n`
    : ''

  // Hule (ISOM 215) og gruve (ISOM 216): point-symboler. Sentrert ±0.7mm
  // = 1.4mm bredde (matcher scaleMm i katalogen).
  // Posisjon via transform=translate(...) i user-units (meter) — å skrive
  // x="<meter>mm" tolkes som ~3.78× user-units pr mm (CSS-spec), så symbolet
  // havnet langt unna der project() ga oss. Samme fix som parkering (v8.10.x);
  // gjelder hule/gruve/trig/kirke/bom.
  const huleSvg = huler.map(el => {
    const p = project(el.lat, el.lon)
    const sid = symbolIds.get('hule')
    if (!sid) return ''
    return `    <g transform="translate(${fmt(p.x)},${fmt(p.y)})"><use href="#${sid}" x="-0.7mm" y="-0.7mm" width="1.4mm" height="1.4mm"/></g>`
  }).filter(Boolean).join('\n')

  const gruveSvg = gruver.map(el => {
    const p = project(el.lat, el.lon)
    const sid = symbolIds.get('gruve')
    if (!sid) return ''
    return `    <g transform="translate(${fmt(p.x)},${fmt(p.y)})"><use href="#${sid}" x="-0.7mm" y="-0.7mm" width="1.4mm" height="1.4mm"/></g>`
  }).filter(Boolean).join('\n')

  // Trigonometrisk punkt (ISOM 113): trekant-symbol 1.6mm
  const trigSvg = trigpunkter.map(el => {
    const p = project(el.lat, el.lon)
    const sid = symbolIds.get('trigpunkt')
    if (!sid) return ''
    return `    <g transform="translate(${fmt(p.x)},${fmt(p.y)})"><use href="#${sid}" x="-0.8mm" y="-0.8mm" width="1.6mm" height="1.6mm"/></g>`
  }).filter(Boolean).join('\n')

  // Kirke (ISOM 532-derivert): hytte-stil rektangulær ramme med kors 2.6mm.
  // Node-kirker plasseres direkte på OSM-noden; way-kirker (building=church
  // polygon) plasseres på centroid og rendres OVER bygnings-laget så
  // symbolet er synlig over den brune bygnings-fyllen.
  const kirkeSize = 2.6
  const kirkeSvg = kirker.map(el => {
    let p = null
    if (el.type === 'node') p = project(el.lat, el.lon)
    else if (el.type === 'way' && el.geometry) p = polygonCentroid(el.geometry)
    if (!p) return ''
    const sid = symbolIds.get('kirke')
    if (!sid) return ''
    const half = kirkeSize / 2
    return `    <g transform="translate(${fmt(p.x)},${fmt(p.y)})"><use href="#${sid}" x="-${half}mm" y="-${half}mm" width="${kirkeSize}mm" height="${kirkeSize}mm"/></g>`
  }).filter(Boolean).join('\n')

  // Parkering (ISOM 534-derivert): blå P-symbol 7.2mm (300% av v8.10.2-
  // basis). Node-parkering på OSM-noden, way-parkering på polygon-centroid.
  // Posisjon må gå via transform=translate(...) i user-units (meter) — å skrive
  // x="<meter>mm" tolkes av nettleseren som ~3.78× user-units pr mm (CSS-spec),
  // så symbolet havner langt unna der project() ga oss. Bro-renderingen bruker
  // samme pattern; nå også parkering.
  // data-upright="1" gjør at MapView counter-roterer symbolet ved kart-
  // rotasjon, så "P" alltid leses vannrett med skjermens topp som rettesnor.
  //
  // Utfartsparkering (offentlig/trailhead) skilles ut med vanlig blått P-skilt
  // + fire frittstående sorte hjørne-braketter (parkering-utfart, kode 534u),
  // så den foretrukne plassen for marka-turer fanger blikket blant de mange
  // private P-plassene. Sorte braketter framfor grønn ramme fordi grønt-mot-
  // blått svikter for blå-grønn-fargeblinde. data-iso = 534 / 534u for
  // Tegnforklaring-kobling.
  //
  // KVALIFISERING (begge MÅ gjelde):
  //   (a) isTrailheadParking(tags) — offentlig access eller utfart-/tur-navn
  //   (b) en sti (ISOM 505/506/507) ELLER skogsbilvei (504) innen 50 m av
  //       P-punktet
  // Regel (b) sikrer at vi bare framhever parkering som faktisk er et
  // utgangspunkt for tur — en offentlig P-plass uten sti/skogsbilvei i
  // nærheten er ikke en utfartsparkering i praksis. Skogsbilvei (504) ble
  // tatt med f.o.m. v11.0.8 fordi mange marka-P-er ligger ved enden av en
  // skogsbilvei der selve turstien tar av lenger inne. Geometrien hentes fra
  // de allerede bucket-klassifiserte vegene/stiene og projiseres til meter-
  // rom (samme som P-punktet), så 50 m-terskelen er ekte meter. (Var kort
  // oppe på 100 m i v11.0.9, men reversert i v11.0.10 så sti og skogsbilvei
  // har like forutsetninger; store P-plasser som MIF-hytta er uansett
  // søkbare ved kart-opprettelse og trenger ikke utfarts-markøren.)
  const STI_CODES = ['504', '505', '506', '507']
  const UTFART_STI_MAXDIST_M = 50
  const stiPolylines = []
  for (const code of STI_CODES) {
    for (const el of (buckets[code] || [])) {
      if (el.geometry && el.geometry.length >= 2) {
        stiPolylines.push(el.geometry.map(g => project(g.lat, g.lon)))
      }
    }
  }
  // ── Navngi utfartsparkering etter nærmeste natur-feature ──────────────
  // Søk i kartet etter «parkering» skal liste utfartsparkeringene med et
  // gjenkjennelig navn. Vi velger nærmeste navngitte feature i PRIORITERT
  // rekkefølge: fjelltopp → ås → elv → vann (brukerens ønske). Et P-punkt
  // ved Knivåsen blir «Utfartsparkering Knivåsen» (typen først, så stedet).
  // Navnet emitteres som data-name på 534u-markøren og plukkes opp av
  // søkeindeksen (useMapSearch); det er IKKE et offisielt navn, så UI-en
  // merker det med en * og et forbehold.
  // Tier 0=fjelltopp (natural=peak/saddle), 1=ås (place-navn med terreng-
  // suffiks), 2=elv (waterway river/stream/canal), 3=vann (navngitt innsjø).
  // Tier 4 = nærmeste øvrige stedsnavn som fallback når ingen natur-feature
  // ligger innenfor radiusen.
  const AAS_SUFFIX_RE = /(ås|åsen|åsane|kollen|koll|haugen|haug|nuten|nut|fjell|fjellet|berg|berget|heia|høgda|toppen|varden|egga|eggen|pigg|piggen|kletten?)$/i
  const nameCands = []  // { tier, x, y, name }
  const pushNameCand = (tier, x, y, name) => {
    const nm = (name ?? '').trim()
    if (nm && Number.isFinite(x) && Number.isFinite(y)) nameCands.push({ tier, x, y, name: nm })
  }
  for (const e of peaks) {
    if (!e.tags?.name) continue
    const p = project(e.lat, e.lon); pushNameCand(0, p.x, p.y, e.tags.name)
  }
  for (const e of places) {
    const nm = e.tags?.name
    if (!nm) continue
    const p = project(e.lat, e.lon)
    pushNameCand(AAS_SUFFIX_RE.test(nm) ? 1 : 4, p.x, p.y, nm)
  }
  for (const e of elements) {
    const wy = e.tags?.waterway
    if ((wy === 'river' || wy === 'stream' || wy === 'canal') && e.tags?.name && e.geometry?.length) {
      const mid = e.geometry[Math.floor(e.geometry.length / 2)]
      const p = project(mid.lat, mid.lon); pushNameCand(2, p.x, p.y, e.tags.name)
    }
  }
  for (const l of lakeLabels) pushNameCand(3, l.x, l.y, l.name)

  const NAME_MAX_DIST_M = 1500
  const utfartName = (p) => {
    let best = null
    for (const c of nameCands) {
      const d = Math.hypot(c.x - p.x, c.y - p.y)
      if (d > NAME_MAX_DIST_M) continue
      if (!best || c.tier < best.tier || (c.tier === best.tier && d < best.d)) {
        best = { tier: c.tier, name: c.name, d }
      }
    }
    return best ? `Utfartsparkering ${best.name}` : 'Utfartsparkering'
  }

  const parkeringSize = 7.2
  const parkeringUtfartSize = 10.8  // braketter-symbol: blått felt 5.4mm (= vanlig P); brakettene strekker til ≈9.7mm
  // Projiser hver parkering og avgjør utfart-status FØR uttynning, så
  // thinParkering kan jobbe i meter-rom og alltid beholde utfartsparkeringene.
  const parkeringCands = parkeringer.map(el => {
    let p = null
    if (el.type === 'node') p = project(el.lat, el.lon)
    else if (el.type === 'way' && el.geometry) p = polygonCentroid(el.geometry)
    if (!p) return null
    const utfart = isTrailheadParking(el.tags) &&
      isPointNearPolylines(p, stiPolylines, UTFART_STI_MAXDIST_M)
    return { p, utfart }
  }).filter(Boolean)
  // Tynn ut tett plasserte vanlige P-plasser (min PARKERING_MIN_SEP_M meter);
  // utfartsparkering vises alltid uansett nærhet.
  const parkeringSvg = thinParkering(parkeringCands, PARKERING_MIN_SEP_M).map(({ p, utfart }) => {
    const sid = symbolIds.get(utfart ? 'parkering-utfart' : 'parkering')
    if (!sid) return ''
    const size = utfart ? parkeringUtfartSize : parkeringSize
    const half = size / 2
    const iso = utfart ? '534u' : '534'
    // Utfartsparkering får data-name (nærmeste natur-feature) så den blir
    // søkbar på «parkering». Vanlig privat P (534) forblir unavngitt.
    const nameAttr = utfart ? ` data-name="${xmlEscape(utfartName(p))}"` : ''
    return `    <g data-upright="1" data-iso="${iso}"${nameAttr} transform="translate(${fmt(p.x)},${fmt(p.y)})"><use href="#${sid}" x="-${fmt(half)}mm" y="-${fmt(half)}mm" width="${fmt(size)}mm" height="${fmt(size)}mm"/></g>`
  }).filter(Boolean).join('\n')

  // Holdeplass (ISOM 560-derivert): blå buss-symbol 6.0mm. OSM-node-posisjon.
  // data-upright="1" holder symbolet rett ved kart-rotasjon (samme som
  // parkering/toalett). Brukes av «nærmeste holdeplass»-snarveien i søket.
  const holdeplassSize = 6.0
  // Tynn ut tette terminal-klynger: én representant (midterste) pr klynge, så
  // ikke hver busslomme/p-plass gir sitt eget symbol (Asker/Sandvika-tilfellet).
  const holdeplassSvg = clusterHoldeplasser(holdeplasser, HOLDEPLASS_MIN_SEP_M).map(el => {
    if (el.type !== 'node') return ''
    const p = project(el.lat, el.lon)
    const sid = symbolIds.get('holdeplass')
    if (!sid) return ''
    const half = holdeplassSize / 2
    const name = el.tags?.name ?? el.tags?.navn ?? ''
    const nameAttr = name ? ` data-name="${xmlEscape(name)}"` : ''
    return `    <g data-upright="1"${nameAttr} transform="translate(${fmt(p.x)},${fmt(p.y)})"><use href="#${sid}" x="-${half}mm" y="-${half}mm" width="${holdeplassSize}mm" height="${holdeplassSize}mm"/></g>`
  }).filter(Boolean).join('\n')

  // Bom / barriere (ISOM 526-derivert): sort horisontal bar 1.6mm. OSM-
  // node-posisjon direkte. Ingen rotasjon — vi har ikke pålitelig vei-
  // tangent ved barriere-noden uten å indeksere alle ways først.
  const bomSize = 1.6
  const bomSvg = bommer.map(el => {
    if (el.type !== 'node') return ''
    const p = project(el.lat, el.lon)
    const sid = symbolIds.get('bom')
    if (!sid) return ''
    const half = bomSize / 2
    return `    <g transform="translate(${fmt(p.x)},${fmt(p.y)})"><use href="#${sid}" x="-${half}mm" y="-${half}mm" width="${bomSize}mm" height="${bomSize}mm"/></g>`
  }).filter(Boolean).join('\n')

  // Fase 3: marine / padle-POI (fyr, sjømerker, skjær, landingssteder,
  // småbåthavner, toaletter, drikkevann). Symbol + størrelse fra
  // isomCatalog pr kode. `data-upright` holder symbolet rett ved kart-
  // rotasjon (samme som parkering). Topologisk Marker ∈ Water-filter:
  // koder med requireWater droppes hvis de faller på land (utenfor den
  // autoritative kysten) — kun aktivt når vi faktisk HAR en kyst-modell.
  const marinePlaced = marinePoints.map(({ el, code }) => {
    let p = null
    if (el.type === 'node') p = project(el.lat, el.lon)
    else if (el.geometry && el.geometry.length >= 3) p = polygonCentroid(el.geometry)
    else if (el.geometry && el.geometry.length >= 1) p = project(el.geometry[0].lat, el.geometry[0].lon)
    return p ? { code, p } : null
  }).filter(Boolean)
  const marinePointSvg = clusterLandingssteder(marinePlaced).map(({ code, p }) => {
    const mpc = MARINE_POINT_CODES[code]
    let uncertain = false
    if (mpc?.requireWater &&
        !pointFeatureKept(p.x, p.y, authoritativeSea, { requireWater: true })) {
      // v11.0.49: et skjær (211) er en FARE — bedre å vise det dempet og merket
      // «posisjon usikker» enn å slette det stille (et slettet skjær er farligere
      // enn ett tegnet litt feil). Andre marine punkt (bøyer på land = klare
      // datafeil, ingen kollisjonsfare) droppes som før.
      if (mpc.flagIfDry) uncertain = true
      else return ''
    }
    const def = getIsomDef(code, isomCatalog, false)
    const sym = def?.point
    if (!sym) return ''
    const sid = symbolIds.get(sym.symbol)
    if (!sid) return ''
    const sz = sym.scaleMm ?? 1.6
    const half = sz / 2
    const flag = uncertain ? ' data-uncertain="1" opacity="0.55"' : ''
    return `    <g data-upright="1" data-iso="${code}"${flag} transform="translate(${fmt(p.x)},${fmt(p.y)})"><use href="#${sid}" x="-${fmt(half)}mm" y="-${fmt(half)}mm" width="${fmt(sz)}mm" height="${fmt(sz)}mm"/></g>`
  }).filter(Boolean).join('\n')

  // Kulturminner (Kulturminnesøk brukerminner — IKKE ISOM). Klikkbare ikoner med
  // felles fasade-symbol, farget pr kategori via CSS på data-kat. Tette punkter
  // klynges (30 m) med gjenbruk av clusterHoldeplasser. Kun id/kat/tittel bakes i
  // SVG-en (data-*) — full detalj hentes lazy ved klikk (MapView → fetchKulturminneById),
  // så kart-filen holdes liten. `data-upright` holder ikonet rett ved kart-rotasjon.
  const KULTURMINNE_SIZE_MM = 3.6
  const kulturminneNodes = (Array.isArray(kulturminner) ? kulturminner : [])
    .filter(k => k && Number.isFinite(k.lat) && Number.isFinite(k.lon) && k.id != null)
    .map(k => ({ ...k, type: 'node' }))
  const kulturminneSid = symbolIds.get('kulturminne')
  const kulturminneSvg = kulturminneSid
    ? clusterHoldeplasser(kulturminneNodes, 30).map(k => {
        const p = project(k.lat, k.lon)
        const half = KULTURMINNE_SIZE_MM / 2
        const kat = xmlEscape(k.kategori || 'annet')
        const tittel = xmlEscape(k.tittel || '')
        const id = xmlEscape(String(k.id))
        return `    <g data-kulturminne-id="${id}" data-kat="${kat}" data-tittel="${tittel}" data-upright="1" transform="translate(${fmt(p.x)},${fmt(p.y)})"><use href="#${kulturminneSid}" x="-${fmt(half)}mm" y="-${fmt(half)}mm" width="${fmt(KULTURMINNE_SIZE_MM)}mm" height="${fmt(KULTURMINNE_SIZE_MM)}mm"/></g>`
      }).join('\n')
    : ''

  // Bro (ISOM 512-derivert): to parallelle parapet-linjer langs HELE
  // bro-veiens lengde. Tidligere ble broen tegnet som ETT fast 1.8 mm symbol
  // på midtpunktet → en liten firkant midt i vannet uansett brolengde. Nå
  // forskyves bro-way-ens geometri perpendikulært ±broOffsetM til hver side
  // og rendres som to streker, så broen dekker korrekt fra ende til ende.
  // Dempet grå (#4a4a4a) + 0.11 mm så broen ikke blir et tungt sort band der
  // parapeten stables utenpå veiens/jernbanens kantlinje. Bredden følger
  // «Strek»-knotten via calc() + var(--stroke-scale) (som veier/stier), så
  // broen krymper i takt med kartet — stroke-width som presentasjonsattributt
  // støtter ikke calc(), derfor inline style. Forskyvningen er geometri og
  // bakes inn ved bygging (skalerer ikke live).
  // mm→meter: root-viewBox er i meter, og 1 mm = scaleDenom/1000 meter — så
  // strek-bredde i "mm" og en mm-basert offset er trygt på root-nivå (i
  // motsetning til den nestede symbol-viewBox-en, jf. anker-fiksen).
  const broOffsetM = 0.24 * (scaleDenom / 1000)   // halv avstand mellom parapet-linjene (mm→m)
  const broStyle = 'stroke:#4a4a4a;stroke-width:calc(0.11mm * var(--stroke-scale, 1))'
  const broSvg = broer.map(el => {
    if (!el.geometry || el.geometry.length < 2) return ''
    const pts = el.geometry.map(g => project(g.lat, g.lon))
    // Perpendikulær enhetsnormal pr punkt (snitt av tilstøtende segmenter gir
    // jevne hjørner); forskyv ±offset for venstre/høyre parapet-linje.
    const left = [], right = []
    for (let i = 0; i < pts.length; i++) {
      let nx = 0, ny = 0
      if (i > 0) {
        const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y
        const l = Math.hypot(dx, dy) || 1; nx += -dy / l; ny += dx / l
      }
      if (i < pts.length - 1) {
        const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y
        const l = Math.hypot(dx, dy) || 1; nx += -dy / l; ny += dx / l
      }
      const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl
      left.push({ x: pts[i].x + nx * broOffsetM, y: pts[i].y + ny * broOffsetM })
      right.push({ x: pts[i].x - nx * broOffsetM, y: pts[i].y - ny * broOffsetM })
    }
    const toPath = poly => 'M' + poly.map(p => `${fmt(p.x)} ${fmt(p.y)}`).join(' L')
    return `    <path d="${toPath(left)}" fill="none" style="${broStyle}" stroke-linecap="round" stroke-linejoin="round"/>\n    <path d="${toPath(right)}" fill="none" style="${broStyle}" stroke-linecap="round" stroke-linejoin="round"/>`
  }).filter(Boolean).join('\n')

  // Cliff-teeth (ISOM 203): perpendikulær tann på nedside. Hvis vi har
  // ekte DEM, sampler vi høyde på begge sider av spine for å velge
  // riktig side; ellers default til høyre. Spacing ~20m (~2mm @ 1:10k),
  // tann-lengde ~5m (~0.5mm). Cliff-koord er bbox-relativt (samme rom
  // som transformen, originX/Y=0), så vi sampler direkte uten å legge
  // til minE/minN.
  const cliffSampleDem = sampleDem

  const cliffsSvg = demFeatures.cliffs.map(c => {
    // Heltalls-meter for stupkant-spinen (samme som konturene, v12.0.17).
    const projected = c.coordinates.map(demProject).map(p => [Math.round(p[0]), Math.round(p[1])])
    const linePath = polylineToPath(projected, false)
    const teethPaths = []
    const SPACING_M = 20
    const TOOTH_LEN_M = 5
    let acc = SPACING_M
    for (let i = 1; i < c.coordinates.length; i++) {
      const [x0, y0] = c.coordinates[i - 1]
      const [x1, y1] = c.coordinates[i]
      const dx = x1 - x0, dy = y1 - y0
      const segLen = Math.hypot(dx, dy)
      if (segLen < 1) continue
      const ux = dx / segLen, uy = dy / segLen
      const lpx = -uy, lpy = ux
      const rpx =  uy, rpy = -ux
      while (acc <= segLen) {
        const t = acc / segLen
        const cx = x0 + dx * t, cy = y0 + dy * t
        let side = [rpx, rpy]
        if (cliffSampleDem) {
          const sx = TOOTH_LEN_M * 1.5
          const lh = cliffSampleDem(cx + lpx * sx, cy + lpy * sx)
          const rh = cliffSampleDem(cx + rpx * sx, cy + rpy * sx)
          if (Number.isFinite(lh) && Number.isFinite(rh)) {
            side = lh < rh ? [lpx, lpy] : [rpx, rpy]
          }
        }
        const tipX = cx + side[0] * TOOTH_LEN_M
        const tipY = cy + side[1] * TOOTH_LEN_M
        const [csx, csy] = demProject([cx, cy])
        const [tsx, tsy] = demProject([tipX, tipY])
        teethPaths.push(`M${fmt(csx)},${fmt(csy)}L${fmt(tsx)},${fmt(tsy)}`)
        acc += SPACING_M
      }
      acc -= segLen
      if (acc < 0) acc = SPACING_M
    }
    const teeth = teethPaths.length
      ? `\n    <path d="${teethPaths.join(' ')}" data-cliff-teeth="1"/>`
      : ''
    return `    <path d="${linePath}" />${teeth}`
  }).join('\n')

  const meta = {
    bbox,
    utmBbox: { minE, minN, maxE, maxN },
    widthM, heightM,
    scaleDenom,
    equidistance: demFeatures.equidistanceM,
    elevationRange: usableDem
      ? { min: Math.round(demFeatures.contours.minElevM), max: Math.round(demFeatures.contours.maxElevM) }
      : null,
    demSource: dem?.source ?? null,
    // Dybde-provenens (v11.0.54) — MapView viser badge: ekte Sjøkart-dybde
    // (soundings/dybdekurver levert) vs. DEM-avstand-fra-land-ESTIMAT (kun
    // demSea-bånd) vs. ingen dybde. Sikkerhets-info for padlere: den fragile
    // Sjøkart-WFS faller stille tilbake til estimatet.
    depthSource: (soundings.length > 0 || dybdekonturer.length > 0)
      ? 'sjokart'
      : (demSeaPolygons.length > 0 ? 'dem-estimat' : 'ingen'),
    coastal,                       // kyst vs innland (se options). MapView leser denne.
    sjokartStatus,                 // ok/tom/timeout/feil/innlands + evt. WFS-feil (Utvikler-fanen)
    demResolutionM: dem?.transform
      ? Math.round((Math.abs(dem.transform.pixelWidth) + Math.abs(dem.transform.pixelHeight)) / 2) || null
      : null,
    domSource: dom?.source ?? null,
    vegReclassified: chm ? vegReclassified : null,
    lakeLabels: lakeLabels.length,
    contoursSkipped: dem && !usableDem ? 'syntetisk DEM — ingen ekte høydekurver tilgjengelig' : null,
    isomVersion: '2017-2-derived',
    source: 'OpenStreetMap (ODbL) + ISOM-katalog v6.5' + (usableDem ? ` + DEM (${dem.source})` : ''),
    generated: new Date().toISOString(),
  }

  // ViewBox = meter (1 SVG-enhet = 1 m)
  const viewBox = `0 0 ${fmt(widthM)} ${fmt(heightM)}`

  // Print-størrelse: 1:10000 betyr at 1 m kart = 0.1 mm papir.
  // For å printe et 5×5 km kart i 1:10000 trenger vi 500×500 mm papir.
  // Vi setter width/height kun hvis printSize er true.
  const printAttrs = printSize
    ? `width="${fmt(widthM * 1000 / scaleDenom)}mm" height="${fmt(heightM * 1000 / scaleDenom)}mm"`
    : ''

  const renderCodes = (codes) => codes.map(layerSvg).join('')
  const groundLayers = renderCodes(GROUND_CODES)
  // DEM-derivert sjø: blå polygoner under N50/OSM-vannlag, så autoritative
  // vann-polygoner overstyrer der de finnes. Basis-laget får ISOM 303-blå
  // (mørk dyp); grunne-bånd legges på toppen med gradient-toner.
  const polygonsToPathRing = (poly) => {
    const ringPaths = []
    for (const ring of poly) {
      if (ring.length < 3) continue
      let rd = `M${fmt(ring[0][0])},${fmt(ring[0][1])}`
      for (let i = 1; i < ring.length; i++) rd += `L${fmt(ring[i][0])},${fmt(ring[i][1])}`
      rd += 'Z'
      ringPaths.push(rd)
    }
    return ringPaths.join(' ')
  }
  const demSeaBaseSvg = demSeaPolygons.length
    ? `  <g data-layer="vann" data-iso="303" data-src="dem-sea">\n${demSeaPolygons.map(poly => {
        const d = polygonsToPathRing(poly)
        return d ? `    <path d="${d}" fill-rule="evenodd"/>` : ''
      }).filter(Boolean).join('\n')}\n  </g>\n`
    : ''
  // Grunn-bånd: kumulative subset-polygoner (≤50 m ⊂ ≤200 m ⊂ alt sjø).
  // Renderingsrekkefølge: største bånd FØRST (mørkere), så minste sist
  // (lysest) så grunnest farge overstyrer ved kysten. Basis-sjø er
  // ISOM 303-mørk; båndene blir progressivt lysere mot land.
  // v9.2.0: dempet til å matche depthToColor sin kystnære skala. Dette er
  // en avstand-fra-land-PROXY (ikke ekte dybde), så tonene holdes i den
  // grunne enden av skalaen — lav-kontrast, underordnet terrenget.
  // Bånd-fyllet er tema-bevisst (var(--iso-depth-N, #fallback)) på linje med
  // 307-dybdearealet, så grunn-gradienten følger valgt tema. Indeks 3 = ytre
  // (dypere) bånd, indeks 1 = inderste (grunnest) bånd — samme skala som
  // depthToFillVar. Fallback-hexene er den opprinnelige lyse skalaen.
  const BAND_FILL_BY_DESC_DISTANCE = [
    'var(--iso-depth-3, #aed3e4)', 'var(--iso-depth-1, #d8eaf2)',
  ]
  const sortedBands = [...demSeaBands].sort((a, b) => b.maxDistanceM - a.maxDistanceM)
  const demSeaBandsSvg = sortedBands
    .map((band, idx) => {
      const fill = BAND_FILL_BY_DESC_DISTANCE[idx] ?? 'var(--iso-depth-2, #cfe6f0)'
      // v11.0.54: grunneste bånd (minst avstand fra land) får en diskret
      // «tørrfall/usikkert»-hatch oppå det blå — det er her avstand-fra-land-
      // dybdeproxyen er mest feil og der landinger/snarveier avgjøres (kajakk).
      const isShallowest = idx === sortedBands.length - 1
      const paths = band.polygons.map(poly => {
        const d = polygonsToPathRing(poly)
        if (!d) return ''
        // stroke="none" overstyrer den arvede ISOM 303-streken (#1f7aa3).
        // Båndets sjøside er en kunstig avstand-fra-land-kontur, ikke en ekte
        // strandlinje — uten dette ble den strøket med en fragmentert mørkeblå
        // linje som fløt i vannet nærmest land. Den ekte kysten strøkes av
        // dem-sea-basislaget; båndene bidrar kun med gradient-fyll.
        let s = `    <path d="${d}" style="fill: ${fill}" stroke="none" fill-rule="evenodd"/>`
        if (isShallowest) s += `\n    <path d="${d}" fill="url(#iso-pat-torrfall)" stroke="none" fill-rule="evenodd"/>`
        return s
      }).filter(Boolean).join('\n')
      return paths
        ? `  <g data-layer="vann" data-iso="303" data-src="dem-sea-band" data-band-m="${band.maxDistanceM}">\n${paths}\n  </g>\n`
        : ''
    })
    .filter(Boolean)
    .join('')
  const demSeaLayerSvg = demSeaBaseSvg + demSeaBandsSvg
  const waterLayers  = renderCodes(WATER_CODES)
  // Fase 1b: øy-overlayen (OSM place=island malt kremgul OPPÅ vann) er en
  // lapp for å dekke feilplassert vann i kyst-arkipel. Når den autoritative
  // sjøen er DEM-derivert har den allerede ekte øy-HULL, så overlayen er
  // overflødig — og å male OSM-øy-geometri (en ANNEN strandlinje) oppå ville
  // gjeninnføre en søm. Vi dropper den da. For N50-/ingen kyst-modell
  // (der sjø-geometrien mangler øy-hull) beholdes overlayen som sikkerhet.
  const landOverlayLayers = authoritativeSeaSource === 'dem'
    ? ''
    : renderCodes(LAND_OVERLAY_CODES)
  // Strand (556): sand-stippel-areal, malt over vann/øy-overlay men under
  // konturer/veier. Eget data-layer="strand" (categoryFor) → egen toggle.
  const strandLayers = renderCodes(STRAND_CODES)
  const protectedLayers = renderCodes(PROTECTED_CODES)
  // v8.5.7: Klassisk casing-pattern for veier — render ALLE sorte omriss
  // (casings) først, så ALLE fargefyll (overlays). Det forhindrer at sorte
  // omriss på nabosegmenter ligger oppå fargefyll i kryss ("pølse"-blobsene
  // som vises der mange OSM-veisegmenter møtes). Overlay-passet kjøres i
  // omvendt ROAD_CODES-rekkefølge så større veier renderes sist og dominerer
  // i kryss: motorvei (501) > hovedvei (502) > småvei (503). Jernbane (515)
  // og trail-koder (504-511) beholder dagens enkel-stroke-rendering.
  const roadOverlayCodes = ROAD_CODES.filter(c =>
    c !== '515' && !!getIsomDef(c, isomCatalog, false)?.overlayStroke
  )
  const roadOtherCodes = ROAD_CODES.filter(c => !roadOverlayCodes.includes(c))
  const roadLayers =
    roadOverlayCodes.map(c => layerSvg(c, 'casing')).join('') +
    [...roadOverlayCodes].reverse().map(c => layerSvg(c, 'overlay')).join('') +
    roadOtherCodes.map(c => layerSvg(c)).join('')
  const upperLayers  = renderCodes(UPPER_CODES)
  const placeholderLayers = renderCodes(PLACEHOLDER_CODES)
  // ── Global navn-deduplisering ────────────────────────────────────────
  // Hvert unikt navn rendres som tekst-label kun ÉN gang på hele kartet.
  // OSM splitter lange elver/veier i mange ways, og vi gjentar elve-/bekke-
  // navn ~hver 2 km — uten dedup får f.eks. «Akerselva» titalls labels.
  // Dette kollapser alle til første treff. Bevisst avveining (bekreftet med
  // bruker): to genuint ulike features med samme navn (to «Langvatnet», en
  // vei og et tjern som heter det samme) mister navnet på nr. 2. Tomme navn
  // (høyde-tall, dybde-soundings) berøres ikke.
  //
  // Krav-rekkefølge = evaluerings-rekkefølge under (hvem «vinner» navnet):
  // topp → vann → elv/bekk → område/hytte → stedsnavn-overlay. Viktigst
  // først, så et navngitt tjern ikke stjeler navnet fra toppen over det.
  // v12.1.22: dedupen har fått type- og avstands-unntak — se
  // makeLabelNameClaimer for reglene.
  const claimLabelName = makeLabelNameClaimer()

  const labelLayer = labelSvg()

  const contourBucketPaths = (buckets) =>
    [...buckets.values()].map(b => `<path d="${b.ds.join(' ')}"${bboxAttr(b.bbox, fmt)} />`).join('')
  const contourLayerSvg = (contourMinorBuckets.size || contourIndexBuckets.size)
    ? `  <g data-layer="kontur">\n` +
      `    <g data-iso="101">${contourBucketPaths(contourMinorBuckets)}</g>\n` +
      `    <g data-iso="102">${contourBucketPaths(contourIndexBuckets)}</g>\n` +
      (contourLabels.length
        ? `    <g data-label="kontur-tall">\n${contourLabels.slice(0, 80).map(l =>
            `      <text x="${fmt(l.x)}" y="${fmt(l.y)}" text-anchor="middle">${l.elev}</text>`).join('\n')}\n    </g>\n`
        : '') +
      `  </g>\n`
    : ''

  // Skjult, søkbart lag med ekte topper (lokale høyde-maksima fra DEM). Brukes
  // av «topp»-søket på kart uten OSM-toppmarkører — ikke rendret på kartet (det
  // er kontur-bildet som viser terrenget), kun lest av søkeindeksen.
  const summitLayerSvg = demSummits.length
    ? `  <g data-label="dem-topp" style="display:none">\n${demSummits.map(s => {
        const [px, py] = demProject([s.x, s.y])
        return `    <text x="${fmt(px)}" y="${fmt(py)}">${Math.round(s.ele)}</text>`
      }).join('\n')}\n  </g>\n`
    : ''

  // Font-størrelsen på vann-labels skaleres med kartstørrelse i symbolizer
  // (labelScale = min(3, max(1, widthM/4000))). dy-stablingen mellom navn og
  // høyde-over-havet må følge SAMME skala — ellers vokser teksten på et 10 km-
  // kart (×2.5) mens gapet står stille på 1.9 mm, så høyde-tallet kolliderer
  // med navnet (synlig på 10×10 km, ok på 1×1 og 4×4 der labelScale=1).
  const labelScale = widthM > 0 ? Math.min(3, Math.max(1, widthM / 4000)) : 1
  const lakeLabelLayer = lakeLabels.length
    ? `  <g data-layer="vann">\n${lakeLabels.map(l => {
        const lines = []
        // Når både navn og elev finnes: stack name over senteret, elev under.
        // Når bare ett finnes: plasser sentrert. dy i mm via SVG-attributt så
        // posisjonen er print-skalert (1 mm = 1 mm på papir, uavhengig av
        // viewBox-meter). dy × labelScale så gapet vokser i takt med fonten.
        if (l.name && claimLabelName(l.name, 'vann', l.x, l.y)) {
          const dyMm = (l.elev != null ? -0.4 : 0.4) * labelScale
          lines.push(`    <text x="${fmt(l.x)}" y="${fmt(l.y)}" dy="${fmt(dyMm)}mm" text-anchor="middle" data-label="vann-navn" data-score="${labelScore('vann-navn', { areaM2: l.areaM2 })}">${xmlEscape(l.name)}</text>`)
        }
        if (l.elev != null) {
          const dyMm = (l.name ? 1.5 : 0.4) * labelScale
          lines.push(`    <text x="${fmt(l.x)}" y="${fmt(l.y)}" dy="${fmt(dyMm)}mm" text-anchor="middle" data-label="vann-tall">${l.elev}</text>`)
        }
        return lines.join('\n')
      }).join('\n')}\n  </g>\n`
    : ''

  // Stupkanter males UNDER vann (painter's order, se body) så DTM-artefakter
  // (vannflate-nivå, LiDAR-tile-skjøter) som slår ut som falske stupkanter midt
  // i en innsjø dekkes av vann-fyllet — like meningsløst som en høydekurve
  // gjennom en innsjø. (Rapportert Otersjøen, Lierne.)
  const cliffsLayerSvg = cliffsSvg
    ? `  <g data-layer="stupkant" data-iso="203">\n${cliffsSvg}\n  </g>\n` : ''

  const huleLayerSvg = huleSvg
    ? `  <g data-layer="stein" data-iso="215">\n${huleSvg}\n  </g>\n` : ''
  const gruveLayerSvg = gruveSvg
    ? `  <g data-layer="stein" data-iso="216">\n${gruveSvg}\n  </g>\n` : ''
  const trigLayerSvg = trigSvg
    ? `  <g data-layer="trig" data-iso="113">\n${trigSvg}\n  </g>\n` : ''
  const kirkeLayerSvg = kirkeSvg
    ? `  <g data-layer="kirke" data-iso="532">\n${kirkeSvg}\n  </g>\n` : ''
  const parkeringLayerSvg = parkeringSvg
    ? `  <g data-layer="parkering" data-iso="534">\n${parkeringSvg}\n  </g>\n` : ''
  const holdeplassLayerSvg = holdeplassSvg
    ? `  <g data-layer="holdeplass" data-iso="560">\n${holdeplassSvg}\n  </g>\n` : ''
  const broLayerSvg = broSvg
    ? `  <g data-layer="bro" data-iso="509">\n${broSvg}\n  </g>\n` : ''
  const bomLayerSvg = bomSvg
    ? `  <g data-layer="bom" data-iso="526">\n${bomSvg}\n  </g>\n` : ''
  const marineLayerSvg = marinePointSvg
    ? `  <g data-layer="sjo-poi">\n${marinePointSvg}\n  </g>\n` : ''
  const kulturminneLayerSvg = kulturminneSvg
    ? `  <g data-layer="kulturminne">\n${kulturminneSvg}\n  </g>\n` : ''

  // ── Skjulte detalj-lag (kun synlig i long-press-inset-en) ────────────
  // Dybdepunkt-soundings og dybdekurver ble «for voldsomt» på hovedkartet,
  // så de emitteres med display:none og data-detail="1". Inset-en (MapView)
  // kloner kart-innholdet i et 150×150 m vindu og skrur PÅ data-detail-lag.
  // Soundings: blå dybde-tall på hver node. Dybde rundes til heltall.
  //
  // Grid-tynning («grunneste vinner», gjeninnført fra v7.1.13): Sjøkart-WFS
  // leverer 5000+ soundings i tette havneområder (Trondheim havn) — uten
  // tynning blir både hovedkartets dybde-lag og long-press-lupen vegg-til-
  // vegg med tall. Behold punktet med MINST dybde per celle (grunneste =
  // mest sikkerhetsrelevant for kajakk). To trinn:
  //   • FIN (120 m): alt som emitteres — lupe-tetthet (~8–12 tall i 350 m-
  //     startvisningen) og taket for SVG-bytes.
  //   • GROV (480 m): cellevinnerne vises alltid når dybde-laget er på;
  //     resten merkes data-fine="1" og CSS-gates til .zoom-near på hoved-
  //     kartet (lupen setter .zoom-near selv og viser alt).
  // v7.1.13-filteret (400 m) forsvant da sjøkart-modusen ble revet i
  // v8.9.11 og ble aldri gjeninnført med resten i v8.9.16.
  const DYBDE_GRID_FINE_M = 120
  const DYBDE_GRID_COARSE_M = 480   // 4 fine celler per grov-celle
  const fineGrid = new Map()   // "col,row" → { p, dybde }
  for (const el of soundings) {
    if (el.type !== 'node') continue
    const dybde = Number(el.tags?.dybde)
    if (!Number.isFinite(dybde)) continue
    const p = project(el.lat, el.lon)
    const key = `${Math.floor(p.x / DYBDE_GRID_FINE_M)},${Math.floor(p.y / DYBDE_GRID_FINE_M)}`
    const existing = fineGrid.get(key)
    if (!existing || dybde < existing.dybde) fineGrid.set(key, { p, dybde })
  }
  const coarseWinners = new Set()
  {
    const coarseGrid = new Map()   // "col,row" → { p, dybde }
    for (const s of fineGrid.values()) {
      const key = `${Math.floor(s.p.x / DYBDE_GRID_COARSE_M)},${Math.floor(s.p.y / DYBDE_GRID_COARSE_M)}`
      const existing = coarseGrid.get(key)
      if (!existing || s.dybde < existing.dybde) coarseGrid.set(key, s)
    }
    for (const s of coarseGrid.values()) coarseWinners.add(s)
  }
  if (soundings.length) {
    console.log(`[Sjøkart] Dybdepunkt: ${soundings.length} → ${fineGrid.size} etter grid-tynning (${DYBDE_GRID_FINE_M} m, grunneste vinner; ${coarseWinners.size} grove)`)
  }
  const soundingRows = [...fineGrid.values()].map(s => {
    const label = s.dybde >= 10 ? String(Math.round(s.dybde)) : s.dybde.toFixed(1)
    const fineAttr = coarseWinners.has(s) ? '' : ' data-fine="1"'
    return `    <text x="${fmt(s.p.x)}" y="${fmt(s.p.y)}" text-anchor="middle"${fineAttr} data-label="dybde-tall">${label}</text>`
  })
  const soundingLayerSvg = soundingRows.length
    ? `  <g data-layer="dybdepunkt" data-detail="1" style="display:none">\n${soundingRows.join('\n')}\n  </g>\n`
    : ''
  // Dybdekurver: tynne lys-blå isobath-linjer.
  const dybdekonturRows = dybdekonturer.map(el => {
    const geom = el.type === 'way' ? el.geometry : null
    if (!geom || geom.length < 2) return ''
    const d = pathFromGeometry(geom, false, 1.0)
    return d ? `    <path d="${d}" fill="none" stroke="#6fa8c4" stroke-width="0.1mm"/>` : ''
  }).filter(Boolean)
  const dybdekonturLayerSvg = dybdekonturRows.length
    ? `  <g data-layer="dybdekurve" data-detail="1" style="display:none">\n${dybdekonturRows.join('\n')}\n  </g>\n`
    : ''
  const detailLayerSvg = dybdekonturLayerSvg + soundingLayerSvg

  // ── Stedsnavn for elver og bekker (304/305) ─────────────────────────
  // Gjenta navnet ~hver 2 km langs polylinjen så det er synlig uansett
  // hvilken del av kartet brukeren ser på. For korte bekker (< 1 km) plasseres
  // ett label sentralt slik at tagget-navn alltid blir synlig — turkart-
  // bbox kan være helt nede i 1 km × 1 km, og uten dette ville mange bekker
  // mistet sitt navn på små kart.
  const SEG_REPEAT_M = 2000
  const waterwayLabels = []
  for (const code of ['304', '305']) {
    for (const el of buckets[code] ?? []) {
      const name = (el.tags?.name ?? '').trim()
      if (!name || !el.geometry || el.geometry.length < 2) continue
      const pts = el.geometry.map(g => project(g.lat, g.lon))
      const segLens = []
      let totalLen = 0
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x
        const dy = pts[i].y - pts[i - 1].y
        const segLen = Math.hypot(dx, dy)
        segLens.push(segLen)
        totalLen += segLen
      }
      if (totalLen < 80) continue
      const positions = totalLen < SEG_REPEAT_M
        ? [totalLen / 2]
        : []
      if (positions.length === 0) {
        for (let p = SEG_REPEAT_M / 2; p < totalLen; p += SEG_REPEAT_M) positions.push(p)
      }
      let acc = 0
      let posIdx = 0
      for (let i = 1; i < pts.length && posIdx < positions.length; i++) {
        const segLen = segLens[i - 1]
        const dx = pts[i].x - pts[i - 1].x
        const dy = pts[i].y - pts[i - 1].y
        while (posIdx < positions.length && positions[posIdx] <= acc + segLen) {
          const t = segLen > 0.01 ? (positions[posIdx] - acc) / segLen : 0.5
          const x = pts[i - 1].x + dx * t
          const y = pts[i - 1].y + dy * t
          let deg = Math.atan2(dy, dx) * 180 / Math.PI
          if (deg > 90 || deg < -90) deg += 180
          waterwayLabels.push({ x, y, deg, name, isStream: code === '305' })
          posIdx++
        }
        acc += segLen
      }
    }
  }
  // filter før map: global navn-dedup kollapser de gjentatte ~2 km-labels
  // (og multi-way-elver) til ett label per unikt elv-/bekkenavn. Bevisst UTEN
  // koordinater: samme elvenavn skal alltid kollapse, uansett avstand.
  const waterwayLabelRows = waterwayLabels
    .filter(l => claimLabelName(l.name, 'elv'))
    .map(l =>
      `    <text x="${fmt(l.x)}" y="${fmt(l.y)}" dy="-0.4mm" text-anchor="middle" transform="rotate(${fmt(l.deg)} ${fmt(l.x)} ${fmt(l.y)})" data-label="vann-navn" data-score="${labelScore('vann-navn', { isStream: l.isStream })}">${xmlEscape(l.name)}</text>`
    )
  const waterwayLabelLayer = waterwayLabelRows.length
    ? `  <g data-layer="bekk">\n${waterwayLabelRows.join('\n')}\n  </g>\n`
    : ''

  // ── Veinummer-skilt (v12.0.15) ──────────────────────────────────────
  // Kartverket-stil: E-vei/riksvei (kode 501 motorway/trunk, eller ref på
  // E-form) → grønt skilt med hvit tekst; fylkesvei (numerisk ref på 502/503)
  // → hvit boks med sort kant og sort tekst. `ref`-taggen ligger allerede i
  // Overpass-svaret (out geom beholder alle tags) — den har bare aldri vært
  // lest for veier. Skiltet roteres langs veien (samme flip-til-lesbar som
  // bekke-navnene over) og gjentas maks hver ~1,5 km per unikt nummer,
  // lengste way-kandidater først. Trafikkskiltfargene er inline og temas
  // ikke; tekst-CSS ([data-label="veinummer"]) ligger i symbolizer.js.
  const ROADREF_MIN_SPACING_M = 1500
  const MM_TO_M = 3.7795  // SVG: 1 mm = 3.7795 user units; viewBox-enheten er meter
  const roadRefCandidates = new Map()  // "rank|tekst" → [{x, y, deg, lenM}]
  for (const code of ['501', '502', '503']) {
    for (const el of buckets[code] ?? []) {
      const raw = (el.tags?.ref ?? '').split(';')[0].replace(/\s+/g, '')
      if (!raw || !el.geometry || el.geometry.length < 2) continue
      const eMatch = raw.match(/^[Ee](\d+)$/)
      const numMatch = raw.match(/^(?:[RrFf][Vv])?(\d+)$/)
      let text, rank
      if (eMatch) { text = `E${eMatch[1]}`; rank = 'e' }
      else if (numMatch) { text = numMatch[1]; rank = code === '501' ? 'e' : 'fylke' }
      else continue
      const pts = el.geometry.map(g => project(g.lat, g.lon))
      const segLens = []
      let totalLen = 0
      for (let i = 1; i < pts.length; i++) {
        const segLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
        segLens.push(segLen)
        totalLen += segLen
      }
      if (totalLen < 60) continue
      const target = totalLen / 2
      let acc = 0
      for (let i = 1; i < pts.length; i++) {
        const segLen = segLens[i - 1]
        if (acc + segLen >= target && segLen > 0.01) {
          const t = (target - acc) / segLen
          const dx = pts[i].x - pts[i - 1].x
          const dy = pts[i].y - pts[i - 1].y
          const x = pts[i - 1].x + dx * t
          const y = pts[i - 1].y + dy * t
          let deg = Math.atan2(dy, dx) * 180 / Math.PI
          if (deg > 90 || deg < -90) deg += 180
          const key = `${rank}|${text}`
          if (!roadRefCandidates.has(key)) roadRefCandidates.set(key, [])
          roadRefCandidates.get(key).push({ x, y, deg, lenM: totalLen })
          break
        }
        acc += segLen
      }
    }
  }
  const roadRefRows = []
  const roadRefFontM = 2.8 * labelScale * MM_TO_M
  for (const [key, cands] of roadRefCandidates) {
    const sep = key.indexOf('|')
    const rank = key.slice(0, sep)
    const text = key.slice(sep + 1)
    cands.sort((a, b) => b.lenM - a.lenM)
    const placed = []
    const isE = rank === 'e'
    const h = roadRefFontM * 1.5
    const w = text.length * roadRefFontM * 0.62 + roadRefFontM * 0.9
    const rx = isE ? roadRefFontM * 0.25 : roadRefFontM * 0.1
    const rect = `<rect x="${fmt(-w / 2)}" y="${fmt(-h / 2)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(rx)}" fill="${isE ? '#157a3d' : '#ffffff'}" stroke="${isE ? '#ffffff' : '#161616'}" stroke-width="${fmt(roadRefFontM * (isE ? 0.08 : 0.06))}"/>`
    const txt = `<text data-label="veinummer" data-rank="${rank}" y="${fmt(roadRefFontM * 0.35)}">${xmlEscape(text)}</text>`
    for (const c of cands) {
      if (c.x < 0 || c.x > widthM || c.y < 0 || c.y > heightM) continue
      if (placed.some(p => Math.hypot(p.x - c.x, p.y - c.y) < ROADREF_MIN_SPACING_M)) continue
      placed.push(c)
      roadRefRows.push(`    <g transform="translate(${fmt(c.x)} ${fmt(c.y)}) rotate(${fmt(c.deg)})">${rect}${txt}</g>`)
    }
  }
  const roadRefLayer = roadRefRows.length
    ? `  <g data-layer="veinummer">\n${roadRefRows.join('\n')}\n  </g>\n`
    : ''

  // ── Sjønavn — geografiske navn i/ved sjøen (eget marint lag) ──────────
  // «Vi har ingen navn i sjøen»: bukt/vik/kile (natural=bay), nes/odde
  // (natural=cape), sund (natural=strait), grunne (natural=shoal), rev
  // (natural=reef), halvøy (natural=peninsula), holme/øy (place=islet/island)
  // og navngitte skjær (seamark:type=rock). Etikett-ankret er node-punktet,
  // way-sentroiden eller relasjonens største outer-ring-sentroid. Bruker
  // samme blå/italic vann-navn-stil (themed), men ligger i et eget
  // data-layer="sjo-navn" så det kan toggles fra «Sjø & padling»-seksjonen
  // (default PÅ). claimLabelName kjører ETTER innsjø-/elv-navn så en bukt som
  // allerede er navngitt via 303-flate-etiketten ikke dupliseres.
  const seaNames = []
  for (const el of elements) {
    const name = (el.tags?.name ?? '').trim()
    if (!name || !isMaritimeNameFeature(el.tags)) continue
    let p = null
    if (el.type === 'node') {
      p = project(el.lat, el.lon)
    } else if (el.type === 'way' && el.geometry) {
      if (el.geometry.length >= 3) p = polygonCentroid(el.geometry)
      else if (el.geometry.length === 2) {
        const a = project(el.geometry[0].lat, el.geometry[0].lon)
        const b = project(el.geometry[1].lat, el.geometry[1].lon)
        p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      }
    } else if (el.type === 'relation' && el.members) {
      const outerRings = assembleRelationRings(el.members, 'outer')
      let largest = null, largestArea = 0
      for (const ring of outerRings) {
        const projected = ring.map(g => { const q = project(g.lat, g.lon); return [q.x, q.y] })
        const ac = ringAreaCentroid(projected)
        if (ac && ac.areaM2 > largestArea) { largest = ac; largestArea = ac.areaM2 }
      }
      if (largest) p = { x: largest.x, y: largest.y }
    }
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    seaNames.push({ x: p.x, y: p.y, name })
  }
  const seaNameRows = seaNames
    .filter(l => claimLabelName(l.name, 'vann', l.x, l.y))
    .map(l =>
      `    <text x="${fmt(l.x)}" y="${fmt(l.y)}" text-anchor="middle" data-label="vann-navn">${xmlEscape(l.name)}</text>`
    )
  const seaNamesLayer = `  <g data-layer="sjo-navn">${seaNameRows.length ? `\n${seaNameRows.join('\n')}\n  ` : ''}</g>\n`

  // v8.10.9: Områdenavn — hytter med navn (offset til høyre for symbolet)
  // og navngitte arealer (myr, heath, grassland, locality-polygoner osv).
  // Toggle-bar via 'navn'-laget i MapView (default på).
  // filter før map: global navn-dedup (hytter/naturreservat/områder).
  const omradenavnRows = omradenavnLabels.filter(l => claimLabelName(l.name, 'omrade', l.x, l.y))
  const omradenavnLayer = omradenavnRows.length
    ? `  <g data-layer="navn">\n${omradenavnRows.map(l => {
        if (l.isBuilding) {
          // Hytte-navn: 1.2 mm til høyre for symbolet, vertikalt midt-ish
          return `    <text x="${fmt(l.x)}" y="${fmt(l.y)}" dx="1.2mm" dy="0.4mm" text-anchor="start" data-label="hytte-navn" data-score="${labelScore('hytte-navn')}">${xmlEscape(l.name)}</text>`
        }
        // Naturreservat-navn: grønn skrift + hvit halo, samme visuelle vekt
        // som blå vann-navn — markerer vernet område tydelig på kartet.
        if (l.isNatRes) {
          return `    <text x="${fmt(l.x)}" y="${fmt(l.y)}" text-anchor="middle" data-label="naturreservat-navn" data-score="${labelScore('naturreservat-navn', { isNatRes: true })}">${xmlEscape(l.name)}</text>`
        }
        return `    <text x="${fmt(l.x)}" y="${fmt(l.y)}" text-anchor="middle" data-label="omrade-navn" data-score="${labelScore('omrade-navn', { areaM2: l.areaM2 })}">${xmlEscape(l.name)}</text>`
      }).join('\n')}\n  </g>\n`
    : ''

  // Stedsnavn-overlay bygges SIST så de andre (topp/vann/elv/område) får
  // claime navnene sine først — overlayet supplerer med navn som ikke
  // allerede vises på kartet.
  const stedsnavnLayer = stedsnavnSvg()

  // ISOM 522 — tett bebyggelse. Y-flippet siden urbanMass-ringene er i
  // SVG-koordinatsystem (project() returnerer y-flippet). Plasseres mellom
  // vegetasjon og vann i z-order så vann/konturer forblir lesbare over
  // bymassen i tett bebygde områder.
  //
  // v9.1.31: ISOM 522 har eget lag data-layer="bymasse" («Tett bebyggelse»)
  // adskilt fra 521 data-layer="bygning" («Hus og hytter»).
  // v12.0.15: flaten er nå flat dempet grå-beige (ikke mønster) og PÅ som
  // default; buildIsomCss demper den ekstra ved utzoom (opacity 0.55).
  const urbanMassPath = urbanMassMultiPoly.length
    ? multiPolyToPath(urbanMassMultiPoly, fmt)
    : ''
  const urbanMassLayerSvg = urbanMassPath
    ? `  <g data-layer="bymasse" data-iso="522"><path d="${urbanMassPath}" fill-rule="evenodd"/></g>\n`
    : ''

  const bgFill = isomCatalog.background.color

  // v9.1.10 — Lazy defs/CSS: bygg kart-kroppen først, så skanner vi den for
  // hvilke ISOM-koder/patterns/symboler som FAKTISK forekommer, og emitterer
  // kun defs + CSS for de refererte. Sparer konstant ~7-10 KB og ~20-30
  // defs-noder pr kart (mer i % på sparsomme kart), null visuell endring.
  // Trygt ved konstruksjon: en def beholdes kun hvis id-token-en bokstavelig
  // finnes i kilden (CSS for patterns, body for symboler).
  // Painter's order (v9.3.34): terreng-detalj (vegetasjon → øy-overlay →
  // konturer → knauser → stupkanter) males FØRST, deretter det OPAKE vann-
  // fyllet (demSea + vann) OPPÅ. Vann-fyllet dekker dermed alt terreng som
  // strekker seg ut over vann — ingen <mask> trengs. Øy-overlay (001, opak krem)
  // ligger UNDER konturene så øyer beholder høydekurvene sine; vann ligger over
  // begge så feilplassert terreng/vann-overlapp dekkes. Planimetri som hører
  // til OVER vann (vann-labels, verneområde, veier/broer, bygg, marine-POI,
  // tekst) males etter vannet, som før.
  const body = `${groundLayers}${urbanMassLayerSvg}${landOverlayLayers}${strandLayers}${contourLayerSvg}${summitLayerSvg}${knauserLayerSvg}${cliffsLayerSvg}${demSeaLayerSvg}${waterLayers}${lakeLabelLayer}${waterwayLabelLayer}${protectedLayers}${roadLayers}${broLayerSvg}${bomLayerSvg}${upperLayers}${huleLayerSvg}${gruveLayerSvg}${trigLayerSvg}${kirkeLayerSvg}${parkeringLayerSvg}${holdeplassLayerSvg}${marineLayerSvg}${kulturminneLayerSvg}${detailLayerSvg}${placeholderLayers}${roadRefLayer}${labelLayer}${seaNamesLayer}${omradenavnLayer}${stedsnavnLayer}`

  const usedCodes = new Set()
  for (const m of body.matchAll(/data-iso="([^"]+)"/g)) usedCodes.add(m[1])

  const isomCss = buildIsomCss(isomCatalog, patternIds, { widthM, usedCodes })

  // Patterns refereres fra CSS (url(#iso-pat-X)) og evt inline; symboler fra
  // body (href="#iso-sym-X"). Behold kun defs med token til stede i kilden.
  const refSrc = isomCss + body
  const isomDefs =
    [...patternDefs].filter(([name]) => refSrc.includes(`#iso-pat-${name})`)).map(([, d]) => d).join('') +
    [...symbolDefs].filter(([name]) => body.includes(`#iso-sym-${name}"`)).map(([, d]) => d).join('')

  // NB: --bg settes IKKE inline på <svg>-roten. En inline custom property her
  // ville shadowe en arvet --bg fra en forelder, så MapViews tema-bytte (som
  // setter --bg på den felles 3×3-transform-wrapperen) ikke nådde periferi-
  // flisene — bare midt-flisen rekolorerte (v10.1.x «crazy map»). Bakgrunns-
  // rektangelet bruker fill="${bgFill}" som presentasjons-attributt (lys default
  // for frittstående/print/Tegnforklaring), mens CSS-regelen
  // `#bakgrunn rect { fill: var(--bg, default) }` lar en arvet --bg overstyre.
  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" class="isom-map" viewBox="${viewBox}" ${printAttrs} data-meta='${JSON.stringify(meta).replace(/'/g, '&apos;').replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}'>
  <defs>${isomDefs}</defs>
  <style>${isomCss}</style>
  <g id="bakgrunn"><rect width="${fmt(widthM)}" height="${fmt(heightM)}" fill="${bgFill}"/></g>
${body}</svg>
`

  // v12.0.17: strip innrykk (behold én newline per element for diffbarhet) —
  // pretty-print-whitespacet shipppet verbatim i hver lagrede/eksporterte SVG.
  // Trygt: rewriter kun whitespace rett før '<'; tekst-innhold emitteres på én
  // linje og alle streng-konsumenter (regexer, DOMParser, defs-pruning) er
  // whitespace-agnostiske. options.pretty === true beholder innrykk for debug.
  if (options.pretty !== true) {
    svg = svg.replace(/\n[ ]+</g, '\n<')
  }

  return { svg, counts, meta, timings }
}

// Global navn-dedup for kart-labels (v12.1.22 — var ren «ett navn = én label»).
// Norske navnetvillinger er vanlige og EKTE: gården og fjellet, fjellet og
// dalføret, øya og fjellet, fjellmassivet og bygda deler ofte navn. Regler:
//  - Samme navn på ULIK label-type (kind): alltid tillatt — to features som
//    deler navn er ikke en duplikat-label.
//  - Samme navn på SAMME type: tillatt kun når punktene ligger ≥1 km fra alle
//    tidligere forekomster (to åser som deler navn). Uten koordinater dedupes
//    samme type alltid — elv-/bekkelabels bruker dette bevisst, så de
//    gjentatte ~2 km-labelene langs samme elv fortsatt kollapser til én.
// Kinds i bruk: 'topp', 'vann' (innsjø + sjø/bukt), 'elv', 'omrade'
// (hytte/naturreservat/areal), 'sted' (stedsnavn-overlay).
export const LABEL_NAME_MIN_SEP_M = 1000
export function makeLabelNameClaimer({ minSepM = LABEL_NAME_MIN_SEP_M } = {}) {
  const claims = new Map()   // navn (lowercase) → [{ kind, x, y }]
  return (raw, kind = '', x = null, y = null) => {
    const key = (raw ?? '').trim().toLowerCase()
    if (!key) return true                  // navnløst (kun symbol/tall) — alltid ok
    const prev = claims.get(key)
    if (!prev) { claims.set(key, [{ kind, x, y }]); return true }
    const blocked = prev.some((p) => {
      if (p.kind !== kind) return false
      const farEnough = [p.x, p.y, x, y].every(Number.isFinite) &&
        Math.hypot(x - p.x, y - p.y) >= minSepM
      return !farEnough
    })
    if (!blocked) prev.push({ kind, x, y })
    return !blocked
  }
}

// Rangér et OSM place=* sted etter viktighet for label-LOD og skrift-størrelse.
// major beholdes ved utzoom; mid/minor skjules til man zoomer inn.
function placeRank(place) {
  switch (place) {
    case 'city': case 'town':                                  return 'major'
    case 'village': case 'suburb':                             return 'mid'
    default:                                                    return 'minor'
  }
}

// Viktighets-score 0–100 for tetthets-budsjettet (data-score på hver label).
// = klassevekt + egenverdi. Klasse-rekkefølge (CD-handoff): topp > stor innsjø >
// grend > seter/gård/punkt > hytte; vann/område/verneområde er prioritetsklasser.
// Egenverdi: topp-høyde, innsjø-areal, område-areal/verne-status. Deterministisk;
// runtime utleder minZoom fra denne. Klasse-ordering er stabilt designvalg → trygt
// å bake i SVG. Returnerer heltall (mindre data-score-streng).
export function labelScore(kind, { rank, ele, areaM2, isStream, isNatRes } = {}) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  let base = 30, extra = 0
  switch (kind) {
    case 'peak':
      base = 60
      if (Number.isFinite(ele)) extra = clamp(ele / 30, 0, 35)   // 1050 m → +35
      break
    case 'vann-navn':
      if (isStream === true) { base = 35 }            // bekk (305)
      else if (isStream === false) { base = 48 }      // elv (304)
      else {                                          // innsjø
        base = 55
        if (Number.isFinite(areaM2) && areaM2 > 0) {
          extra = clamp((Math.log10(areaM2) - 3) * 13, 0, 40)    // 1e3→0, 1e6→40
        }
      }
      break
    case 'omrade-navn':
      base = 50
      if (Number.isFinite(areaM2) && areaM2 > 0) extra = clamp((Math.log10(areaM2) - 4) * 8, 0, 20)
      break
    case 'naturreservat-navn':
      base = isNatRes ? 58 : 50
      break
    case 'stedsnavn':
      base = rank === 'major' ? 70 : rank === 'mid' ? 55 : 35
      break
    case 'hytte-navn':
      base = 20
      break
    default:
      base = 30
  }
  return Math.round(clamp(base + extra, 0, 100))
}

function categoryFor(code) {
  // Mapping fra ISOM-kode til UI-kategori (for lag-toggling i MapView).
  // Flere koder kan ende i samme kategori (skog samler 406-409 osv).
  switch (code) {
    case '001':                                  return 'land'
    case '401': case '403':                     return 'aapen'
    case '404':                                  return 'aker'
    case '406': case '407': case '408': case '409': return 'skog'
    case '308': case '309':                     return 'myr'
    case '301': case '302': case '303': case '307': return 'vann'
    case '304': case '305':                     return 'bekk'
    case '520':                                  return 'naturreservat'
    case '521':                                  return 'bygning'
    case '522':                                  return 'bymasse'
    case '501': case '502':                     return 'vei-stor'
    case '503': case '504':                     return 'vei-liten'
    case '505': case '506': case '507':         return 'sti'
    case '510':                                  return 'lysloype'
    case '511':                                  return 'heistrase'
    case '512':                                  return 'slalombakke'
    case '513':                                  return 'idrettsanlegg'
    case '515':                                  return 'tog'
    case '201': case '203':                     return 'stupkant'
    case '210': case '213':
    case '215': case '216':                          return 'stein'
    case '525': case '528':                     return 'linje'
    case '113':                                  return 'trig'
    case '509':                                  return 'bro'
    case '526':                                  return 'bom'
    case '534':                                  return 'parkering'
    case '560':                                  return 'holdeplass'
    case '551':                                  return 'kai'
    case '552':                                  return 'sjo-poi'
    case '556':                                  return 'strand'
    case '101': case '102': case '103': case '104': return 'kontur'
    default:                                     return 'other'
  }
}
