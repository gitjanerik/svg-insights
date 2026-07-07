// createMapFlow.js — gjenbrukbar bygging av et nytt turkart fra ett senter-punkt.
//
// Pipeline-en speiler MapPickerView.generateMap() men er parametrisert slik at
// både picker-vyen og «lag kart der jeg er»-snarveiene (MapHomeView FAB,
// MapView FAB) kan kalle den med samme garanti for resultat. Endringer i
// hvordan kartet bygges skal komme her, ikke i view-en.
//
// Bruks-eksempel:
//   const { id } = await buildMapFromCenter({
//     center: { lat, lon, name: 'Min posisjon' },
//     halfKm: 2,
//     equidistanceM: 20,
//     navn: 'Min tur',
//     onProgress: (msg) => statusText.value = msg,
//   })
//   router.push({ name: 'kart-vis', params: { id } })

import { fetchOverpass, probeCoastline, bboxFromCenter, viewportAspect } from './mapBuilder.js'
import { buildSvgClient } from './buildSvgClient.js'
import { fetchN50Water } from './n50Fetcher.js'
import { fetchNveLakePolygons } from './nveLakeFetcher.js'
import { fetchKulturminner } from './kulturminneFetcher.js'
import { fetchSjokart, sjokartToElements, sjokartTimeoutForBbox, summarizeSjokartStatus } from './sjokartFetcher.js'
import { isOsmWaterSalty, isFlowingWaterArea } from './symbolizer.js'
import { pointInRing } from './marineTopology.js'
import { fetchDEM } from './demFetcher.js'
import { fillDemVoidsFromTerrarium } from './terrariumDem.js'
import { findHighestPoint, packDem } from './demSampling.js'
import { utm32ToWgs84, utm32BboxFromWgs84 } from './utm.js'
import { saveMap, generateMapId } from './mapStorage.js'
import { snapUtmBboxToGrid, fetchDEMWithCache } from './demTileCache.js'
import { logPerf } from './perfLog.js'
import { cacheGet, cacheSet, TTL, kulturminneBboxKey } from './protectedAreaCache.js'

// DEM-flis-cache. Når PÅ snappes kart-bbox til res-rutenettet og DEM hentes
// flis-vis med gjenbruk mellom overlappende kart; AV = byte-identisk med før
// (rett fetchDEM, ingen snapping). PÅ for verifisering på ekte enhet — den
// robuste fallback-en i fetchDEMWithCache gjør at verste fall degraderer til
// dagens oppførsel (én full fetch). Følg med på at høydekurver flukter med
// stier/vann (ingen forskyvning) på nabo-kart.
const DEM_TILE_CACHE_ENABLED = true

// Areal-vektet sentroid (lon/lat) for en ring av {lat,lon}- eller [lon,lat]-
// punkter. Faller til punkt-gjennomsnitt for degenererte ringer.
function ringCentroidLonLat(pts) {
  if (!Array.isArray(pts) || pts.length === 0) return null
  const lon = (p) => (p.lon ?? p[0]); const lat = (p) => (p.lat ?? p[1])
  const n = pts.length
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < n; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n]
    const x1 = lon(p1), y1 = lat(p1), x2 = lon(p2), y2 = lat(p2)
    const cross = x1 * y2 - x2 * y1
    a += cross; cx += (x1 + x2) * cross; cy += (y1 + y2) * cross
  }
  if (a !== 0 && Number.isFinite(cx)) return [cx / (3 * a), cy / (3 * a)]
  let sx = 0, sy = 0, c = 0
  for (const p of pts) { sx += lon(p); sy += lat(p); c++ }
  return c ? [sx / c, sy / c] : null
}

// Representativt indre punkt [lon,lat] for et OSM-vann-element (way eller
// multipolygon-relation). Brukes til å teste om NVE faktisk dekker flata.
function elementRepPoint(el) {
  if (Array.isArray(el?.geometry) && el.geometry.length) {
    return ringCentroidLonLat(el.geometry)
  }
  if (Array.isArray(el?.members)) {
    let best = null
    for (const m of el.members) {
      if ((m.role === 'outer' || !m.role) && Array.isArray(m.geometry) && m.geometry.length >= 3) {
        if (!best || m.geometry.length > best.length) best = m.geometry
      }
    }
    if (best) return ringCentroidLonLat(best)
  }
  return null
}

// Per-element OSM-vann-filter. De autoritative norske kildene (N50 vann, NVE
// innsjø-flater, Sjøkart) er foretrukket der de finnes, men de dekker bare
// deler av vann-stacken: N50/NVE leverer STILLESTÅENDE ferskvann (innsjøer/
// magasin) og N50 i tillegg sjø — ingen av dem leverer ELVELØP. Derfor:
//   • Saltvann → behold kun hvis N50 ikke har sjø (ellers er N50 autoritativ).
//   • Elve-/kanal-/bekke-FLATER (isFlowingWaterArea) → behold ALLTID. Dette er
//     regresjons-vakten: uten den droppes brede elver (Drammenselva, tagget
//     natural=water+water=river) så snart NVE/N50 returnerer ferskvann, og det
//     som står igjen er bare den hårtynne waterway=river-senterlinja (304).
//   • Innsjø-flate → undertrykk KUN der NVE faktisk har en innsjø som dekker
//     flata (sentroiden ligger i en NVE-innsjø-ring). NVEs `identify`-respons
//     er ofte UFULLSTENDIG (ArcGIS-record-cap returnerer bare de første N
//     flatene i bbox-en), så en blanket «NVE finnes → dropp ALT OSM-ferskvann»
//     slettet innsjøer NVE ikke returnerte (Ulvenvatnet i Dikemark forsvant
//     helt). Per-flate-dekning gjør NVE autoritativ DER den har data og lar OSM
//     fylle hullene. Mistaggede flom-innsjøer (Røssvatnet) dekkes fortsatt av
//     sin NVE-innsjø → undertrykt som før.
//   • Bekke-/grøfte-LINJER → undertrykk kun når N50 har ferskvann.
// I nettleseren feiler WFS-kildene ofte (CORS) → ingen NVE-ringer / alle flagg
// false → alt OSM-vann beholdes uendret.
export function filterOsmWaterElements(elements, flags = {}) {
  const { n50HasSea = false, n50HasFreshwater = false, nveLakeRings = null } = flags
  const rings = Array.isArray(nveLakeRings) ? nveLakeRings : null
  const coveredByNve = (el) => {
    if (!rings || rings.length === 0) return false
    const p = elementRepPoint(el)
    if (!p) return false
    for (const ring of rings) if (pointInRing(p[0], p[1], ring)) return true
    return false
  }
  return (elements ?? []).filter(el => {
    const tags = el.tags ?? {}
    const isWaterPolygon = tags.natural === 'water' || !!tags.water ||
                           tags.natural === 'bay' || tags.natural === 'strait' ||
                           tags.place === 'sea' || tags.place === 'ocean'
    if (isWaterPolygon) {
      if (isOsmWaterSalty(tags)) return !n50HasSea
      // Elveløp som flate — verken NVE eller N50 har den, så aldri undertrykk.
      if (isFlowingWaterArea(tags)) return true
      // Ferskvanns-polygon: NVE er autoritativ KUN der den faktisk har innsjøen.
      if (coveredByNve(el)) return false
      if (tags.name) return true
      return !n50HasFreshwater
    }
    if (tags.waterway === 'stream' || tags.waterway === 'ditch') {
      return !n50HasFreshwater
    }
    return true
  })
}

// Terreng-først «finalize»-register: når et kart bygges terreng-først lagres
// konturer+relieff straks, og den fulle byggingen (Overpass + OSM) fortsetter
// som en promise her, nøklet på kart-id. MapView konsumerer den og re-render-er
// når full SVG er klar. Lever på modul-nivå så den overlever navigasjonen til
// den nye kart-visningen (samme JS-kontekst).
const mapFinalizers = new Map()
export function consumeMapFinalize(id) {
  const p = mapFinalizers.get(id)
  if (p) mapFinalizers.delete(id)
  return p ?? null
}

const EMPTY_SJOKART = {
  dybdeareal: [], dybdekontur: [], grunne: [], lanterne: [], dybdepunkt: [],
}

// Kyst-kart oppgraderes til denne DEM-oppløsningen (m) i et andre fetch-trinn,
// så smale sund (Nesøybrua etc.) oppløses i sjø-masken. Se buildMapFromCenter.
const COASTAL_DEM_RES_M = 5

// Mellomtrinn: kystkart som er for store for 5 m oppgraderes til 10 m i stedet
// for å bli stående på 20 m-proben — kystlinjen rundt sund/øyer blir ellers
// grov (Grønnsund-regresjonen).
const COASTAL_DEM_MID_RES_M = 10

// Celletak for kyst-DEM-oppgraderingen. Tidligere gates det på BREDDE alene
// (≤8 km → 5 m, ≤12 km → 10 m), men høyden strekkes med skjerm-aspektet
// (opptil 2,2) — et 8 km-portrettkart kunne dermed koste 5,6M celler @ 5 m.
// Taket regner på faktisk widthM×heightM: 8×8 km @ 5 m ≈ 2,56M (innenfor).
const COASTAL_MAX_CELLS = 2.6e6

/**
 * Velg mål-oppløsning for kyst-DEM-oppgraderingen ut fra kartets faktiske
 * UTM-areal: fineste trinn (5 m, så 10 m) som holder seg under celletaket,
 * ellers null (behold probe-oppløsningen).
 */
export function coastalTargetResFor(utmBbox, maxCells = COASTAL_MAX_CELLS) {
  if (!utmBbox) return null
  const areaM2 = (utmBbox.maxE - utmBbox.minE) * (utmBbox.maxN - utmBbox.minN)
  if (!(areaM2 > 0)) return null
  for (const res of [COASTAL_DEM_RES_M, COASTAL_DEM_MID_RES_M]) {
    if (areaM2 / (res * res) <= maxCells) return res
  }
  return null
}

function hasNearSeaLevelPixels(dem) {
  if (!dem?.data) return false
  const { data, noData } = dem
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (v === noData || !Number.isFinite(v)) continue
    if (v <= 0.5) return true
  }
  return false
}

// Finnes det ekte SALTVANN i OSM-dataene? NHM_DTM kan ikke skille sjø fra en
// innlands-vannflate (begge leser ~0 m), så «havflate-piksler» alene er ikke
// nok til å kalle et kart kystnært. Store innsjøer (Mjøsa ~123 m, Tyrifjorden
// ~63 m) leser ~0 m i DEM-en og trigget tidligere både 5 m-DEM-oppgraderingen
// og Sjøkart-WFS som om de var kyst. Kystlinjen (natural=coastline) er
// fullstendig kartlagt langs hele Norges-kysten i OSM og er det definitive
// sjø-signalet; saltvanns-tagger (place=sea, water=sea, salt=yes, bay/strait)
// fanger fjorder/bukter uten egen kystlinje-way i bbox-en.
function osmHasSaltwater(elements) {
  for (const el of elements ?? []) {
    const t = el?.tags
    if (!t) continue
    if (t.natural === 'coastline') return true
    if (isOsmWaterSalty(t)) return true
  }
  return false
}

function withHardTimeout(promise, ms, fallback, label) {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      console.warn(`[${label}] timeout etter ${ms}ms — bruker fallback`)
      resolve(fallback)
    }, ms)
    promise.then(
      (v) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        console.warn(`[${label}] feilet: ${e?.message ?? e} — bruker fallback`)
        resolve(fallback)
      }
    )
  })
}

/**
 * Bygg, lagre og returnér en kart-entry. Kaster ved feil.
 *
 * @param {object} opts
 * @param {{lat:number, lon:number, name?:string}} opts.center
 * @param {number} opts.halfKm  — halv-bredde i km (E/V). Kart blir 2*halfKm bredt,
 *   og 2*halfKm*aspect høyt (N/S strekkes til skjerm-formatet, se aspect)
 * @param {number} [opts.aspect]  — høyde/bredde-forhold (default: viewportAspect()
 *   så kartet fyller portrett-skjermen). aspect=1 ⇒ kvadrat (gammel oppførsel)
 * @param {number} opts.equidistanceM  — kontur-intervall
 * @param {string} opts.navn  — kartets navn
 * @param {(msg:string)=>void} [opts.onProgress]  — status-callback for UI
 */
export async function buildMapFromCenter({
  center,
  halfKm,
  aspect,
  equidistanceM,
  navn,
  onProgress = () => {},
  signal,
  terrainFirst = false,
  isAuto = false,
  utmBbox: explicitUtmBbox = null,
}) {
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Avbrutt', 'AbortError')
  }
  // Lett perf-instrumentering: timer fetch-trinn + buildSvg og logger én linje.
  const _now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const _t0 = _now()
  const marks = {}
  const timeAsync = (label, p) => {
    const s = _now()
    return p.then(
      v => { marks[label] = Math.round(_now() - s); return v },
      e => { marks[label] = Math.round(_now() - s); throw e },
    )
  }
  // Aspekt (høyde/bredde): følger skjerm-formatet så kartet fyller MapView i
  // fullskjerm uten cream-letterbox over/under. Kalleren kan overstyre (f.eks.
  // picker-previewen sender samme aspekt den viser). aspect=1 ⇒ kvadrat.
  const mapAspect = aspect ?? viewportAspect()
  let bbox = bboxFromCenter(center.lat, center.lon, halfKm, mapAspect)
  const widthKm = (halfKm * 2).toFixed(1)
  const heightKm = (halfKm * 2 * mapAspect).toFixed(1)
  onProgress(`Henter kartdata for ${widthKm} × ${heightKm} km …`)

  // DEM-oppløsning (probe). 10 m ved fine konturer (≤ 5 m ekvidistanse),
  // ellers 20 m. Beregnes her oppe fordi flis-cachen snapper bbox til dette
  // rutenettet (multiplum av 5/10/20 → også 5 m-justert for kyst-oppgraderingen).
  const resolutionM = equidistanceM <= 5 ? 10 : 20

  // Recompute WGS84-bbox fra ALLE fire UTM-hjørner (ikke bare SW+NE) så Overpass
  // dekker hele det rektangulære utsnittet — med bare diagonalen ble hjørnene
  // under-dekket og OSM-data manglet i kart-kantene.
  const wgs84FromUtmCorners = (ub) => {
    const cs = [
      utm32ToWgs84(ub.minE, ub.minN), utm32ToWgs84(ub.maxE, ub.minN),
      utm32ToWgs84(ub.minE, ub.maxN), utm32ToWgs84(ub.maxE, ub.maxN),
    ]
    return {
      south: Math.min(...cs.map(c => c.lat)), north: Math.max(...cs.map(c => c.lat)),
      west: Math.min(...cs.map(c => c.lon)), east: Math.max(...cs.map(c => c.lon)),
    }
  }

  // Beregn UTM-bbox tidlig så fetchDEM kan startes parallelt med Overpass/N50.
  let utmBbox
  if (explicitUtmBbox) {
    // Kalleren ga en autoritativ, allerede rutenett-snappet UTM-extent (kant-sone-
    // utvidelse: nabo-flis utledet med eksakt ±W/±H-offset fra aktiv flis, så
    // den deler aktiv-gitteret bit-eksakt → ingen søm/glipe). Bruk den direkte,
    // IKKE re-snap (no-op på en on-grid bboks, men unngår fremtidig drift). WGS84-
    // bboksen utledes fortsatt fra de fire hjørnene så fetch-laget dekker samme extent.
    utmBbox = explicitUtmBbox
    bbox = wgs84FromUtmCorners(utmBbox)
  } else {
    // Fire-hjørners UTM-extent (utm32BboxFromWgs84) så kartet blir kvadratisk for
    // en kvadratisk bbox — SW+NE-diagonalen alene undervurderte øst-vest og ga
    // portrett-kart vekk fra sentralmeridianen. Sendes uendret videre til buildSvg.
    utmBbox = utm32BboxFromWgs84(bbox)
    // Flis-cache PÅ: snap bbox til res-rutenettet så kart-grid og flis-grid
    // flukter eksakt (ingen resampling). Recompute WGS84-bbox fra de snappede
    // hjørnene så Overpass/buildSvg bruker SAMME extent som DEM-en.
    if (DEM_TILE_CACHE_ENABLED) {
      utmBbox = snapUtmBboxToGrid(utmBbox, resolutionM)
      bbox = wgs84FromUtmCorners(utmBbox)
    }
  }

  // DEM-henting: via flis-cache (gjenbruk overlappende fliser) når PÅ, ellers
  // rett fetchDEM. Begge returnerer en DEM for samme (evt. snappede) extent.
  const fetchDemFor = (res) => DEM_TILE_CACHE_ENABLED
    ? fetchDEMWithCache(utmBbox, { resolutionM: res, signal })
    : fetchDEM(bbox, utmBbox, { resolutionM: res, useReal: true, signal })

  // Vann-strategi:
  //   - SJØ: DEM (Kartverket NHM_DTM_25832). 0 m elevasjon = sjø.
  //   - INNSJØ: N50 Innsjø + OSM natural=water.
  //   - SJØKART: kun kjørt når DEM viser at bbox faktisk har piksler nær
  //     havflaten (≤ 0.5 m). For innlands-bbox er Sjøkart-WFS overflødig
  //     og kostet 2-10 s ekstra per kart-bygg. v8.10.18: gating fra DEM
  //     droppe Sjøkart-fetch helt når den ikke gir verdi.
  //
  // Perf-strategi:
  //   - Overpass, N50 og DEM kjøres parallelt fra start.
  //   - Sjøkart kjøres parallelt så snart DEM-resultatet bekrefter kyst-bbox;
  //     hard 8s timeout så et hengende Geonorge-endpoint aldri blokkerer kartet.
  // DEM-oppløsning — to-trinns ved kyst:
  //   Trinn 1 (probe): 20 m som default, 10 m når brukeren har valgt fine
  //     konturer (≤ 5 m ekvidistanse). Billig (4×4 km ≈ 40k celler), og gir
  //     oss det eksakte kyst-signalet via hasNearSeaLevelPixels (piksler
  //     ≤ 0.5 m = havflate — samme test som gater Sjøkart).
  //   Trinn 2 (oppgradering): er bbox-en kystnær, hentes DEM på nytt finere
  //     (5 m ≤ 8 km, 10 m ≤ 12 km — se coastalTargetResM-trappa under).
  //     Smale sund (f.eks. Nesøybrua, ~30-40 m) oppløses ikke ved 20/10 m —
  //     DEM-0.5m-masken klemmer halsen igjen og en øy blir til halvøy. 5 m
  //     åpner sundet. Kostnaden (16× piksler vs 20 m) betales KUN ved kysten;
  //     innlands-kart henter bare probe-DEM-et og er byte-identiske med før.
  //     Trygg degradering: feiler 5 m-hentingen (eller faller til syntetisk),
  //     beholder vi probe-DEM-et — kartet blir aldri verre enn før.
  // Konturer rendres fortsatt fint takket være Chaikin-glatting, og antall
  // høydekurver styres av ekvidistansen (uendret) — 5 m gir bare mer presise
  // vektorer, ikke flere kurver.
  // Oppgraderingen gates på faktisk celleantall (bredde × høyde / res²) i
  // tillegg til kyst — se coastalTargetResFor. Fineste trinn under taket vinner.
  const sizeKmTotal = halfKm * 2
  const coastalTargetResM = coastalTargetResFor(utmBbox)
  const canUpgradeToFineDem = coastalTargetResM != null &&
                              resolutionM > coastalTargetResM
  onProgress(`Henter høydedata (${resolutionM} m) og kartdata …`)
  const probeDemPromise = fetchDemFor(resolutionM)

  // Overpass + N50 fyres parallelt med DEM (delt mellom terreng- og full-bygg)
  // så OSM-hentingen (flaskehalsen) starter samtidig med DEM. Deklarert FØR
  // kyst-deteksjonen siden den trenger OSM-saltvanns-signalet.
  const overpassP = timeAsync('overpass', fetchOverpass(bbox, { signal, onProgress }))
  const n50P = timeAsync('n50', fetchN50Water(bbox).catch(e => {
    console.warn('N50-vann ikke tilgjengelig:', e.message)
    return []
  }))
  // NVE innsjø-flater: CORS-pålitelig autoritativ innlands-vannkilde. Brukes
  // når N50-WFS svikter klient-side (vanlig på mobil) — uten den faller vi
  // tilbake til rå OSM-vann som flommer ut over land på store norske innsjøer
  // (Røssvatnet, Namsvatnet osv.). Feiler aldri hardt → [].
  const nveLakesP = timeAsync('nve', fetchNveLakePolygons(bbox, { signal }).catch(e => {
    console.warn('NVE-innsjø ikke tilgjengelig:', e?.message ?? e)
    return []
  }))
  // Kulturminner (Kulturminnesøk brukerminner) — klikkbare tema-ikoner. Hentes
  // alltid ved bygging (default-AV lag i MapView → skjult til brukeren slår det
  // på, uten ombygging). Cachet pr kvantisert bbox (30 d). Feiler aldri hardt → [].
  const kulturminneP = timeAsync('kulturminne', (async () => {
    const key = kulturminneBboxKey(bbox)
    const cached = await cacheGet(key)
    if (Array.isArray(cached)) return cached
    const data = await fetchKulturminner(bbox, { signal }).catch(() => [])
    if (data.length) cacheSet(key, data, TTL.kulturminne)
    return data
  })())

  // ── Kyst-deteksjon: DEM-havflate OG ekte saltvann i OSM ───────────────
  // DEM-en alene kan ikke skille sjø fra en innlands-vannflate (begge ~0 m).
  // Vi krever derfor BÅDE havflate-piksler i DEM-en OG saltvanns-/kystlinje-
  // bevis i OSM før vi behandler kartet som kystnært. Innland-kart (Mjøsa,
  // Tyrifjorden) → coastal=false → ingen 5 m-oppgradering, ingen Sjøkart-WFS.
  // Resultatet caches så både DEM-oppgraderingen, Sjøkart-gaten og meta.coastal
  // bruker samme svar. Bare ventet på når DEM faktisk viser havflate-piksler
  // (ellers er svaret trivielt false og vi blokkerer ikke på Overpass).
  //
  // v12.0.17: OSM-saltvanns-signalet kappløpes mellom en bitteliten kystlinje-
  // probe (buildCoastProbeQuery, ~200 B svar på 1–3 s, samme predikat som
  // osmHasSaltwater) og den fulle Overpass-spørringen. Tidligere ventet både
  // kyst-DEM-oppgraderingen og Sjøkart transitivt på hele Overpass (det
  // tregeste kallet) bare for å få ja/nei på saltvann — proben løser det
  // 4–12 s tidligere på kystkart. Feiler proben, faller vi tilbake til det
  // autoritative svaret fra hovedspørringen (dagens oppførsel).
  const coastalPromise = probeDemPromise.then(async (probeDem) => {
    if (!hasNearSeaLevelPixels(probeDem)) return false
    const fullP = overpassP.then(osm => osmHasSaltwater(osm?.elements))
    const probeP = probeCoastline(bbox, { signal }).catch(() => fullP)
    return Promise.race([probeP, fullP]).catch(() => false)
  })

  // Grense-kart: fyll celler utenfor norsk WCS-dekning (noData, eller en
  // kunstig ~0 m-klippe mot ekte terreng) fra global Terrarium-høyde, så
  // høydekurver krysser riksgrensa i stedet for å stable seg til en «mur».
  // Trygg/gated: full-dekning innlands-kart trigger ikke → DEM uendret, og
  // syntetisk DEM hoppes over. Feiler hentingen → DEM uendret.
  const maybeFillFromTerrarium = async (dem) => {
    if (!dem || dem.source?.startsWith('synthetic')) return dem
    try {
      const { dem: filled, filled: didFill, replaced } =
        await fillDemVoidsFromTerrarium(dem, utmBbox, { signal })
      if (didFill) {
        // MERK: «utenfor norsk dekning» = celler uten Kartverket-LiDAR. Det er
        // IKKE det samme som «utenfor Norge» — på kystkart er disse cellene
        // sjø (ingen LiDAR-retur over vann), ikke utland. Den gamle teksten
        // («utenfor norsk dekning») leste som «du er i utlandet» midt i
        // Oslofjorden. Nøytral, korrekt ordlyd i stedet.
        console.log(`[Terrarium] fylte ${replaced} celler uten norsk LiDAR-dekning (sjø/grenseområde)`)
        onProgress(`Fyller inn manglende høydedata fra global modell …`)
        return filled
      }
    } catch (e) {
      console.warn(`[Terrarium] fyll hoppet over: ${e?.message ?? e}`)
    }
    return dem
  }

  // Kjerne-DEM (probe + evt. kyst-oppgradering) skilt fra Terrarium-fyllet:
  // terreng-først-previewen venter kun på kjernen, mens full bygging venter på
  // det fylte DEM-et. Terrarium-fyllet (opptil 64 ekstra flis-fetches på
  // grensekart) lå tidligere på kritisk sti for previewen.
  const demCorePromise = timeAsync('dem', probeDemPromise.then(async (probeDem) => {
    // Ingen oppgradering mulig (for stort/allerede fint) → returnér probe-DEM-et
    // med en gang; vent IKKE på kyst-signalet (som blokkerer på Overpass).
    if (!canUpgradeToFineDem) {
      if (hasNearSeaLevelPixels(probeDem) && coastalTargetResM == null) {
        console.log(`[DEM] mulig kyst-kart ${sizeKmTotal.toFixed(1)} km — beholder ${resolutionM} m (finere DEM over celletaket)`)
      }
      return probeDem
    }
    const coastal = await coastalPromise
    if (!coastal) {
      return probeDem
    }
    // v12.1.53: prøv nest-fineste trinn (10 m) som reserve når 5 m feiler.
    // Mobil-WCS er flaky (kjent issue), og en feilet oppgradering betyr at
    // kartet blir stående på 20 m — som gir ~1–2 cellers land-dilasjon langs
    // kysten (Kirkenes-forskyvningen). 10 m-forespørselen er 4× mindre og
    // kan lykkes der 5 m timet ut; begge trinn caches i flis-cachen så en
    // vellykket henting gjør senere ombygginger raske.
    const upgradeSteps = coastalTargetResM === COASTAL_DEM_RES_M && COASTAL_DEM_MID_RES_M < resolutionM
      ? [COASTAL_DEM_RES_M, COASTAL_DEM_MID_RES_M]
      : [coastalTargetResM]
    for (const res of upgradeSteps) {
      onProgress(`Kystnært kart — henter DEM i ${res} m for skarpere kystlinje …`)
      try {
        const fine = await fetchDemFor(res)
        if (fine && !fine.source?.startsWith('synthetic')) return fine
        console.warn(`[DEM] ${res} m-oppgradering ga syntetisk DEM`)
      } catch (e) {
        console.warn(`[DEM] ${res} m-oppgradering feilet (${e?.message ?? e})`)
      }
    }
    console.warn(`[DEM] kyst-oppgradering feilet — beholder ${resolutionM} m`)
    return probeDem
  }))
  const demPromise = demCorePromise.then(maybeFillFromTerrarium)
  // Sjøkart gates på samme kyst-signal (DEM-havflate + OSM-saltvann). For
  // innlands-bbox (inkl. store innsjøer) hoppes WFS-hentingen helt over.
  const sjokartPromise = timeAsync('sjøkart', coastalPromise.then(coastal => {
    if (!coastal) {
      console.log('[Sjøkart] hopper over — bbox er innlands (ingen havflate + saltvann)')
      return { ...EMPTY_SJOKART, skipped: true }
    }
    // Areal-skalert tak (før: fast 8 s — for stramt for 10–12 km-kart, som
    // stille mistet dybdetall og kai/brygge/molo). Utfallet meldes til
    // brukeren via onProgress og føres inn i kart-meta (sjokartStatus).
    onProgress('Henter sjøkart-dybder og havnedata …')
    const timeoutMs = sjokartTimeoutForBbox(bbox)
    return withHardTimeout(
      fetchSjokart(bbox), timeoutMs,
      { ...EMPTY_SJOKART, timedOut: true, timeoutMs }, 'Sjøkart',
    ).then(res => {
      const { fetchErrors, debugSamples, ...cats } = res
      const n = Object.values(cats).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0)
      if (res.timedOut) onProgress(`Sjøkart svarte ikke innen ${Math.round(timeoutMs / 1000)} s — bygger uten dybdetall og kaier …`)
      else if (n === 0) onProgress('Sjøkart hadde ingen data her — bygger uten dybdetall og kaier …')
      else onProgress(`Sjøkart: ${n} dybde- og havne-features hentet …`)
      return res
    })
  }).catch(() => ({ ...EMPTY_SJOKART, failed: true })))

  const id = generateMapId()
  // Marker som ferskt kart så MapView gir det en garantert «litt kontur + litt
  // relieff»-baseline (relieff persisteres globalt — er det skrudd til 0 ville
  // ellers ALLE nye kart blitt blast). Felles knutepunkt → dekker picker,
  // hjem-FAB og auto-kart likt. Consume-on-read i MapView.
  try { sessionStorage.setItem(`mapview-freshlook:${id}`, '1') } catch { /* noop */ }
  const isRealDem = (d) => d && !d.source?.startsWith('synthetic')
  const buildEntry = ({ svg, counts, dem, source }, partial) => ({
    id,
    navn,
    bbox,
    center: { ...center },
    halfKm,
    // Metadata for kart-listas info-linje (overlever listMaps som dropper
    // svg/dem). demResolutionM = faktisk DEM-oppløsning; demSource = coverage.
    equidistanceM,
    demResolutionM: dem?.transform
      ? Math.round((Math.abs(dem.transform.pixelWidth) + Math.abs(dem.transform.pixelHeight)) / 2) || null
      : null,
    demSource: dem?.source ?? null,
    counts,
    svg,
    source,
    annotations: [],
    dem: isRealDem(dem) ? packDem(dem) : null,
    highestPoint: isRealDem(dem) ? findHighestPoint(dem) : null,
    opprettet: Date.now(),
    partial: !!partial,
    // Auto-genererte fliser markeres så tileCache kan kappe dem (de fjerneste
    // først) uten å røre brukerens egne kart fra picker/hjem-FAB.
    isAuto: !!isAuto,
  })

  // Full bygging: vent på alle kilder, slå sammen, bygg full SVG (worker).
  const assembleAndBuildFull = async () => {
    const [osmData, n50Water, nveLakes, dem, sjokart, kulturminner] = await Promise.all([overpassP, n50P, nveLakesP, demPromise, sjokartPromise, kulturminneP])
    const sjokartElements = sjokartToElements(sjokart)

    const n50HasFreshwater = n50Water.some(el =>
      (el.tags?.natural === 'water' && el.tags?.salt !== 'yes') ||
      el.tags?.waterway === 'stream'
    )
    const n50HasSea = n50Water.some(el =>
      el.tags?.water === 'sea' || el.tags?.salt === 'yes'
    )
    // NVE leverer kun innsjø-FLATER (ikke elver/sjø). Er den tilgjengelig, er
    // den autoritativ for INNSJØ-polygoner → undertrykk OSM-innsjøer helt (også
    // navngitte: nettopp store, navngitte innsjøer som Røssvatnet er der
    // mistagget og flommer). Elve-/kanal-/bekke-FLATER beholdes uansett (se
    // filterOsmWaterElements / isFlowingWaterArea) — NVE har ingen elveløp.
    const nveHasLakes = nveLakes.length > 0
    // Ytre ringer (lon/lat) fra NVE-innsjøene for per-flate-dekningstest i
    // filterOsmWaterElements — NVE er autoritativ DER den har en innsjø, men
    // dens identify-respons kan være ufullstendig, så OSM beholdes i hullene.
    const nveLakeRings = []
    for (const lake of nveLakes) {
      for (const m of lake.members ?? []) {
        if ((m.role === 'outer' || !m.role) && Array.isArray(m.geometry) && m.geometry.length >= 3) {
          nveLakeRings.push(m.geometry.map(g => [g.lon, g.lat]))
        }
      }
    }

    const elements = filterOsmWaterElements(osmData.elements, { n50HasSea, n50HasFreshwater, nveLakeRings })
    if (n50Water.length > 0) elements.push(...n50Water)
    if (nveLakes.length > 0) elements.push(...nveLakes)
    if (sjokartElements.length > 0) elements.push(...sjokartElements)

    const sourceParts = ['OSM']
    if (n50Water.length > 0) sourceParts.push(`N50 (${n50Water.length} vann${n50HasSea ? ', m/sjø' : ''})`)
    if (nveLakes.length > 0) sourceParts.push(`NVE (${nveLakes.length} innsjø)`)
    if (sjokartElements.length > 0) sourceParts.push(`Sjøkart (${sjokartElements.length} dybde-features)`)
    sourceParts.push('DEM-sjø (NHM_DTM_25832)')
    const source = sourceParts.join(' + ')

    const coastal = await coastalPromise
    throwIfAborted()
    onProgress(`Bygger SVG fra ${elements.length} elementer …`)
    // buildSvg i Web Worker så det tunge passet ikke fryser UI-en. signal
    // avbryter (terminerer workeren) ved prefetch-bom.
    const { svg, counts, timings } = await timeAsync('buildSvg', buildSvgClient(elements, bbox, {
      dem,
      utmBbox,                       // authoritativ extent (samme som DEM-fetch) → kvadratisk + bit-eksakt
      contourIntervalM: equidistanceM,
      scaleDenom: 10000,
      skipContoursIfSynthetic: true,
      // DEM-sjø KUN på kystnære kart (coastal = DEM-havflate + OSM-saltvann).
      // Innlands leser NHM_DTM både innsjø-flater (ingen LiDAR-retur over vann)
      // OG nodata som ~0 m, så buildSeaFromDem ville klassifisere hele kartet
      // som «sjø» og flomme tørt land blått (Hattfjelldal/Børgefjell-saken —
      // stier og ruter gikk tvers over den falske sjøen). Innlands-vann kommer
      // fra NVE/N50/OSM-vektor i stedet (ekte innsjø-geometri). Samme coastal-
      // gate styrer allerede Sjøkart-WFS og 5 m-DEM-oppgraderingen.
      skipDemSea: !coastal,
      coastal,                       // kyst vs innland → meta.coastal (MapView høyde-ærlighet)
      // Sjøkart-utfall → meta.sjokartStatus (Utvikler-fanen): gjør den stille
      // WFS-fallbacken synlig — hvorfor dybdetall/kai mangler.
      sjokartStatus: summarizeSjokartStatus(sjokart, sjokartElements.length),
      kulturminner,
    }, { signal }))

    const ti = timings ?? {}
    const inner = ['contours', 'cliffs', 'buildingMass', 'knauser']
      .filter(k => ti[k] != null).map(k => `${k} ${ti[k]}ms`).join(', ')
    logPerf(
      `[perf] kart ${(halfKm * 2).toFixed(1)}km total ${Math.round(_now() - _t0)}ms | ` +
      `overpass ${marks.overpass ?? '-'} | n50 ${marks.n50 ?? '-'} | nve ${marks.nve ?? '-'} | dem ${marks.dem ?? '-'} | ` +
      `sjøkart ${marks['sjøkart'] ?? '-'} | buildSvg ${marks.buildSvg ?? '-'}${inner ? ` (${inner})` : ''}` +
      `${terrainFirst ? ' [terreng-først]' : ''} [ms]`
    )
    return { svg, counts, dem, source }
  }

  // Terreng-først: vent KUN på DEM, bygg konturer + DEM-sjø straks og lagre, og
  // fyll inn OSM/full bygging i bakgrunnen (mapFinalizers → MapView re-render).
  // Gir bruker terreng å «lese» mens Overpass (flaskehalsen) fortsatt lastes.
  // Trygg fallback: syntetisk DEM eller feil → bygg full som vanlig.
  if (terrainFirst) {
    try {
      // Kjerne-DEM uten Terrarium-fyll: previewen skal ikke vente på opptil 64
      // ekstra flis-fetches for grensekart — fullbygget (assembleAndBuildFull)
      // bruker det fylte DEM-et og overskriver previewen når det er klart.
      const dem = await demCorePromise
      if (isRealDem(dem)) {
        const terrain = await timeAsync('terreng', buildSvgClient([], bbox, {
          dem,
          utmBbox,                   // samme authoritative extent som full-bygget
          contourIntervalM: equidistanceM,
          scaleDenom: 10000,
          skipContoursIfSynthetic: true,
          // Terreng-preview hopper over DEM-sjø: coastal-signalet er ikke
          // tilgjengelig billig her (krever Overpass), og en innlands-flom skal
          // ikke blinke til. Full-bygget fyller inn riktig vann straks det er klart.
          skipDemSea: true,
        }, { signal }))
        throwIfAborted()
        const entry = buildEntry(
          { svg: terrain.svg, counts: terrain.counts, dem, source: 'Terreng (DEM) — fyller inn detaljer …' },
          true,
        )
        await saveMap(entry)
        onProgress('Terreng klart — fyller inn stier og detaljer …')
        const finalize = (async () => {
          const full = await assembleAndBuildFull()
          const fullEntry = buildEntry(full, false)
          await saveMap(fullEntry)
          return fullEntry
        })()
        finalize.catch(() => { /* MapView-konsumenten håndterer feil */ })
        mapFinalizers.set(id, finalize)
        return { id, entry, finalize }
      }
    } catch (e) {
      if (signal?.aborted) throw e
      console.warn(`[terreng-først] feilet (${e?.message ?? e}) — bygger full som vanlig`)
    }
  }

  // Normal / fallback: bygg full og lagre.
  const full = await assembleAndBuildFull()
  const entry = buildEntry(full, false)
  throwIfAborted()
  await saveMap(entry)
  return { id, entry }
}
