// MCP-server (PoC) for SVG Insights — eksponerer kart-pipelinen og
// ruteplanleggingen som verktøy over stdio. Se docs/MCP_CASE_STUDY.md.
//
// Kjør: node mcp/server.js  (eller npm run mcp fra app/)
// Registrert for Claude Code i repo-rotens .mcp.json.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { buildMapHeadless, routableFeaturesFromSvg, extractMapPoiFromSvg } from './headless.js'
import { filterPoi, POI_LABELS } from '../src/lib/mapPoi.js'
import { buildRoutingGraph, planRoutes, planRoutesThrough } from '../src/lib/routing.js'
import { wgs84ToSvg, svgToWgs84 } from '../src/lib/utm.js'
import { sampleProfile } from '../src/lib/elevationProfile.js'
import { sampleElevation } from '../src/lib/demSampling.js'
import { buildRouteGpx } from '../src/lib/gpxExport.js'
import { geocodePlace } from '../src/lib/geocode.js'
import { buildRouteOverlaySvg, injectOverlay, DEFAULT_OVERLAY_STYLE } from '../src/lib/routeOverlay.js'
import { applyMapSettings, resolveVisibleLayers, buildSettingsCss } from '../src/lib/mapSettingsApply.js'
import { LAYERS, LAYER_PRESETS } from '../src/lib/mapLayerCatalog.js'
import { STROKE_GROUPS } from '../src/lib/strokeOverrides.js'
import { enrichRoute } from '../src/lib/routeEnrichment.js'
import { routeCues, extractNamedPointsFromSvg } from '../src/lib/routeCues.js'
import { buildTripReportSvg, buildTripReportMarkdown } from '../src/lib/tripReport.js'
import { collectRedListed } from '../src/lib/redListNo.js'
import { fetchFredaKulturminner } from '../src/lib/kulturminneWfs.js'
import { fetchProtectedArea } from '../src/lib/verneFetcher.js'
import { fetchSpeciesSummary } from '../src/lib/gbifSpecies.js'

// Sist bygde kart + avledet tilstand, så rute-verktøyene slipper re-bygging.
const state = {
  map: null,        // { svg, dem, meta, counts, bbox, navn, svgPath }
  routingGraph: null,
  routes: [],       // siste planlegg_rute-resultat, refereres av eksporter_gpx
  // Visnings-innstillinger (juster_kart) — MCP-ens motstykke til drawer-
  // tilstanden i appen (Kartlag-fanen + Strek-knott/-panel). Holdes på tvers
  // av kall og påføres hver SVG som skrives; state.map.svg forblir urørt
  // (som i appen, der kartet er komplett og drawer-en styrer visningen).
  innstillinger: null,  // { preset?, lag?, strekSkala?, strek? } | null = urørt
}

// Påfør gjeldende innstillinger på en SVG som skal skrives til fil.
function svgForOutput(svg) {
  return state.innstillinger ? applyMapSettings(svg, state.innstillinger) : svg
}

// SVG-meter ↔ WGS84 trenger kartets UTM-forankring (samme form som gpxExport).
function svgMeta() {
  const { meta } = state.map
  return {
    minE: meta.utmBbox.minE,
    minN: meta.utmBbox.minN,
    widthM: meta.widthM,
    heightM: meta.heightM,
  }
}

function requireMap() {
  if (!state.map) {
    throw new Error('Ingen kart bygget ennå — kall bygg_kart først.')
  }
}

// User-Agent for Nominatim (kreves for ikke-nettleser-klienter).
const GEOCODE_UA = 'svg-insights-mcp/0.1 (turkart-generator)'

// Bygg (eller gjenbruk) routing-grafen for sist bygde kart. componentBridgeM=80
// kobler frakoblede sti-/vei-fragmenter til hovednettet (se lib/routing.js).
function ensureRoutingGraph() {
  if (!state.routingGraph) {
    const features = routableFeaturesFromSvg(state.map.svg)
    if (!features.length) throw new Error('Kartet inneholder ingen stier eller veier å rute på.')
    state.routingGraph = buildRoutingGraph(features, { snapM: 6, componentBridgeM: 80 })
  }
  return state.routingGraph
}

// Snap start/mål (WGS84) til grafen og planlegg ruter. Delt av planlegg_rute
// og tegn_rute_svg. Returnerer ruter + snappede noder (SVG-meter) + meta.
const MAX_SNAP_M = 150
function planBetween(start, maal) {
  const rg = ensureRoutingGraph()
  const meta = svgMeta()
  const a = wgs84ToSvg(start.lat, start.lon, meta)
  const b = wgs84ToSvg(maal.lat, maal.lon, meta)
  for (const [navn, p] of [['start', a], ['maal', b]]) {
    if (!insideMap(p)) throw new Error(`Punktet «${navn}» ligger utenfor kartet — bygg et større kart eller flytt punktet.`)
  }
  const aNode = rg.nearestNode([a.x, a.y])
  const bNode = rg.nearestNode([b.x, b.y])
  if (!aNode || aNode.distM > MAX_SNAP_M) throw new Error('Ingen sti/vei nær startpunktet (>150 m).')
  if (!bNode || bNode.distM > MAX_SNAP_M) throw new Error('Ingen sti/vei nær målpunktet (>150 m).')
  const found = planRoutes(rg, aNode.id, bNode.id)
  if (!found.length) throw new Error('Fant ingen rute mellom punktene (frakoblede sti-nett?).')
  return { found, meta, a, b, aNode, bNode }
}

// Rute gjennom en liste punkter [start, ...via, maal] (WGS84). Leddene før det
// siste rutes som korteste vei (fast prefiks som må innom hvert via-punkt);
// siste ledd gir 1–3 alternativer (planRoutes), så hvert forslag deler samme
// vei innom via-punktene men kan variere på siste strekk. Uten via-punkter
// oppfører den seg identisk med planBetween. Koordinater er i SVG-meter.
function planThrough(points) {
  const rg = ensureRoutingGraph()
  const meta = svgMeta()
  const snaps = points.map((ll, i) => {
    const p = wgs84ToSvg(ll.lat, ll.lon, meta)
    if (!insideMap(p)) throw new Error(`Punkt ${i + 1} ligger utenfor kartet — bygg et større kart eller flytt punktet.`)
    const node = rg.nearestNode([p.x, p.y])
    if (!node || node.distM > MAX_SNAP_M) throw new Error(`Ingen sti/vei nær punkt ${i + 1} (>150 m).`)
    return { p, node }
  })

  const found = planRoutesThrough(rg, snaps.map(s => s.node.id))
  if (!found.length) throw new Error('Fant ingen gjennomgående rute (frakoblet sti-nett eller via-punkt uten stiforbindelse?).')
  return { found, meta, snaps }
}

function insideMap(p) {
  const { meta } = state.map
  return p.x >= 0 && p.y >= 0 && p.x <= meta.widthM && p.y <= meta.heightM
}

// Gangtid etter Naismith — samme konstanter som useStifinner.estWalkMinutes.
function estWalkMinutes(lengthM, ascent = 0, descent = 0) {
  const min = lengthM / (4000 / 60) + ascent / 10 + descent / 30
  return Math.max(1, Math.round(min))
}

function climbFor(coordinates) {
  const profile = sampleProfile(
    { points: coordinates.map(([x, y]) => ({ x, y })) },
    state.map.dem,
  )
  return profile
    ? { ascent: Math.round(profile.totalAscent), descent: Math.round(profile.totalDescent) }
    : null
}

// Nedsampler en koordinatliste til maks n punkter (behold endepunktene).
function downsample(coords, n = 80) {
  if (coords.length <= n) return coords
  const out = []
  for (let i = 0; i < n; i++) {
    out.push(coords[Math.round((i * (coords.length - 1)) / (n - 1))])
  }
  return out
}

function jsonResult(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] }
}

// Rute-overlayets strekbredder skalert med én faktor (rutebreddeFaktor på
// tegn_rute_svg/turrapport_svg). Markører og etiketter beholder størrelsen.
function overlayStyleFor(faktor) {
  if (!Number.isFinite(faktor) || faktor === 1) return undefined
  const s = DEFAULT_OVERLAY_STYLE
  return {
    lineSelected: s.lineSelected * faktor,
    lineOther: s.lineOther * faktor,
    haloSelected: s.haloSelected * faktor,
    haloOther: s.haloOther * faktor,
    connector: s.connector * faktor,
  }
}

// Rødliste-oppslag fra disk (public/data/redlist-no.json, bygget av CI). Cachet;
// null hvis bundelen mangler → rødliste-seksjonen går i dvale (aldri oppdiktet).
let _redList
function loadRedListDisk() {
  if (_redList !== undefined) return _redList
  try {
    _redList = JSON.parse(readFileSync(new URL('../public/data/redlist-no.json', import.meta.url), 'utf8'))
  } catch { _redList = null }
  return _redList
}

// De ekte fetcherne pakket for enrichRoute (injiseres så lib-en er testbar).
const ENRICH_FETCHERS = {
  fetchFredaKulturminner: (bbox, o) => fetchFredaKulturminner(bbox, o),
  fetchProtectedArea: (lat, lon, o) => fetchProtectedArea(lat, lon, o),
  fetchSpeciesSummary: (geom, o) => fetchSpeciesSummary(geom, o),
}

// Planlegg rute gjennom punktene [start, ...via, maal], velg én, og berik den
// langs traséen (kulturminner/vern/arter). Delt av berik_rute og turrapport_svg.
async function planAndEnrich(points, { bufferM = 150, ruteIndeks = 0 } = {}) {
  const { found, meta, snaps } = planThrough(points)
  const sel = Math.min(ruteIndeks, found.length - 1)
  const route = found[sel].coordinates
  const enrichment = await enrichRoute(route, {
    toWgs84: (x, y) => svgToWgs84(x, y, meta),
    toSvg: (lat, lon) => wgs84ToSvg(lat, lon, meta),
    bufferM,
    fetchers: ENRICH_FETCHERS,
    collectRedListed,
    redListLookup: loadRedListDisk(),
  })
  return { found, sel, route, meta, snaps, enrichment }
}

const server = new McpServer({ name: 'svg-insights', version: '0.1.0' })

server.registerTool(
  'bygg_kart',
  {
    title: 'Bygg turkart',
    description:
      'Bygger et ISOM-inspirert turkart (SVG) for et område, med ekte Kartverket-terreng ' +
      '(DTM/DOM), OSM-stier/veier og N50-vann. Kartet holdes i minnet for planlegg_rute/' +
      'hoydeprofil/eksporter_gpx, og SVG-en skrives til fil. Bruk halfKm 1–5 for rask respons. ' +
      'Oppgi enten lat+lon, ELLER et stedsnavn i «sted» (geokodes via Nominatim).',
    inputSchema: {
      sted: z.string().optional().describe('Stedsnavn å geokode (f.eks. «Vardåsen, Asker») — alternativ til lat/lon'),
      lat: z.number().min(57).max(72).optional().describe('Senter-breddegrad (Norge)'),
      lon: z.number().min(4).max(32).optional().describe('Senter-lengdegrad (Norge)'),
      halfKm: z.number().min(0.5).max(10).default(2).describe('Halv kartbredde i km'),
      equidistanceM: z.number().optional().describe('Ekvidistanse i meter (auto hvis utelatt)'),
      navn: z.string().default('mcp-kart').describe('Kartnavn, brukes i filnavn'),
      filsti: z.string().optional().describe('Hvor SVG-en skrives (default: tmp)'),
    },
  },
  async ({ sted, lat, lon, halfKm, equidistanceM, navn, filsti }) => {
    let geokodet = null
    if (lat == null || lon == null) {
      if (!sted) throw new Error('Oppgi enten lat+lon eller et stedsnavn i «sted».')
      const treff = await geocodePlace(sted, { limit: 1, userAgent: GEOCODE_UA })
      if (!treff.length) throw new Error(`Fant ikke stedet «${sted}» via geokoding.`)
      geokodet = treff[0]
      lat = geokodet.lat
      lon = geokodet.lon
      if (navn === 'mcp-kart') navn = geokodet.shortName || sted
    }
    const built = await buildMapHeadless({ lat, lon, halfKm, equidistanceM })
    const slug = navn.replace(/[^a-z0-9æøå]+/gi, '-').toLowerCase()
    const svgPath = resolve(filsti ?? resolve(tmpdir(), 'svg-insights-mcp', `${slug}.svg`))
    mkdirSync(dirname(svgPath), { recursive: true })
    writeFileSync(svgPath, svgForOutput(built.svg))

    state.map = { ...built, navn, svgPath }
    state.routingGraph = null
    state.routes = []

    const { meta, counts } = built
    return jsonResult({
      status: 'ok',
      svgPath,
      geokodet: geokodet ? { navn: geokodet.name, lat, lon } : null,
      svgKb: Math.round(built.svg.length / 1024),
      kartStorrelseM: { bredde: Math.round(meta.widthM), hoyde: Math.round(meta.heightM) },
      terreng: {
        kilde: meta.demSource,
        ekvidistanseM: meta.equidistance,
        hoydeM: meta.elevationRange
          ? { min: Math.round(meta.elevationRange.min), maks: Math.round(meta.elevationRange.max) }
          : null,
        kyst: meta.coastal,
        dybdekilde: meta.depthSource,
      },
      featureAntall: counts,
    })
  },
)

server.registerTool(
  'planlegg_rute',
  {
    title: 'Planlegg fotrute',
    description:
      'Planlegger 1–3 fotruter mellom to punkter på sist bygde kart, langs stier og veier ' +
      '(ISOM-vektet Dijkstra — sti foretrekkes over vei, motorvei ekskluderes). Returnerer ' +
      'distanse, stigning/fall, estimert gangtid (Naismith) og rutepunkter i WGS84.',
    inputSchema: {
      start: z.object({ lat: z.number(), lon: z.number() }).describe('Startpunkt'),
      maal: z.object({ lat: z.number(), lon: z.number() }).describe('Målpunkt'),
    },
  },
  async ({ start, maal }) => {
    requireMap()
    const { found, meta, aNode, bNode } = planBetween(start, maal)

    state.routes = found
    return jsonResult({
      status: 'ok',
      snappingM: { start: Math.round(aNode.distM), maal: Math.round(bNode.distM) },
      ruter: found.map((r, i) => {
        const climb = climbFor(r.coordinates)
        return {
          indeks: i,
          type: r.shortest ? 'kortest' : 'sti-foretrukket',
          lengdeM: Math.round(r.lengthM),
          stigningM: climb?.ascent ?? null,
          fallM: climb?.descent ?? null,
          estimertGangtidMin: estWalkMinutes(r.lengthM, climb?.ascent, climb?.descent),
          punkterWgs84: downsample(r.coordinates).map(([x, y]) => {
            const ll = svgToWgs84(x, y, meta)
            return [Number(ll.lon.toFixed(6)), Number(ll.lat.toFixed(6))]
          }),
        }
      }),
    })
  },
)

server.registerTool(
  'hoydeprofil',
  {
    title: 'Høydeprofil',
    description:
      'Sampler terrenghøyde langs en linje av WGS84-punkter mot sist bygde karts DEM. ' +
      'Returnerer total stigning/fall, min/maks høyde og samplede høyder langs linjen.',
    inputSchema: {
      punkter: z
        .array(z.object({ lat: z.number(), lon: z.number() }))
        .min(2)
        .describe('Linje å profilere (minst 2 punkter)'),
    },
  },
  async ({ punkter }) => {
    requireMap()
    const meta = svgMeta()
    const points = punkter.map(p => {
      const s = wgs84ToSvg(p.lat, p.lon, meta)
      return { x: s.x, y: s.y }
    })
    if (!points.every(insideMap)) throw new Error('Minst ett punkt ligger utenfor kartet.')
    const profile = sampleProfile({ points }, state.map.dem)
    if (!profile) throw new Error('Klarte ikke å sample profil (mangler DEM?).')
    return jsonResult({
      status: 'ok',
      distanseM: Math.round(profile.totalDistM),
      stigningM: Math.round(profile.totalAscent),
      fallM: Math.round(profile.totalDescent),
      minHoydeM: Math.round(profile.minElev),
      maksHoydeM: Math.round(profile.maxElev),
      samples: profile.samples
        .filter((_, i) => i % 4 === 0)
        .map(s => ({ distM: Math.round(s.distM), hoydeM: s.elev == null ? null : Math.round(s.elev) })),
    })
  },
)

server.registerTool(
  'eksporter_gpx',
  {
    title: 'Eksporter GPX',
    description:
      'Eksporterer en rute fra siste planlegg_rute som GPX 1.1 (<rte> med <ele>), ' +
      'klar for Garmin/Strava/OsmAnd. Skriver filen til disk og returnerer stien.',
    inputSchema: {
      ruteIndeks: z.number().int().min(0).default(0).describe('Indeks fra planlegg_rute-svaret'),
      navn: z.string().default('MCP-rute').describe('Rutenavn i GPX-en'),
      filsti: z.string().optional().describe('Hvor GPX-en skrives (default: tmp)'),
    },
  },
  async ({ ruteIndeks, navn, filsti }) => {
    requireMap()
    const route = state.routes[ruteIndeks]
    if (!route) throw new Error(`Ingen rute med indeks ${ruteIndeks} — kall planlegg_rute først.`)
    const meta = svgMeta()
    const points = route.coordinates.map(([x, y]) => {
      const ll = svgToWgs84(x, y, meta)
      const ele = sampleElevation(state.map.dem, x, y)
      return [ll.lon, ll.lat, Number.isFinite(ele) ? ele : undefined]
    })
    const gpx = buildRouteGpx({ points, navn, opprettet: Date.now() })
    const slug = navn.replace(/[^a-z0-9æøå]+/gi, '-').toLowerCase()
    const gpxPath = resolve(filsti ?? resolve(tmpdir(), 'svg-insights-mcp', `${slug}.gpx`))
    mkdirSync(dirname(gpxPath), { recursive: true })
    writeFileSync(gpxPath, gpx)
    return jsonResult({
      status: 'ok',
      gpxPath,
      punkter: points.length,
      lengdeM: Math.round(route.lengthM),
    })
  },
)

server.registerTool(
  'sok_sted',
  {
    title: 'Søk sted (geokoding)',
    description:
      'Geokoder et fritekst-stedsnavn til koordinater via OpenStreetMap Nominatim ' +
      '(begrenset til Norge). Returnerer inntil `antall` treff med lat/lon, klar til ' +
      'bruk i bygg_kart / planlegg_rute. Slipper manuell koordinat-oppslag.',
    inputSchema: {
      sok: z.string().min(2).describe('Stedsnavn å søke etter (f.eks. «Wentzelhytta»)'),
      antall: z.number().int().min(1).max(10).default(5).describe('Maks antall treff'),
    },
  },
  async ({ sok, antall }) => {
    const treff = await geocodePlace(sok, { limit: antall, userAgent: GEOCODE_UA })
    if (!treff.length) throw new Error(`Ingen treff for «${sok}».`)
    return jsonResult({
      status: 'ok',
      treff: treff.map(t => ({
        navn: t.name,
        kortnavn: t.shortName,
        type: t.type,
        lat: Number(t.lat.toFixed(6)),
        lon: Number(t.lon.toFixed(6)),
      })),
    })
  },
)

server.registerTool(
  'tegn_rute_svg',
  {
    title: 'Tegn rute inn i kart-SVG',
    description:
      'Planlegger en fotrute mellom to punkter (valgfritt innom via-punkter) på sist bygde ' +
      'kart og tegner stiforslaget inn i kart-SVG-en i samme stil som appens Stifinner ' +
      '(hvit halo + semitransparent farget linje, grønn start / gule via / rød mål, stiplet ' +
      'connector til nærmeste sti). Skriver en ny SVG-fil og returnerer stien. Ett kall = ' +
      'ferdig kart med rute.',
    inputSchema: {
      start: z.object({ lat: z.number(), lon: z.number() }).describe('Startpunkt'),
      maal: z.object({ lat: z.number(), lon: z.number() }).describe('Målpunkt'),
      via: z.array(z.object({
        lat: z.number(), lon: z.number(),
        navn: z.string().optional(),
      })).optional().describe('Via-punkter ruten må innom (f.eks. en hytte/topp), i rekkefølge'),
      visAlle: z.boolean().default(true).describe('Tegn alle alternative ruter (ellers kun den valgte)'),
      ruteIndeks: z.number().int().min(0).default(0).describe('Hvilken rute som markeres/velges'),
      startNavn: z.string().optional().describe('Etikett ved startpunktet'),
      maalNavn: z.string().optional().describe('Etikett ved målpunktet'),
      rutebreddeFaktor: z.number().min(0.1).max(3).default(1)
        .describe('Skalerer rutestrekens bredde (1 = appens standard, 0.33 = tredjedel)'),
      navn: z.string().default('mcp-kart-rute').describe('Kartnavn, brukes i filnavn'),
      filsti: z.string().optional().describe('Hvor SVG-en skrives (default: tmp)'),
    },
  },
  async ({ start, maal, via, visAlle, ruteIndeks, startNavn, maalNavn, rutebreddeFaktor, navn, filsti }) => {
    requireMap()
    const viaPts = via ?? []
    const points = [start, ...viaPts, maal]
    const { found, meta, snaps } = planThrough(points)
    state.routes = found

    const sel = Math.min(ruteIndeks, found.length - 1)
    const routes = visAlle ? found : [found[sel]]
    const selectedIndex = visAlle ? sel : 0

    const startSnap = snaps[0], maalSnap = snaps[snaps.length - 1]
    const a = startSnap.p, b = maalSnap.p

    // Connector-streker: valgt punkt → snappet sti-node (som i Stifinner).
    const connectors = [
      { from: [a.x, a.y], to: startSnap.node.pos },
      { from: [b.x, b.y], to: maalSnap.node.pos },
    ]
    const markers = []
    if (startNavn) markers.push({ x: a.x, y: a.y, color: '#16a34a', label: startNavn, anchor: 'start' })
    // Via-punkter: gul markør med etikett (Wentzelhytta osv.).
    viaPts.forEach((v, i) => {
      const s = snaps[i + 1]
      markers.push({ x: s.p.x, y: s.p.y, color: '#f59e0b', label: v.navn, anchor: 'start' })
    })
    if (maalNavn) markers.push({ x: b.x, y: b.y, color: '#dc2626', label: maalNavn, anchor: 'end' })

    const overlay = buildRouteOverlaySvg({
      routes: routes.map(r => ({ coordinates: r.coordinates, shortest: r.shortest })),
      selectedIndex,
      connectors,
      markers,
      start: [a.x, a.y],
      dest: [b.x, b.y],
      style: overlayStyleFor(rutebreddeFaktor),
    })
    const svg = injectOverlay(svgForOutput(state.map.svg), overlay)

    const slug = navn.replace(/[^a-z0-9æøå]+/gi, '-').toLowerCase()
    const svgPath = resolve(filsti ?? resolve(tmpdir(), 'svg-insights-mcp', `${slug}.svg`))
    mkdirSync(dirname(svgPath), { recursive: true })
    writeFileSync(svgPath, svg)

    const valgt = found[sel]
    const climb = climbFor(valgt.coordinates)
    return jsonResult({
      status: 'ok',
      svgPath,
      svgKb: Math.round(svg.length / 1024),
      antallRuterTegnet: routes.length,
      valgtRute: {
        indeks: sel,
        type: valgt.shortest ? 'kortest' : 'sti-foretrukket',
        lengdeM: Math.round(valgt.lengthM),
        stigningM: climb?.ascent ?? null,
        fallM: climb?.descent ?? null,
        estimertGangtidMin: estWalkMinutes(valgt.lengthM, climb?.ascent, climb?.descent),
      },
      snappingM: { start: Math.round(startSnap.node.distM), maal: Math.round(maalSnap.node.distM) },
    })
  },
)

server.registerTool(
  'berik_rute',
  {
    title: 'Berik rute (kulturminner / vern / arter)',
    description:
      'Planlegger en rute (evt. innom via-punkter) på sist bygde kart og finner hva som ' +
      'ligger LANGS den: fredede kulturminner (Riksantikvaren), verneområder ruten går ' +
      'gjennom (Naturbase), og rødlistede arter i korridoren (GBIF × norsk rødliste). ' +
      'Hver kilde faller pent tilbake til tomt hvis den er utilgjengelig (se «kilder»).',
    inputSchema: {
      start: z.object({ lat: z.number(), lon: z.number() }).describe('Startpunkt'),
      maal: z.object({ lat: z.number(), lon: z.number() }).describe('Målpunkt'),
      via: z.array(z.object({ lat: z.number(), lon: z.number(), navn: z.string().optional() }))
        .optional().describe('Via-punkter ruten må innom, i rekkefølge'),
      bufferM: z.number().min(20).max(1000).default(150).describe('Korridor-bredde (halv) i meter'),
    },
  },
  async ({ start, maal, via, bufferM }) => {
    requireMap()
    const { found, sel, route, enrichment } = await planAndEnrich([start, ...(via ?? []), maal], { bufferM })
    const climb = climbFor(route)
    return jsonResult({
      status: 'ok',
      rute: {
        lengdeM: Math.round(found[sel].lengthM),
        stigningM: climb?.ascent ?? null,
        fallM: climb?.descent ?? null,
        estimertGangtidMin: estWalkMinutes(found[sel].lengthM, climb?.ascent, climb?.descent),
      },
      kulturminner: enrichment.kulturminner,
      reservater: enrichment.reservater,
      arter: enrichment.arter,
      kilder: enrichment.kilder,
    })
  },
)

server.registerTool(
  'turrapport_svg',
  {
    title: 'Turrapport (samle-SVG)',
    description:
      'Lager én komplett turrapport som SVG: kartutsnitt med ruten tegnet inn, høydeprofil, ' +
      'funn langs ruten (kulturminner / verneområder / rødlistede arter) og en veibeskrivelse ' +
      'med sti-kryss-varsler («ta til venstre ved …»). Skriver både SVG-en og en delbar ' +
      'Markdown-versjon (.md) til disk og returnerer stiene. Ett kall = ferdig oppsummering.',
    inputSchema: {
      start: z.object({ lat: z.number(), lon: z.number() }).describe('Startpunkt'),
      maal: z.object({ lat: z.number(), lon: z.number() }).describe('Målpunkt'),
      via: z.array(z.object({ lat: z.number(), lon: z.number(), navn: z.string().optional() }))
        .optional().describe('Via-punkter ruten må innom, i rekkefølge'),
      bufferM: z.number().min(20).max(1000).default(150).describe('Korridor-bredde (halv) i meter for funn'),
      ruteIndeks: z.number().int().min(0).default(0).describe('Hvilket rute-alternativ som brukes'),
      startNavn: z.string().optional().describe('Etikett ved start'),
      maalNavn: z.string().optional().describe('Etikett ved mål'),
      rutebreddeFaktor: z.number().min(0.1).max(3).default(1)
        .describe('Skalerer rutestrekens bredde (1 = appens standard, 0.33 = tredjedel)'),
      tittel: z.string().optional().describe('Rapport-tittel'),
      navn: z.string().default('turrapport').describe('Kartnavn, brukes i filnavn'),
      filsti: z.string().optional().describe('Hvor SVG-en skrives (default: tmp)'),
    },
  },
  async ({ start, maal, via, bufferM, ruteIndeks, startNavn, maalNavn, rutebreddeFaktor, tittel, navn, filsti }) => {
    requireMap()
    const viaPts = via ?? []
    const { found, sel, route, snaps, enrichment } = await planAndEnrich(
      [start, ...viaPts, maal], { bufferM, ruteIndeks })

    // Rute-overlay på kartet (samme stil som tegn_rute_svg).
    const startSnap = snaps[0], maalSnap = snaps[snaps.length - 1]
    const a = startSnap.p, b = maalSnap.p
    const connectors = [
      { from: [a.x, a.y], to: startSnap.node.pos },
      { from: [b.x, b.y], to: maalSnap.node.pos },
    ]
    const markers = []
    if (startNavn) markers.push({ x: a.x, y: a.y, color: '#16a34a', label: startNavn, anchor: 'start' })
    viaPts.forEach((v, i) => markers.push({ x: snaps[i + 1].p.x, y: snaps[i + 1].p.y, color: '#f59e0b', label: v.navn, anchor: 'start' }))
    if (maalNavn) markers.push({ x: b.x, y: b.y, color: '#dc2626', label: maalNavn, anchor: 'end' })
    const overlay = buildRouteOverlaySvg({
      routes: [{ coordinates: route, shortest: found[sel].shortest }],
      selectedIndex: 0, connectors, markers, start: [a.x, a.y], dest: [b.x, b.y],
      style: overlayStyleFor(rutebreddeFaktor),
    })
    const mapSvg = injectOverlay(svgForOutput(state.map.svg), overlay)

    // Høydeprofil + sti-kryss-varsler.
    const profile = sampleProfile({ points: route.map(([x, y]) => ({ x, y })) }, state.map.dem)
    const rg = ensureRoutingGraph()
    // POI-ene har transform-korrekte posisjoner (bedre kryss-anker enn rå
    // <text>-x/y); faller tilbake til alle tekst-etiketter om ingen POI finnes.
    const poi = extractMapPoiFromSvg(state.map.svg).map(p => ({ x: p.x, y: p.y, name: p.navn }))
    const namedPoints = poi.length ? poi : extractNamedPointsFromSvg(state.map.svg)
    const junctionAt = ([x, y]) => { const id = rg.nodeAt([x, y], 5); return id ? rg.graph.degree(id) >= 3 : false }
    const cues = routeCues(route, { junctionAt, namedPoints })

    const climb = climbFor(route)
    const lengthM = found[sel].lengthM
    const reportArgs = {
      title: tittel ?? `${startNavn ?? 'Start'} → ${maalNavn ?? 'Mål'}`,
      summary: {
        distanceM: lengthM, ascentM: climb?.ascent, descentM: climb?.descent,
        timeMin: estWalkMinutes(lengthM, climb?.ascent, climb?.descent),
        viaNavn: viaPts.map(v => v.navn).filter(Boolean),
      },
      enrichment, cues,
    }
    const svg = buildTripReportSvg({ ...reportArgs, mapSvg, profile })
    const md = buildTripReportMarkdown(reportArgs)

    const slug = navn.replace(/[^a-z0-9æøå]+/gi, '-').toLowerCase()
    const svgPath = resolve(filsti ?? resolve(tmpdir(), 'svg-insights-mcp', `${slug}.svg`))
    const mdPath = svgPath.replace(/\.svg$/i, '') + '.md'
    mkdirSync(dirname(svgPath), { recursive: true })
    writeFileSync(svgPath, svg)
    writeFileSync(mdPath, md)

    return jsonResult({
      status: 'ok',
      svgPath,
      mdPath,
      svgKb: Math.round(svg.length / 1024),
      rute: {
        lengdeM: Math.round(lengthM),
        stigningM: climb?.ascent ?? null,
        estimertGangtidMin: estWalkMinutes(lengthM, climb?.ascent, climb?.descent),
      },
      funn: {
        kulturminner: enrichment.kulturminner.length,
        reservater: enrichment.reservater.length,
        rodliste: enrichment.arter?.rodliste?.antall ?? null,
        veibeskrivelseSteg: cues.length,
      },
      kilder: enrichment.kilder,
    })
  },
)

// Gyldige nøkler listes i beskrivelsen så klienten slipper prøving/feiling —
// hentet fra SAMME katalog som appens drawer (mapLayerCatalog/strokeOverrides).
const LAG_DOC = LAYERS.map(l => `${l.key} (${l.label})`).join(', ')
const PRESET_KEYS = LAYER_PRESETS.map(p => p.key)
const STREK_DOC = STROKE_GROUPS.map(g => `${g.id} (${g.label})`).join(', ')

server.registerTool(
  'juster_kart',
  {
    title: 'Juster kartvisning (lag / preset / strek)',
    description:
      'Justerer visningen av sist bygde kart med SAMME valg som en bruker har i appens ' +
      'drawer: lag-toggles fra Kartlag-fanen, lag-presets, global strek-skala (Strek-knotten) ' +
      'og per-gruppe strektykkelse (Strek-panelet). Innstillingene huskes og påføres alle ' +
      'senere SVG-er (tegn_rute_svg / turrapport_svg / bygg_kart) til de nullstilles — som ' +
      'drawer-tilstand i appen. Kart-SVG-en på disk skrives om med innstillingene bakt inn. ' +
      `Lag-nøkler: ${LAG_DOC}, dybde (Sjøkart-dybde på hovedkartet). ` +
      `Strek-grupper: ${STREK_DOC}.`,
    inputSchema: {
      preset: z.enum(PRESET_KEYS).optional()
        .describe('Lag-forhåndsvalg (som preset-knappene i appen) — nullstiller tidligere lag-valg'),
      lag: z.record(z.boolean()).optional()
        .describe('Enkelt-lag av/på oppå preset/default, f.eks. {"kontur": false}'),
      strekSkala: z.number().min(0.1).max(3).optional()
        .describe('Global strek-skala (--stroke-scale), 1 = som bygget'),
      strek: z.record(z.number().min(0.4).max(3)).optional()
        .describe('Per-gruppe strek-multiplikator, f.eks. {"sti": 0.6} (0.4–3, 1 = nøytral)'),
      nullstill: z.boolean().default(false)
        .describe('Fjern alle innstillinger først (som «Nullstill» i Lag-fanen)'),
    },
  },
  async ({ preset, lag, strekSkala, strek, nullstill }) => {
    const prev = nullstill ? {} : (state.innstillinger ?? {})
    const next = {
      preset: preset ?? prev.preset,
      // Preset-trykk nullstiller enkelt-lag-valg (samme semantikk som appen).
      lag: preset ? { ...(lag ?? {}) } : { ...(prev.lag ?? {}), ...(lag ?? {}) },
      strekSkala: strekSkala ?? prev.strekSkala,
      strek: { ...(prev.strek ?? {}), ...(strek ?? {}) },
    }
    // Validerer nøkler (kaster med liste over gyldige ved feil).
    const visible = resolveVisibleLayers(next)
    buildSettingsCss(next)

    const neutral = !next.preset && !Object.keys(next.lag).length
      && next.strekSkala == null && !Object.keys(next.strek).length
    state.innstillinger = neutral ? null : next

    let svgPath = null
    if (state.map) {
      svgPath = state.map.svgPath
      writeFileSync(svgPath, svgForOutput(state.map.svg))
    }
    const skjulteLag = LAYERS.filter(l => !visible.has(l.key)).map(l => l.key)
    return jsonResult({
      status: 'ok',
      svgPath,
      innstillinger: state.innstillinger ?? 'nullstilt (som bygget)',
      skjulteLag,
      merknad: state.map
        ? 'Kart-SVG-en er skrevet om; innstillingene påføres også senere rute-/rapport-SVG-er.'
        : 'Ingen kart bygget ennå — innstillingene påføres når et kart bygges.',
    })
  },
)

server.registerTool(
  'finn_poi_paa_kart',
  {
    title: 'Finn interessepunkter på kartet',
    description:
      'Leser navngitte interessepunkter fra sist bygde kart — topper, hytter, vann, ' +
      'steder, områder og naturreservat — med koordinater. Bruk til å oppdage mål og ' +
      'via-punkter uten manuell koordinat-oppslag (mat rett inn i planlegg_rute / ' +
      'tegn_rute_svg / turrapport_svg). Filtrer på type og/eller fritekst-søk.',
    inputSchema: {
      typer: z.array(z.enum(Object.values(POI_LABELS)))
        .optional().describe('Begrens til typer, f.eks. ["topp","hytte","vann"]'),
      sok: z.string().optional().describe('Fritekst-filter på navnet'),
      maks: z.number().int().min(1).max(200).default(60).describe('Maks antall treff'),
    },
  },
  async ({ typer, sok, maks }) => {
    requireMap()
    const meta = svgMeta()
    const all = extractMapPoiFromSvg(state.map.svg)
    const filtered = filterPoi(all, { typer, sok })
      .map(p => {
        const ll = svgToWgs84(p.x, p.y, meta)
        return { navn: p.navn, type: p.type, lat: Number(ll.lat.toFixed(6)), lon: Number(ll.lon.toFixed(6)) }
      })
      .slice(0, maks)
    // Antall pr type (av alt funnet, før maks-cap) for en rask oversikt.
    const perType = {}
    for (const p of all) perType[p.type] = (perType[p.type] ?? 0) + 1
    return jsonResult({ status: 'ok', antall: filtered.length, perType, poi: filtered })
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('svg-insights MCP-server kjører (stdio)')
