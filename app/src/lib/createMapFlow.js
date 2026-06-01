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

import { fetchOverpass, buildSvg, bboxFromCenter } from './mapBuilder.js'
import { fetchN50Water } from './n50Fetcher.js'
import { fetchSjokart, sjokartToElements } from './sjokartFetcher.js'
import { isOsmWaterSalty } from './symbolizer.js'
import { fetchDEM } from './demFetcher.js'
import { findHighestPoint, packDem } from './demSampling.js'
import { wgs84ToUtm32 } from './utm.js'
import { saveMap, generateMapId } from './mapStorage.js'

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
}) {
  const bbox = bboxFromCenter(center.lat, center.lon, halfKm)
  const sizeKm = (halfKm * 2).toFixed(1)
  onProgress(`Henter kartdata for ${sizeKm} × ${sizeKm} km …`)

  // Beregn UTM-bbox tidlig så fetchDEM kan startes parallelt med
  // Overpass/N50 i stedet for å vente på dem (v8.10.18: sparer 3-10 s).
  const sw = wgs84ToUtm32(bbox.south, bbox.west)
  const ne = wgs84ToUtm32(bbox.north, bbox.east)
  const utmBbox = {
    minE: Math.min(sw.e, ne.e), maxE: Math.max(sw.e, ne.e),
    minN: Math.min(sw.n, ne.n), maxN: Math.max(sw.n, ne.n),
  }

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
  const resolutionM = equidistanceM <= 5 ? 10 : 20
  const sizeKmTotal = halfKm * 2
  const canUpgradeToFineDem = resolutionM > COASTAL_DEM_RES_M &&
                              sizeKmTotal <= COASTAL_UPGRADE_MAX_KM
  const probeDemPromise = fetchDEM(bbox, utmBbox, { resolutionM, useReal: true })
  const demPromise = probeDemPromise.then(async (probeDem) => {
    const coastal = hasNearSeaLevelPixels(probeDem)
    if (!coastal || !canUpgradeToFineDem) {
      if (coastal && sizeKmTotal > COASTAL_UPGRADE_MAX_KM) {
        console.log(`[DEM] kyst-kart ${sizeKmTotal.toFixed(1)} km > ${COASTAL_UPGRADE_MAX_KM} km — beholder ${resolutionM} m (5 m for kostbart på store kart)`)
      }
      return probeDem
    }
    onProgress(`Kystnært kart — henter DEM i ${COASTAL_DEM_RES_M} m for skarpere kystlinje …`)
    try {
      const fine = await fetchDEM(bbox, utmBbox, { resolutionM: COASTAL_DEM_RES_M, useReal: true })
      if (fine && !fine.source?.startsWith('synthetic')) return fine
      console.warn('[DEM] 5 m-oppgradering ga syntetisk DEM — beholder probe-oppløsning')
      return probeDem
    } catch (e) {
      console.warn(`[DEM] 5 m-oppgradering feilet (${e?.message ?? e}) — beholder ${resolutionM} m`)
      return probeDem
    }
  })
  // Sjøkart gates på probe-DEM-et (returnerer først) så WFS-hentingen starter
  // parallelt med 5 m-oppgraderingen, ikke etter den.
  const sjokartPromise = probeDemPromise.then(dem => {
    if (!hasNearSeaLevelPixels(dem)) {
      console.log('[Sjøkart] hopper over — bbox er innlands (ingen DEM-piksler ≤ 0.5 m)')
      return EMPTY_SJOKART
    }
    return withHardTimeout(fetchSjokart(bbox), SJOKART_TIMEOUT_MS, EMPTY_SJOKART, 'Sjøkart')
  }).catch(() => EMPTY_SJOKART)

  const [osmData, n50Water, dem, sjokart] = await Promise.all([
    fetchOverpass(bbox),
    fetchN50Water(bbox).catch(e => {
      console.warn('N50-vann ikke tilgjengelig:', e.message)
      return []
    }),
    demPromise,
    sjokartPromise,
  ])
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

  onProgress(`Bygger SVG fra ${elements.length} elementer …`)

  const { svg, counts } = buildSvg(elements, bbox, {
    dem,
    contourIntervalM: equidistanceM,
    scaleDenom: 10000,
    skipContoursIfSynthetic: true,
    // DEM-sjø ALLTID på når DEM er ekte. Buggy «smitter inn på lavtliggende
    // øyer»-tilfeller dekkes av ISOM 001 land-overlay (OSM place=island).
    skipDemSea: false,
  })

  onProgress(`Lagrer kart …`)

  const id = generateMapId()
  const isRealDem = dem && !dem.source?.startsWith('synthetic')
  const packedDem = isRealDem ? packDem(dem) : null
  const highestPoint = isRealDem ? findHighestPoint(dem) : null

  const entry = {
    id,
    navn,
    bbox,
    center: { ...center },
    halfKm,
    counts,
    svg,
    source,
    annotations: [],
    dem: packedDem,
    highestPoint,
    opprettet: Date.now(),
  }
  await saveMap(entry)
  return { id, entry }
}
