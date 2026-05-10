<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useNominatim } from '../composables/useNominatim.js'
import { fetchOverpass, buildSvg, bboxFromCenter } from '../lib/mapBuilder.js'
import { fetchN50Water } from '../lib/n50Fetcher.js'
import { fetchSjokart, sjokartToElements } from '../lib/sjokartFetcher.js'
import { isOsmWaterSalty } from '../lib/symbolizer.js'
import { fetchDEM } from '../lib/demFetcher.js'
import { findHighestPoint, packDem } from '../lib/demSampling.js'
import { wgs84ToUtm32 } from '../lib/utm.js'
import { saveMap, generateMapId } from '../lib/mapStorage.js'
import { tileMosaic, zoomForKm, metersPerPixel } from '../lib/tileBackground.js'
import { t } from '../lib/i18n.js'

const router = useRouter()
const route = useRoute()

// Standard utgangspunkt: Oslo
const DEFAULT_CENTER = { lat: 59.9139, lon: 10.7522, name: 'Oslo' }

const center = ref({ ...DEFAULT_CENTER })
const halfKm = ref(2.0)  // halv-bredde av bbox i km. Kart blir 2*halfKm × 2*halfKm
const equidistanceM = ref(20)  // høydekurve-intervall, 10/20/50/100 m
const customName = ref('')

// v7.4.0: Delings-utfordring. Hvis URL har ?n=ABC&lat=...&lon=...&km=...&eq=...
// så kommer brukeren fra en delings-lenke — pre-populer alle felter og vis
// banner med info om hvem som har utfordret + spillforklaring.
const challenge = ref(null)   // { name, score, level } eller null

// v7.4.2: i utfordringsmodus skal alle valg (sted, navn, størrelse, ekvi-
// distanse, preview drag/pinch) være read-only. Brukeren skal akkurat det
// kartet som ble delt — ikke noe annet. Bruk én computed-flag overalt.
const isLocked = computed(() => challenge.value !== null)

function cancelChallenge() {
  // Fjerner banneret + lås, og clearer URL-query så f.eks. F5 ikke gir
  // utfordring igjen. Gir brukeren mulighet til å gjøre vanlig kart-bygg.
  challenge.value = null
  customName.value = ''
  router.replace({ name: 'kart-nytt', query: {} })
}

// HTML-escape for trygg interpolering i v-html (kun for utfordrernavn)
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

// Utfordrings-intro renderet med <strong> rundt spillnavnet. Bruker v-html
// fordi vi vil bolde gameName uten å forurense i18n-stringen med markup.
const challengeIntroHtml = computed(() => {
  if (!challenge.value) return ''
  return t('challenge.intro', {
    gameName: `<strong class="text-white">${escapeHtml(t('game.name'))}</strong>`,
    startBtn: escapeHtml(t('button.startGame')),
    name: escapeHtml(challenge.value.name),
  })
})

function parseShareQuery() {
  const q = route.query
  if (!q || !q.lat || !q.lon || !q.n) return null
  const lat = parseFloat(q.lat)
  const lon = parseFloat(q.lon)
  const km = parseFloat(q.km)
  const eq = parseInt(q.eq, 10)
  const score = parseInt(q.score, 10)
  const lv = parseInt(q.lv, 10)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  // Pre-populer kart-oppsett. customName settes så challenger-navn synes
  // i lagrede-kart-listen senere.
  center.value = { lat, lon, name: '' }
  if (Number.isFinite(km) && km >= 1 && km <= 10) halfKm.value = km / 2
  if (Number.isFinite(eq) && [5, 10, 20, 50, 100].includes(eq)) equidistanceM.value = eq
  const name = String(q.n).slice(0, 3).toUpperCase()
  customName.value = t('challenge.from', { name })
  return {
    name,
    score: Number.isFinite(score) ? score : null,
    level: Number.isFinite(lv) ? lv : null,
  }
}

const EQUIDISTANCE_OPTIONS = [
  { value: 5,   label: '5 m',   desc: 'ISOM-orientering — krever 1m DTM' },
  { value: 10,  label: '10 m',  desc: 'tett — for små områder' },
  { value: 20,  label: '20 m',  desc: 'turkart-standard' },
  { value: 50,  label: '50 m',  desc: 'oversikt' },
  { value: 100, label: '100 m', desc: 'glissen — for store områder' },
]

// v8.0.5: forhåndsdefinerte test-kart-presets for å rask-teste
// Curve-Invaders-fysikk på topografisk veldig ulike kart. Hvert preset setter
// sentrum, størrelse og høydekurve-intervall — bygg-knappen er den vanlige.
// Kommentarene beskriver forventet topografi så det er lett å vurdere
// gameplay-feel etter at kartet er bygd.
const TEST_PRESETS = [
  {
    id: 'flat-kyst',
    label: 'Flat kyst',
    desc: 'Lista (Farsund) — sandstrand, lavland',
    icon: '🏖️',
    lat: 58.1015, lon: 6.6234, halfKm: 1.5, eqM: 10,
  },
  {
    id: 'bratt-fjell',
    label: 'Bratt fjell',
    desc: 'Romsdalen — Trolltindene, alpint',
    icon: '⛰️',
    lat: 62.4540, lon: 7.7400, halfKm: 2.5, eqM: 50,
  },
  {
    id: 'lite-tett',
    label: 'Lite & tett',
    desc: 'Sognsvann (Oslo) — kupert skog',
    icon: '🌲',
    lat: 59.9706, lon: 10.7239, halfKm: 0.6, eqM: 10,
  },
  {
    id: 'stort-variert',
    label: 'Stort & variert',
    desc: 'Jotunheimen — alpint, store flater',
    icon: '🗻',
    lat: 61.6362, lon: 8.3122, halfKm: 4.0, eqM: 50,
  },
]

function applyTestPreset(p) {
  if (isLocked.value) return
  center.value = { lat: p.lat, lon: p.lon, name: p.label }
  halfKm.value = p.halfKm
  equidistanceM.value = p.eqM
  customName.value = p.label
}

const { query, results, isSearching, error: searchError } = useNominatim()

const showResults = computed(() =>
  query.value.trim().length >= 2 && (results.value.length > 0 || isSearching.value)
)

function selectResult(r) {
  center.value = { lat: r.lat, lon: r.lon, name: r.shortName }
  customName.value = r.shortName
  query.value = ''
  results.value = []
}

const bbox = computed(() => bboxFromCenter(center.value.lat, center.value.lon, halfKm.value))

const sizeKm = computed(() => (halfKm.value * 2).toFixed(1))

// v7.1.0: 'idle' | 'fetching' | 'awaiting-map-type' | 'building' | 'saving' | 'error'
const buildState = ref('idle')
const buildError = ref(null)
const buildProgress = ref('')

// v7.1.0: karttype-valg. Brukeren velger eksplisitt for kyst-områder
// (LAND-kart for hike, SJØ-kart for padling). Lagret preferanse i
// localStorage så vi ikke spør hver gang.
const MAP_TYPE_KEY = 'svg-insights:mapType'
const savedMapTypePref = (() => {
  try { return localStorage.getItem(MAP_TYPE_KEY) } catch { return null }
})()
const mapTypePreference = ref(savedMapTypePref)  // 'land' | 'sea' | null

// Når kart-type-dialogen vises: pendingFetchedData holder all data fra
// fetch+filter-passet, og generateMap fortsetter når brukeren velger.
const pendingFetchedData = ref(null)
const rememberMapType = ref(true)   // checkbox i dialog (default: husk)
const detectedCoastline = ref(false)

async function generateMap() {
  buildState.value = 'fetching'
  buildError.value = null
  buildProgress.value = `Henter kartdata for ${sizeKm.value} × ${sizeKm.value} km …`

  try {
    // 1. Hent OSM (rik data) + N50-vann + Sjøkart (kyst/dybdedata).
    //    Tre parallelle kilder. Vann-prioritet i fallende rekkefølge:
    //      a) N50 Havflate / Innsjø / ElvBekk (autoritativt for innland)
    //      b) Sjøkart Dybdeareal (autoritativt for kyst — fyller hull
    //         der N50 Havflate mangler i åpne hav-områder)
    //      c) OSM `natural=water` som siste fallback
    //    Sjøkart gir dessuten dybdekonturer, skjær/grunner og lanterner
    //    som vi rendrer med dedikerte ISOM-koder.
    const [osmData, n50Water, sjokart] = await Promise.all([
      fetchOverpass(bbox.value),
      fetchN50Water(bbox.value).catch(e => {
        console.warn('N50-vann ikke tilgjengelig:', e.message)
        return []
      }),
      fetchSjokart(bbox.value).catch(e => {
        console.warn('Sjøkart ikke tilgjengelig:', e.message)
        return null
      }),
    ])
    const sjokartEls = sjokart ? sjokartToElements(sjokart) : []
    // Granulær autoritets-deteksjon. Vi differensierer mellom ferskvann
    // (innsjø/tjern/elv) og saltvann (sjø/fjord). Tidligere filter (v6.10.0)
    // skrudde av ALL OSM natural=water så snart N50 hadde noen ting — også
    // hvis N50 bare hadde innsjøer i et bbox med fjord. Da forsvant
    // Oslofjord-relationen og kart endte kremgul i Oslo. Nå filtreres OSM
    // pr type bare hvis tilsvarende autoritativ kilde finnes.
    const n50HasFreshwater = n50Water.some(el =>
      (el.tags?.natural === 'water' && el.tags?.salt !== 'yes') ||
      el.tags?.waterway === 'stream'
    )
    const n50HasSea = n50Water.some(el =>
      el.tags?.water === 'sea' || el.tags?.salt === 'yes'
    )
    const sjokartHasSea = sjokartEls.some(el =>
      el.type === 'way' && el.tags?.sjokart === 'dybdeareal'
    )
    const haveAuthoritativeSea = n50HasSea || sjokartHasSea

    // Detekter om vi må falle tilbake til coastline-rekonstruksjon. Må
    // beregnes FØR filteret slik at vi kan ekskludere OSM-saltvann-
    // polygoner i coastline-mode (de er da redundant og kan bløde blå
    // over mainland-masken hvis de mangler riktige inner-holes).
    const hasCoastline = osmData.elements.some(el =>
      el.type === 'way' && el.tags?.natural === 'coastline'
    )
    // v6.21.0: coastline-mode er nå standard for ALLE kyst-bboxer, ikke
    // siste-fallback. Gating-en `hasCoastline && !haveAuthoritativeSea`
    // var for streng — én eneste Sjøkart-dybdeareal-polygon (eller én
    // N50 Havflate-flekk) ga `haveAuthoritativeSea=true` og slo av
    // coastline-rekonstruksjon, selv om Sjøkart/N50 ofte har hull i
    // sjø-dekningen og ikke faktisk dekker hele sjø-arealet. Resultat:
    // sjø rendret med kremgul bakgrunn-rect i stedet for blå (Oslofjord,
    // Asker-skjærgård, Drammen-Konnerud m.fl.). Sjøkart/N50 er nå
    // *additive* — de maler dybde-tonet blå over allerede-blå bg, gir
    // dybdekonturer og lanterner og innsjø-elev-labels uten å påvirke
    // basis-sjøen som coastline-rekonstruksjon håndterer.
    const useCoastlineFallback = hasCoastline

    // v6.12.1: «Confirmed inland»-deteksjon. Hvis N50 har ferskvann
    // (innsjø/elv), N50 har INGEN sjø (Havflate), OG ingen OSM coastline,
    // så er vi trygt inne i innland. OSM-relations som er tagget
    // place=sea/natural=bay/etc kan strekke seg langt opp i elveos-
    // områder (Drammensfjorden-relationen dekker Drammenselva forbi
    // Drammen Sentrum og inn i Gulskogen) → de blør sjøblå over ren
    // land. Tilsvarende kan Sjøkart Dybdeareal returnere bbox-overlapp
    // fra fjord-hodet selv om actual bbox er inland.
    //
    // Merk: vi bruker n50HasSea (ikke haveAuthoritativeSea) som
    // sjø-signal, fordi Sjøkart selv kan være kilden til lekkasjen.
    // N50 Havflate er den eneste 100% autoritative sjø-detektoren.
    const isConfirmedInland = n50HasFreshwater && !n50HasSea && !hasCoastline

    let removedSaltwater = 0
    let removedInlandSjokart = 0
    const elements = osmData.elements.filter(el => {
      const t = el.tags ?? {}
      const isWaterPolygon = t.natural === 'water' || !!t.water ||
                             t.natural === 'bay' || t.natural === 'strait' ||
                             t.place === 'sea' || t.place === 'ocean'
      if (isWaterPolygon) {
        if (isOsmWaterSalty(t)) {
          // Drop OSM-saltvann i coastline-mode ELLER når bbox er
          // bekreftet inland — i begge tilfeller er saltvann-tagget
          // OSM-data feil eller redundant her.
          if (useCoastlineFallback || isConfirmedInland) { removedSaltwater++; return false }
          return !haveAuthoritativeSea
        }
        return !n50HasFreshwater
      }
      if (t.waterway === 'stream' || t.waterway === 'ditch') {
        return !n50HasFreshwater
      }
      return true
    })
    if (n50Water.length > 0) elements.push(...n50Water)

    // Filtrer Sjøkart-polygoner i confirmed-inland-bbox. Sjøkart-WFS kan
    // returnere bbox-clipped fjord-data som strekker seg inn i innland
    // (særlig ved fjord-hoder som Drammen). Lanterner/skjær er sjø-only
    // features og dropper også. Beholder dybdepunkt-tekst som er
    // tilnærmet harmløst hvis det skulle dukke opp.
    let sjokartFiltered = sjokartEls
    if (isConfirmedInland && sjokartEls.length > 0) {
      const before = sjokartEls.length
      sjokartFiltered = sjokartEls.filter(el => !el.tags?.sjokart)
      removedInlandSjokart = before - sjokartFiltered.length
    }
    if (sjokartFiltered.length > 0) elements.push(...sjokartFiltered)

    const filteredOsmCount = osmData.elements.length - (elements.length - n50Water.length - sjokartFiltered.length)
    console.log(`[Vann] N50 ferskvann=${n50HasFreshwater} sjø=${n50HasSea} | Sjøkart sjø=${sjokartHasSea} | OSM coastline=${hasCoastline} | coastline-fallback=${useCoastlineFallback} | confirmed-inland=${isConfirmedInland} | filtrerte ${filteredOsmCount} OSM-vann-elementer (${removedSaltwater} saltvann i coastline/inland-mode), ${removedInlandSjokart} Sjøkart-features inland`)

    const sourceParts = ['OSM']
    if (n50Water.length > 0) sourceParts.push(`N50 (${n50Water.length} vann${n50HasSea ? ', m/sjø' : ''})`)
    if (sjokart && sjokart.source) {
      const sjk = (sjokart.dybdeareal?.length ?? 0)
      const dyb = (sjokart.dybdekontur?.length ?? 0)
      const grn = (sjokart.grunne?.length ?? 0)
      const lnt = (sjokart.lanterne?.length ?? 0)
      sourceParts.push(`Sjøkart (${sjk} sjø, ${dyb} dybdekurver, ${grn} grunner, ${lnt} lanterner)`)
    }
    if (!haveAuthoritativeSea) sourceParts.push('OSM natural=water beholdt for sjø')
    if (useCoastlineFallback) sourceParts.push('coastline-rekonstruksjon aktiv')
    const source = sourceParts.join(' + ')
    buildProgress.value = `Bygger SVG fra ${elements.length} elementer (kilde: ${source}) …`
    buildState.value = 'building'

    // v7.1.0: deteksjon av "kyst-situasjon". Hvis bbox-en har coastline-
    // ways ELLER autoritativ sjø-data, gir det mening å spørre brukeren
    // om karttype-fokus (land-tur eller padle/båt). Innlandsbboxer går
    // automatisk videre med 'land'.
    const isCoastal = hasCoastline || haveAuthoritativeSea
    detectedCoastline.value = isCoastal

    // Lagre alle data vi trenger for siste pass (etter eventuelt
    // karttype-valg). Vi starter ikke DEM-fetch før vi vet vi skal
    // generere — sparer båndbredde hvis brukeren vil avbryte.
    pendingFetchedData.value = {
      elements, source, isCoastal, useCoastlineFallback,
      // v7.1.5: feilmeldinger fra Sjøkart-WFS-fetcher gis videre til
      // mapBuilder så de kan eksponeres i meta og MapView UI.
      sjokartFetchErrors: sjokart?.fetchErrors ?? [],
      // v7.1.10: response-samples for å diagnose hva serveren faktisk
      // sender når vi får 0 features.
      sjokartDebugSamples: sjokart?.debugSamples ?? [],
    }

    // Hvis kyst-situasjon OG ingen lagret preferanse: vis dialog og vent.
    // Ellers: bruk preferanse (eller default 'land' for innland).
    let chosenType = mapTypePreference.value
    if (isCoastal && !chosenType) {
      buildState.value = 'awaiting-map-type'
      return  // venter på chooseMapType()
    }
    if (!chosenType) chosenType = 'land'
    await proceedWithMapType(chosenType)
  } catch (e) {
    buildState.value = 'error'
    buildError.value = e.message ?? 'Bygging feilet'
  }
}

// Kalles når brukeren velger karttype i dialogen, ELLER automatisk
// fra generateMap når vi har lagret preferanse / ikke-kyst-bbox.
async function chooseMapType(mapType) {
  if (rememberMapType.value) {
    try { localStorage.setItem(MAP_TYPE_KEY, mapType) } catch (e) { /* QuotaExceeded osv */ }
    mapTypePreference.value = mapType
  }
  await proceedWithMapType(mapType)
}

async function proceedWithMapType(mapType) {
  if (!pendingFetchedData.value) return
  const { elements, source, useCoastlineFallback, sjokartFetchErrors, sjokartDebugSamples } = pendingFetchedData.value
  pendingFetchedData.value = null
  buildState.value = 'building'
  buildProgress.value = `Bygger ${mapType === 'sea' ? 'sjø' : 'land'}-kart …`

  try {
    const sw = wgs84ToUtm32(bbox.value.south, bbox.value.west)
    const ne = wgs84ToUtm32(bbox.value.north, bbox.value.east)
    const utmBbox = {
      minE: Math.min(sw.e, ne.e), maxE: Math.max(sw.e, ne.e),
      minN: Math.min(sw.n, ne.n), maxN: Math.max(sw.n, ne.n),
    }
    buildProgress.value = `Henter høydedata fra Kartverket …`
    await new Promise(r => setTimeout(r, 30))
    const dem = await fetchDEM(bbox.value, utmBbox, { resolutionM: 10, useReal: true })

    const { svg, counts, meta } = buildSvg(elements, bbox.value, {
      dem, contourIntervalM: equidistanceM.value, scaleDenom: 10000,
      skipContoursIfSynthetic: true,
      useCoastlineFallback,
      mapType,
      sjokartFetchErrors,
      sjokartDebugSamples,
    })

    buildProgress.value = `Lagrer kart …`
    buildState.value = 'saving'

    const id = generateMapId()
    const navn = customName.value.trim() || center.value.name || 'Uten navn'

    // v7.2.0: Persistere DEM med kartet (for CurveBall-fysikk og fremtidige
    // DEM-baserte features). Hopper over for syntetisk DEM siden den ikke
    // representerer ekte terreng.
    const isRealDem = dem && !dem.source?.startsWith('synthetic')
    const packedDem = isRealDem ? packDem(dem) : null
    const highestPoint = isRealDem ? findHighestPoint(dem) : null

    const entry = {
      id,
      navn,
      bbox: bbox.value,
      center: { ...center.value },
      halfKm: halfKm.value,
      mapType,            // v7.1.0: lagre brukerens valg
      counts,
      svg,
      source,
      annotations: [],
      dem: packedDem,         // v7.2.0: ArrayBuffer + meta, eller null
      highestPoint,           // v7.2.0: {svgX, svgY, elevation} eller null
      opprettet: Date.now(),
    }
    await saveMap(entry)
    // v7.4.1: hvis kartet er bygget fra en delingslenke → marker for auto-
    // start av spillet i ny MapView. Brukeren skal rett inn i spillet, ikke
    // måtte tappe Curves-tema og deretter CurveBall-knappen.
    // v8.0.0: ny key, fjern legacy så vi ikke ender med to verdier.
    if (challenge.value) {
      try {
        sessionStorage.setItem('curveball-autostart-mapId', id)
        sessionStorage.removeItem('flippkart-autostart-mapId')
      } catch { /* QuotaExceeded */ }
    }
    router.push({ name: 'kart-vis', params: { id } })
  } catch (e) {
    buildState.value = 'error'
    buildError.value = e.message ?? 'Bygging feilet'
  }
}

function cancelMapTypeChoice() {
  pendingFetchedData.value = null
  buildState.value = 'idle'
  buildProgress.value = ''
}

function clearMapTypePreference() {
  try { localStorage.removeItem(MAP_TYPE_KEY) } catch { /* ignore */ }
  mapTypePreference.value = null
}

// ── Preview med ekte Kartverket-tiler som bakgrunn ─────────────────────────
const previewRef = ref(null)
const previewSize = ref({ w: 0, h: 0 })
const previewZoom = computed(() => zoomForKm(halfKm.value * 2 + 2))

function measurePreview() {
  const r = previewRef.value?.getBoundingClientRect()
  if (r) previewSize.value = { w: r.width, h: r.height }
}

const tiles = computed(() => {
  if (!previewSize.value.w) return []
  return tileMosaic(
    center.value.lat, center.value.lon,
    previewZoom.value, previewSize.value
  )
})

// Pixel-størrelse av bbox-overlegget innen preview-en
const bboxOverlayPx = computed(() => {
  if (!previewSize.value.w) return { w: 0, h: 0 }
  const mPerPx = metersPerPixel(center.value.lat, previewZoom.value)
  const sizeM = halfKm.value * 2 * 1000
  return {
    w: sizeM / mPerPx,
    h: sizeM / mPerPx,
  }
})

// Pan + pinch på preview-en. Bruker drar kartet under den faste rammen.
// 1-touch (eller mus) = pan kartet (oppdaterer center.lat/lon). 2-touch
// = pinch-zoom (oppdaterer halfKm).
let lastDist = 0
let pinching = false
let panning = false
let panStart = null

function panShiftToCenter(dxPx, dyPx) {
  // Når kartet flyttes høyre med dxPx skal sentrum-punktet flyttes
  // VENSTRE i geografisk rom (kartet under flyttes til venstre).
  // I tile-rom: y øker nedover = lat synker.
  const mPerPx = metersPerPixel(center.value.lat, previewZoom.value)
  const dLat = (dyPx * mPerPx) / 111111
  const dLon = -(dxPx * mPerPx) / (111111 * Math.cos(center.value.lat * Math.PI / 180))
  return { dLat, dLon }
}

function onPreviewTouchStart(e) {
  if (isLocked.value) return
  if (e.touches.length === 2) {
    pinching = true
    panning = false
    lastDist = touchDist(e)
    e.preventDefault()
  } else if (e.touches.length === 1) {
    panning = true
    pinching = false
    panStart = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      lat: center.value.lat,
      lon: center.value.lon,
    }
  }
}
function onPreviewTouchMove(e) {
  if (isLocked.value) return
  if (pinching && e.touches.length === 2) {
    e.preventDefault()
    const d = touchDist(e)
    const ratio = d / lastDist
    const next = halfKm.value / ratio
    halfKm.value = Math.max(0.5, Math.min(5, next))
    lastDist = d
  } else if (panning && e.touches.length === 1 && panStart) {
    e.preventDefault()
    const dxPx = e.touches[0].clientX - panStart.x
    const dyPx = e.touches[0].clientY - panStart.y
    const { dLat, dLon } = panShiftToCenter(dxPx, dyPx)
    center.value = { ...center.value, lat: panStart.lat + dLat, lon: panStart.lon + dLon }
  }
}
function onPreviewTouchEnd(e) {
  if (e.touches.length < 2) pinching = false
  if (e.touches.length < 1) { panning = false; panStart = null }
}
function touchDist(e) {
  const dx = e.touches[0].clientX - e.touches[1].clientX
  const dy = e.touches[0].clientY - e.touches[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

// Desktop: musedrag = pan
function onPreviewMouseDown(e) {
  if (isLocked.value) return
  if (e.button !== 0) return
  panning = true
  panStart = {
    x: e.clientX, y: e.clientY,
    lat: center.value.lat, lon: center.value.lon,
  }
  e.preventDefault()
}
function onPreviewMouseMove(e) {
  if (isLocked.value) return
  if (!panning || !panStart) return
  e.preventDefault()
  const dxPx = e.clientX - panStart.x
  const dyPx = e.clientY - panStart.y
  const { dLat, dLon } = panShiftToCenter(dxPx, dyPx)
  center.value = { ...center.value, lat: panStart.lat + dLat, lon: panStart.lon + dLon }
}
function onPreviewMouseUp() {
  panning = false
  panStart = null
}
// Desktop: scroll-hjul = zoom (pinch-ekvivalent)
function onPreviewWheel(e) {
  if (isLocked.value) return
  e.preventDefault()
  const delta = e.deltaY > 0 ? 1.1 : 0.9
  const next = halfKm.value * delta
  halfKm.value = Math.max(0.5, Math.min(5, next))
}

onMounted(() => {
  challenge.value = parseShareQuery()
  nextTick(() => measurePreview())
  window.addEventListener('resize', measurePreview)
})
</script>

<template>
  <div class="relative w-full min-h-[100dvh] flex flex-col bg-[#0e1116] text-white/90">

    <!-- Toppbar -->
    <div class="relative shrink-0 px-3 py-3 flex items-center justify-between
                bg-zinc-900/80 border-b border-white/10 z-30">
      <button @click="router.push('/kart')"
              class="rounded-full w-10 h-10 flex items-center justify-center
                     bg-white/[0.04] border border-white/10 active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <div class="text-[14px] font-semibold">Nytt turkart</div>
      <div class="w-10 h-10"/>
    </div>

    <!-- v7.4.0: Banner ved share-link — pre-populer felter, vis utfordrer +
         spillforklaring så mottaker forstår hva de er invitert til.
         v7.4.2: alle valg låst (read-only). Eget X-button kansellerer
         utfordringen og frigjør feltene. -->
    <div v-if="challenge"
         class="relative mx-4 mt-4 rounded-xl border border-amber-300/40 bg-amber-500/10 px-4 py-3">
      <button @click="cancelChallenge"
              :aria-label="t('challenge.cancel')"
              class="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center
                     text-amber-200/70 hover:text-amber-100 hover:bg-amber-400/15
                     active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <div class="flex items-center gap-3 pr-8">
        <div class="shrink-0 w-10 h-10 rounded-full bg-amber-400/20 border border-amber-300/40
                    flex items-center justify-center text-amber-200 text-base font-bold tracking-widest">
          {{ challenge.name }}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-semibold text-amber-100">
            {{ t('challenge.from', { name: challenge.name }) }}
          </div>
          <div v-if="challenge.score !== null" class="text-[11px] text-amber-100/70">
            <template v-if="challenge.level">
              {{ t('challenge.scoreLevel', { score: challenge.score.toLocaleString('no-NO'), level: challenge.level }) }}
            </template>
            <template v-else>
              {{ t('challenge.score', { score: challenge.score.toLocaleString('no-NO') }) }}
            </template>
          </div>
        </div>
      </div>
      <div class="mt-2.5 text-[11px] text-white/70 leading-relaxed"
           v-html="challengeIntroHtml"></div>
      <div class="mt-2 text-[10px] text-white/45">
        {{ t('challenge.locked') }}
      </div>
    </div>

    <!-- v8.0.5: Test-kart-presets — én-tap utvalg av topografisk forskjellige
         kart for å enkelt teste Curve-Invaders-gameplay på flatt vs bratt vs
         lite vs stort terreng. Skjules i utfordringsmodus (alt er låst da). -->
    <div v-if="!isLocked" class="px-4 pt-4 pb-1">
      <label class="text-white/65 text-[11px] uppercase tracking-wide block mb-2">Test-kart</label>
      <div class="grid grid-cols-2 gap-2">
        <button v-for="p in TEST_PRESETS" :key="p.id"
                @click="applyTestPreset(p)"
                class="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10
                       hover:bg-white/[0.10] active:bg-white/[0.15] transition text-left">
          <span class="text-[18px] leading-none shrink-0">{{ p.icon }}</span>
          <span class="flex-1 min-w-0">
            <span class="block text-[12px] font-semibold text-white truncate">{{ p.label }}</span>
            <span class="block text-[10px] text-white/50 truncate">{{ p.desc }}</span>
          </span>
        </button>
      </div>
    </div>

    <!-- Søkefelt -->
    <div class="px-4 pt-4 pb-3 relative z-20">
      <label class="text-white/65 text-[11px] uppercase tracking-wide block mb-2">Sted, postnummer eller adresse</label>
      <div class="relative">
        <svg viewBox="0 0 24 24" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50"
             fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/>
        </svg>
        <input v-model="query" type="search" autocomplete="off" autocorrect="off"
               :readonly="isLocked" :disabled="isLocked"
               :placeholder="isLocked ? t('picker.searchLockedPlaceholder') : 'f.eks. Sognsvann, 0855, Vardåsen Asker'"
               class="w-full pl-10 pr-3 py-3 rounded-xl bg-white/[0.06] border border-white/15
                      text-[14px] placeholder-white/30 focus:outline-none focus:bg-white/12
                      focus:border-slate-300/50 transition disabled:opacity-50 disabled:cursor-not-allowed" />
        <div v-if="isSearching"
             class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-white/15
                    border-t-white/70 rounded-full animate-spin" />
      </div>

      <!-- Søkeresultater -->
      <Transition name="fade">
        <div v-if="showResults"
             class="absolute left-4 right-4 mt-1 rounded-xl bg-zinc-900/98 backdrop-blur
                    border border-white/10 shadow-2xl max-h-[50dvh] overflow-y-auto z-30">
          <div v-if="results.length === 0 && !isSearching"
               class="px-4 py-3 text-[13px] text-white/50">Ingen treff</div>
          <button v-for="r in results" :key="r.id"
                  @click="selectResult(r)"
                  class="w-full text-left px-4 py-2.5 active:bg-white/10 transition border-b
                         border-white/8 last:border-0">
            <div class="text-[13px] font-medium text-white truncate">{{ r.shortName }}</div>
            <div class="text-[11px] text-white/50 truncate">{{ r.name }}</div>
          </button>
        </div>
      </Transition>

      <div v-if="searchError" class="mt-2 text-[11px] text-slate-300">{{ searchError }}</div>
    </div>

    <!-- Valgt sted -->
    <div class="px-4 pb-2">
      <div class="rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3">
        <div class="text-[11px] text-white/50 uppercase tracking-wide mb-1">Sentrum av kart</div>
        <div class="flex items-baseline justify-between gap-3">
          <input v-model="customName"
                 type="text" placeholder="Navn på kart"
                 :readonly="isLocked"
                 class="flex-1 bg-transparent text-[15px] font-semibold focus:outline-none
                        placeholder-white/25 read-only:opacity-70" />
          <div class="text-[10px] text-white/50 tabular-nums shrink-0">
            {{ center.lat.toFixed(4) }}°N, {{ center.lon.toFixed(4) }}°E
          </div>
        </div>
      </div>
    </div>

    <!-- Mini-preview + bbox -->
    <div class="flex-1 px-4 pb-3 flex flex-col gap-3 min-h-0">
      <div class="text-white/65 text-[11px] uppercase tracking-wide">
        <template v-if="isLocked">{{ t('picker.previewLockedHint') }}</template>
        <template v-else>Forhåndsvisning — dra kartet for å plassere, pinch / scroll for størrelse</template>
      </div>
      <div ref="previewRef"
           class="flex-1 min-h-[220px] rounded-xl bg-zinc-800 border border-white/10 overflow-hidden
                  relative touch-none"
           :class="isLocked ? 'cursor-not-allowed opacity-90' : 'cursor-move'"
           @touchstart="onPreviewTouchStart"
           @touchmove="onPreviewTouchMove"
           @touchend="onPreviewTouchEnd"
           @touchcancel="onPreviewTouchEnd"
           @mousedown="onPreviewMouseDown"
           @mousemove="onPreviewMouseMove"
           @mouseup="onPreviewMouseUp"
           @mouseleave="onPreviewMouseUp"
           @wheel="onPreviewWheel">
        <!-- Ekte Kartverket-tiler som bakgrunn. Tiles flyttes når bruker drar
             (center oppdateres → tile-mosaikken regenereres rundt ny lat/lon). -->
        <img v-for="t in tiles" :key="t.url"
             :src="t.url" alt=""
             class="absolute pointer-events-none select-none"
             :style="{ left: t.leftPx + 'px', top: t.topPx + 'px', width: '256px', height: '256px' }"
             draggable="false" />

        <!-- Kvadratisk frame fast i sentrum. Brukeren drar kartet UNDER
             rammen for å velge utsnitt. Pinch / scroll endrer størrelse. -->
        <div class="absolute pointer-events-none border-2 border-slate-300 rounded-sm
                    shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
             :style="{
               width:  bboxOverlayPx.w + 'px',
               height: bboxOverlayPx.h + 'px',
               left:   (previewSize.w - bboxOverlayPx.w) / 2 + 'px',
               top:    (previewSize.h - bboxOverlayPx.h) / 2 + 'px',
               transition: 'width 200ms cubic-bezier(0.2,0.8,0.2,1), height 200ms cubic-bezier(0.2,0.8,0.2,1)',
             }">
          <div class="absolute inset-0 border border-slate-200/60 rounded-sm pointer-events-none"></div>
          <!-- Senter-kryss -->
          <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none">
            <div class="absolute top-1/2 left-0 right-0 h-0.5 bg-slate-400 -translate-y-1/2"></div>
            <div class="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-400 -translate-x-1/2"></div>
          </div>
        </div>

        <div class="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-zinc-900 text-[11px]
                    text-white border border-white/30 font-medium shadow-lg z-10">
          {{ sizeKm }} × {{ sizeKm }} km
        </div>
        <div class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-zinc-900/85 text-white/70 text-[8px]
                    text-white/75 border border-white/15 leading-tight pointer-events-none">
          © Kartverket
        </div>
      </div>

      <!-- Slider for størrelse -->
      <div class="rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3">
        <div class="flex items-center justify-between mb-2">
          <div class="text-[11px] text-white/50 uppercase tracking-wide">Bredde</div>
          <div class="text-[13px] font-medium tabular-nums">{{ sizeKm }} km</div>
        </div>
        <input type="range" min="0.5" max="5" step="0.25" v-model.number="halfKm"
               :disabled="isLocked"
               class="w-full accent-slate-400 disabled:opacity-50 disabled:cursor-not-allowed" />
        <div class="flex justify-between text-[10px] text-white/40 mt-1">
          <span>1 km</span><span>4 km</span><span>10 km</span>
        </div>
      </div>

      <!-- Ekvidistanse-velger -->
      <div class="rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3">
        <div class="flex items-center justify-between mb-2">
          <div class="text-[11px] text-white/50 uppercase tracking-wide">Høydekurver</div>
          <div class="text-[13px] font-medium tabular-nums">hver {{ equidistanceM }} m</div>
        </div>
        <div class="grid grid-cols-5 gap-1.5">
          <button v-for="opt in EQUIDISTANCE_OPTIONS" :key="opt.value"
                  :disabled="isLocked"
                  @click="equidistanceM = opt.value"
                  class="px-2 py-1.5 rounded-md border text-[11px] font-medium active:scale-95 transition
                         disabled:cursor-not-allowed disabled:opacity-50"
                  :class="equidistanceM === opt.value
                          ? 'bg-slate-400/20 border-slate-300/60 text-slate-100'
                          : 'bg-white/5 border-white/10 text-white/65'">
            {{ opt.label }}
          </button>
        </div>
        <div class="text-[10px] text-white/40 mt-1.5">
          {{ EQUIDISTANCE_OPTIONS.find(o => o.value === equidistanceM)?.desc }}
        </div>
      </div>
    </div>

    <!-- Bygg-knapp. v7.4.2: i utfordringsmodus heter den «Start Curve Invaders» —
         samme handler kjører bygg + auto-start-flagg, så MapView lander direkte
         i spillet med Curves-tema aktivert. v8.0.0: tekst kommer fra i18n.
         v8.0.1: brand-skrivemåte endret til «Curve Invaders» (med mellomrom). -->
    <div class="shrink-0 p-4 pb-6 bg-zinc-900/95 border-t border-white/10">
      <button @click="generateMap" :disabled="buildState !== 'idle' && buildState !== 'error'"
              class="w-full py-4 rounded-xl text-white font-semibold flex items-center justify-center gap-2
                     active:scale-[0.99] transition disabled:opacity-60"
              :class="isLocked
                      ? 'bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900'
                      : 'bg-slate-600 hover:bg-slate-500 disabled:bg-slate-800'">
        <div v-if="buildState !== 'idle' && buildState !== 'error'"
             class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
        <span v-if="buildState !== 'idle' && buildState !== 'error'">{{ buildProgress }}</span>
        <template v-else>
          <svg v-if="isLocked" viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
          <span>{{ isLocked ? t('button.startGame') : t('picker.makeMap') }}</span>
        </template>
      </button>
      <div v-if="buildError"
           class="mt-3 px-3 py-2 rounded-lg bg-slate-500/20 border border-slate-300/30
                  text-slate-100 text-[11px]">
        {{ buildError }}
      </div>
      <div class="mt-3 text-[10px] text-white/40 text-center flex items-center justify-center gap-2">
        <span>Henter data fra OpenStreetMap (ODbL) via Overpass API.</span>
        <template v-if="mapTypePreference">
          <span class="text-white/60">·</span>
          <span class="text-white/60">Lagret: {{ mapTypePreference === 'sea' ? '🌊 Sjøkart' : '🥾 Land-kart' }}</span>
          <button @click="clearMapTypePreference" class="text-sky-400/70 underline">Nullstill</button>
        </template>
      </div>
    </div>

    <!-- v7.1.0 Karttype-dialog (kyst-bbox uten lagret preferanse) -->
    <div v-if="buildState === 'awaiting-map-type'"
         class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
         @click.self="cancelMapTypeChoice">
      <div class="w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl p-5 space-y-4">
        <div>
          <h3 class="text-base font-semibold text-white">Velg karttype</h3>
          <p class="text-xs text-white/55 mt-1">
            Området har kystlinje. Land-kart er optimalisert for hike-tur, sjø-kart for padling/båt.
            Du kan ikke ha begge i samme kart — velg fokus.
          </p>
        </div>

        <div class="space-y-2">
          <button @click="chooseMapType('land')"
                  class="w-full text-left p-3 rounded-xl bg-amber-50/10 border border-amber-200/20
                         hover:bg-amber-50/15 active:scale-[0.99] transition">
            <div class="flex items-center gap-3">
              <span class="text-2xl">🥾</span>
              <div class="flex-1">
                <div class="text-sm font-semibold text-white">Land-kart (turkart)</div>
                <div class="text-[11px] text-white/55 mt-0.5">
                  Stier, vegetasjon, høydekurver, bygninger. Fokus på land-tur.
                </div>
              </div>
            </div>
          </button>

          <button @click="chooseMapType('sea')"
                  class="w-full text-left p-3 rounded-xl bg-sky-500/10 border border-sky-300/20
                         hover:bg-sky-500/15 active:scale-[0.99] transition">
            <div class="flex items-center gap-3">
              <span class="text-2xl">🌊</span>
              <div class="flex-1">
                <div class="text-sm font-semibold text-white">Sjøkart (padle/båt)</div>
                <div class="text-[11px] text-white/55 mt-0.5">
                  Sjø-blå bakgrunn, dybdekontur, sjømerker, lanterner. Fokus på vannveier.
                </div>
              </div>
            </div>
          </button>
        </div>

        <label class="flex items-center gap-2 text-[11px] text-white/60 cursor-pointer select-none">
          <input v-model="rememberMapType" type="checkbox" class="accent-slate-300" />
          Husk valget mitt — ikke spør neste gang
        </label>

        <button @click="cancelMapTypeChoice"
                class="w-full py-2 text-xs text-white/40 hover:text-white/70 transition">
          Avbryt
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

input[type="range"]::-webkit-slider-runnable-track {
  height: 4px; border-radius: 999px;
  background: rgba(255,255,255,0.15);
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px; height: 18px; border-radius: 999px;
  background: #a78bfa; margin-top: -7px;
  border: 2px solid #fff;
  box-shadow: 0 2px 8px rgba(167,139,250,0.5);
}
</style>
