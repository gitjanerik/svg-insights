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

import { fetchOverpass, bboxFromCenter } from './mapBuilder.js'
import { buildSvgClient } from './buildSvgClient.js'
import { fetchN50Water } from './n50Fetcher.js'
import { fetchSjokart, sjokartToElements } from './sjokartFetcher.js'
import { isOsmWaterSalty } from './symbolizer.js'
import { fetchDEM } from './demFetcher.js'
import { findHighestPoint, packDem } from './demSampling.js'
import { utm32ToWgs84, utm32BboxFromWgs84 } from './utm.js'
import { saveMap, generateMapId } from './mapStorage.js'
import { snapUtmBboxToGrid, fetchDEMWithCache } from './demTileCache.js'
import { logPerf } from './perfLog.js'

// DEM-flis-cache. Når PÅ snappes kart-bbox til res-rutenettet og DEM hentes
// flis-vis med gjenbruk mellom overlappende kart; AV = byte-identisk med før
// (rett fetchDEM, ingen snapping). PÅ for verifisering på ekte enhet — den
// robuste fallback-en i fetchDEMWithCache gjør at verste fall degraderer til
// dagens oppførsel (én full fetch). Følg med på at høydekurver flukter med
// stier/vann (ingen forskyvning) på nabo-kart.
const DEM_TILE_CACHE_ENABLED = true

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

const SJOKART_TIMEOUT_MS = 8000

// Kyst-kart oppgraderes til denne DEM-oppløsningen (m) i et andre fetch-trinn,
// så smale sund (Nesøybrua etc.) oppløses i sjø-masken. Se buildMapFromCenter.
const COASTAL_DEM_RES_M = 5

// 5 m-oppgraderingen gjøres kun for kart opp til denne total-størrelsen (km).
// Større kyst-kart er oversiktskart der et ~30 m sund er sub-synlig uansett, og
// 5 m ville koste (km/5)² celler (14 km = 7,8M) — tregt på mobil. Se gaten i
// buildMapFromCenter.
const COASTAL_UPGRADE_MAX_KM = 8

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
 * @param {number} opts.halfKm  — halv-bredde i km (kart blir 2*halfKm × 2*halfKm)
 * @param {number} opts.equidistanceM  — kontur-intervall
 * @param {string} opts.navn  — kartets navn
 * @param {(msg:string)=>void} [opts.onProgress]  — status-callback for UI
 */
export async function buildMapFromCenter({
  center,
  halfKm,
  equidistanceM,
  navn,
  onProgress = () => {},
  signal,
  terrainFirst = false,
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
  let bbox = bboxFromCenter(center.lat, center.lon, halfKm)
  const sizeKm = (halfKm * 2).toFixed(1)
  onProgress(`Henter kartdata for ${sizeKm} × ${sizeKm} km …`)

  // Beregn UTM-bbox tidlig så fetchDEM kan startes parallelt med
  // Overpass/N50 i stedet for å vente på dem (v8.10.18: sparer 3-10 s).
  // Fire-hjørners UTM-extent (utm32BboxFromWgs84) så kartet blir kvadratisk for
  // en kvadratisk bbox — SW+NE-diagonalen alene undervurderte øst-vest og ga
  // portrett-kart vekk fra sentralmeridianen. Sendes uendret videre til buildSvg.
  let utmBbox = utm32BboxFromWgs84(bbox)

  // DEM-oppløsning (probe). 10 m ved fine konturer (≤ 5 m ekvidistanse),
  // ellers 20 m. Beregnes her oppe fordi flis-cachen snapper bbox til dette
  // rutenettet (multiplum av 5/10/20 → også 5 m-justert for kyst-oppgraderingen).
  const resolutionM = equidistanceM <= 5 ? 10 : 20

  // Flis-cache PÅ: snap bbox til res-rutenettet så kart-grid og flis-grid
  // flukter eksakt (ingen resampling). Recompute WGS84-bbox fra de snappede
  // hjørnene så Overpass/buildSvg bruker SAMME extent som DEM-en.
  if (DEM_TILE_CACHE_ENABLED) {
    utmBbox = snapUtmBboxToGrid(utmBbox, resolutionM)
    // Recompute WGS84-bbox fra ALLE fire snappede hjørner (ikke bare SW+NE) så
    // Overpass dekker hele det kvadratiske utsnittet — med bare diagonalen ble
    // hjørnene under-dekket og OSM-data manglet i kart-kantene.
    const cs = [
      utm32ToWgs84(utmBbox.minE, utmBbox.minN), utm32ToWgs84(utmBbox.maxE, utmBbox.minN),
      utm32ToWgs84(utmBbox.minE, utmBbox.maxN), utm32ToWgs84(utmBbox.maxE, utmBbox.maxN),
    ]
    bbox = {
      south: Math.min(...cs.map(c => c.lat)), north: Math.max(...cs.map(c => c.lat)),
      west: Math.min(...cs.map(c => c.lon)), east: Math.max(...cs.map(c => c.lon)),
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
  //   Trinn 2 (oppgradering): er bbox-en kystnær, hentes DEM på nytt i 5 m.
  //     Smale sund (f.eks. Nesøybrua, ~30-40 m) oppløses ikke ved 20/10 m —
  //     DEM-0.5m-masken klemmer halsen igjen og en øy blir til halvøy. 5 m
  //     åpner sundet. Kostnaden (16× piksler vs 20 m) betales KUN ved kysten;
  //     innlands-kart henter bare probe-DEM-et og er byte-identiske med før.
  //     Trygg degradering: feiler 5 m-hentingen (eller faller til syntetisk),
  //     beholder vi probe-DEM-et — kartet blir aldri verre enn før.
  // Konturer rendres fortsatt fint takket være Chaikin-glatting, og antall
  // høydekurver styres av ekvidistansen (uendret) — 5 m gir bare mer presise
  // vektorer, ikke flere kurver.
  // 5 m-oppgraderingen gates på kart-STØRRELSE i tillegg til kyst: finheten
  // trengs der man planlegger å padle gjennom et sund — små, detaljerte kart.
  // Store oversiktskart beholder probe-oppløsningen (byte-identisk med før
  // 5 m-funksjonen, og like raskt). Terskel: COASTAL_UPGRADE_MAX_KM.
  const sizeKmTotal = halfKm * 2
  const canUpgradeToFineDem = resolutionM > COASTAL_DEM_RES_M &&
                              sizeKmTotal <= COASTAL_UPGRADE_MAX_KM
  const probeDemPromise = fetchDemFor(resolutionM)
  const demPromise = timeAsync('dem', probeDemPromise.then(async (probeDem) => {
    const coastal = hasNearSeaLevelPixels(probeDem)
    if (!coastal || !canUpgradeToFineDem) {
      if (coastal && sizeKmTotal > COASTAL_UPGRADE_MAX_KM) {
        console.log(`[DEM] kyst-kart ${sizeKmTotal.toFixed(1)} km > ${COASTAL_UPGRADE_MAX_KM} km — beholder ${resolutionM} m (5 m for kostbart på store kart)`)
      }
      return probeDem
    }
    onProgress(`Kystnært kart — henter DEM i ${COASTAL_DEM_RES_M} m for skarpere kystlinje …`)
    try {
      const fine = await fetchDemFor(COASTAL_DEM_RES_M)
      if (fine && !fine.source?.startsWith('synthetic')) return fine
      console.warn('[DEM] 5 m-oppgradering ga syntetisk DEM — beholder probe-oppløsning')
      return probeDem
    } catch (e) {
      console.warn(`[DEM] 5 m-oppgradering feilet (${e?.message ?? e}) — beholder ${resolutionM} m`)
      return probeDem
    }
  }))
  // Sjøkart gates på probe-DEM-et (returnerer først) så WFS-hentingen starter
  // parallelt med 5 m-oppgraderingen, ikke etter den.
  const sjokartPromise = timeAsync('sjøkart', probeDemPromise.then(dem => {
    if (!hasNearSeaLevelPixels(dem)) {
      console.log('[Sjøkart] hopper over — bbox er innlands (ingen DEM-piksler ≤ 0.5 m)')
      return EMPTY_SJOKART
    }
    return withHardTimeout(fetchSjokart(bbox), SJOKART_TIMEOUT_MS, EMPTY_SJOKART, 'Sjøkart')
  }).catch(() => EMPTY_SJOKART))

  // Overpass + N50 fyres parallelt nå (delt mellom terreng- og full-bygg) så
  // OSM-hentingen (flaskehalsen) starter samtidig med DEM.
  const overpassP = timeAsync('overpass', fetchOverpass(bbox, { signal }))
  const n50P = timeAsync('n50', fetchN50Water(bbox).catch(e => {
    console.warn('N50-vann ikke tilgjengelig:', e.message)
    return []
  }))

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
  })

  // Full bygging: vent på alle kilder, slå sammen, bygg full SVG (worker).
  const assembleAndBuildFull = async () => {
    const [osmData, n50Water, dem, sjokart] = await Promise.all([overpassP, n50P, demPromise, sjokartPromise])
    const sjokartElements = sjokartToElements(sjokart)

    const n50HasFreshwater = n50Water.some(el =>
      (el.tags?.natural === 'water' && el.tags?.salt !== 'yes') ||
      el.tags?.waterway === 'stream'
    )
    const n50HasSea = n50Water.some(el =>
      el.tags?.water === 'sea' || el.tags?.salt === 'yes'
    )

    const elements = osmData.elements.filter(el => {
      const tags = el.tags ?? {}
      const isWaterPolygon = tags.natural === 'water' || !!tags.water ||
                             tags.natural === 'bay' || tags.natural === 'strait' ||
                             tags.place === 'sea' || tags.place === 'ocean'
      if (isWaterPolygon) {
        if (isOsmWaterSalty(tags)) return !n50HasSea
        if (tags.name) return true
        return !n50HasFreshwater
      }
      if (tags.waterway === 'stream' || tags.waterway === 'ditch') {
        return !n50HasFreshwater
      }
      return true
    })
    if (n50Water.length > 0) elements.push(...n50Water)
    if (sjokartElements.length > 0) elements.push(...sjokartElements)

    const sourceParts = ['OSM']
    if (n50Water.length > 0) sourceParts.push(`N50 (${n50Water.length} vann${n50HasSea ? ', m/sjø' : ''})`)
    if (sjokartElements.length > 0) sourceParts.push(`Sjøkart (${sjokartElements.length} dybde-features)`)
    sourceParts.push('DEM-sjø (NHM_DTM_25832)')
    const source = sourceParts.join(' + ')

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
      // DEM-sjø ALLTID på når DEM er ekte. Øy-overlay (ISOM 001) dekker
      // «smitter inn på lavtliggende øyer»-tilfeller.
      skipDemSea: false,
    }, { signal }))

    const ti = timings ?? {}
    const inner = ['contours', 'cliffs', 'buildingMass', 'knauser']
      .filter(k => ti[k] != null).map(k => `${k} ${ti[k]}ms`).join(', ')
    logPerf(
      `[perf] kart ${(halfKm * 2).toFixed(1)}km total ${Math.round(_now() - _t0)}ms | ` +
      `overpass ${marks.overpass ?? '-'} | n50 ${marks.n50 ?? '-'} | dem ${marks.dem ?? '-'} | ` +
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
      const dem = await demPromise
      if (isRealDem(dem)) {
        const terrain = await timeAsync('terreng', buildSvgClient([], bbox, {
          dem,
          utmBbox,                   // samme authoritative extent som full-bygget
          contourIntervalM: equidistanceM,
          scaleDenom: 10000,
          skipContoursIfSynthetic: true,
          skipDemSea: false,
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
