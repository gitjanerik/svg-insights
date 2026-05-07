// N50-data via Geonorge WFS. Forsøk å bruke åpne CORS-endepunkter;
// faller tilbake til OSM via fetchOverpass hvis WFS feiler.
//
// N50 har bedre dekning av norske turstier enn OSM (det er hovedgrunnen
// til å bruke det), og inkluderer 20m-konturer som vi kan supplementere
// med eller bruke i stedet for syntetiske/lavoppløste DEM-konturer.
//
// Kjente N50-tjenester:
//   - WFS: https://wfs.geonorge.no/skwms1/wfs.n50_kartdata
//   - OAPI: https://oapi-test.geonorge.no/...   (nyere, ofte CORS-OK)
//   - WMS-tiles for visuell preview (via tileBackground.js)
//
// CORS-status er ikke garantert; vi probe-r og fallback til OSM
// transparent.

import { fetchOverpass, bboxFromCenter } from './mapBuilder.js'

const N50_WFS = 'https://wfs.geonorge.no/skwms1/wfs.n50_kartdata'

const N50_LAYERS = {
  // Mapping fra N50-typenames til OSM-kompatible features
  // (forenklet — full N50 har 100+ kategorier)
  'app:Sti':            { tag: 'highway', value: 'path' },
  'app:Sti2':           { tag: 'highway', value: 'path' },
  'app:Traktorvei':     { tag: 'highway', value: 'track' },
  'app:Skogsbilveg':    { tag: 'highway', value: 'track' },
  'app:Innsjø':         { tag: 'natural', value: 'water' },
  'app:Havflate':       { tag: 'natural', value: 'water', extraTags: { water: 'sea', salt: 'yes' } },
  'app:ElvBekk':        { tag: 'waterway', value: 'stream' },
  'app:Myr':            { tag: 'natural', value: 'wetland' },
  'app:Skog':           { tag: 'natural', value: 'wood' },
  'app:Bygning':        { tag: 'building', value: 'yes' },
  'app:Høydekurve':     { tag: 'contour', value: 'yes' },
}

// Subset for vann-only fetch (autoritativ kilde for sjø/innsjø-rendering,
// erstatter OSM `natural=water`/`natural=coastline` siden OSM har dokumenterte
// data-kvalitets-issues på store norske innsjøer som Mjøsa, Setten, etc).
const N50_WATER_LAYERS = {
  'app:Innsjø':   { tag: 'natural', value: 'water' },
  'app:Havflate': { tag: 'natural', value: 'water', extraTags: { water: 'sea', salt: 'yes' } },
  'app:ElvBekk':  { tag: 'waterway', value: 'stream' },
}

/**
 * Hent N50-features for et bbox. Konverter til OSM-kompatibel form
 * slik at downstream-kode (classifyToIsom) fungerer uten endringer.
 *
 * Hvis WFS feiler, fall tilbake til Overpass.
 *
 * @param {{south,west,north,east}} bbox WGS84
 * @param {{ signal?: AbortSignal, fallbackToOsm?: boolean }} opts
 * @returns {Promise<{ source: 'n50'|'osm', elements: Array }>}
 */
export async function fetchN50OrFallback(bbox, opts = {}) {
  const { signal, fallbackToOsm = true } = opts

  try {
    const elements = await fetchN50(bbox, { signal })
    if (elements.length > 0) {
      return { source: 'n50', elements }
    }
    throw new Error('N50 returnerte 0 elementer')
  } catch (e) {
    if (!fallbackToOsm) throw e
    console.warn('N50 ikke tilgjengelig — bruker OSM:', e.message)
    const data = await fetchOverpass(bbox, { signal })
    return { source: 'osm', elements: data.elements ?? [] }
  }
}

async function fetchN50(bbox, opts = {}) {
  return fetchN50Layers(bbox, N50_LAYERS, opts)
}

/**
 * Hent KUN vann-features (Havflate, Innsjø, ElvBekk) fra N50.
 *
 * Brukes til å erstatte OSM's `natural=water` siden Kartverket har
 * korrekt skille mellom sjø og innsjø (OSM mistagger ofte store norske
 * innsjøer som natural=coastline → vår polygonisering blir kaotisk).
 *
 * @param {{south,west,north,east}} bbox  WGS84
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<Array>}  OSM-aktige elementer (way + relation),
 *                            klare for buildSvg()
 */
export async function fetchN50Water(bbox, opts = {}) {
  return fetchN50Layers(bbox, N50_WATER_LAYERS, opts)
}

async function fetchN50Layers(bbox, layers, opts = {}) {
  const elements = []
  for (const [typeName, mapping] of Object.entries(layers)) {
    try {
      const features = await fetchSingleLayer(bbox, typeName, opts)
      for (const feat of features) {
        const osmLike = geojsonToOsmLike(feat, mapping)
        if (osmLike) elements.push(osmLike)
      }
    } catch (e) {
      console.warn(`[N50] ${typeName} feilet: ${e.message}`)
      // Fortsett med andre lag — partial failure tolereres
    }
  }
  return elements
}

async function fetchSingleLayer(bbox, typeName, opts = {}) {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: typeName,
    SRSNAME: 'EPSG:4326',
    BBOX: `${bbox.south},${bbox.west},${bbox.north},${bbox.east},EPSG:4326`,
    OUTPUTFORMAT: 'application/json',
    COUNT: '5000',
  })
  const url = `${N50_WFS}?${params}`
  const res = await fetch(url, { signal: opts.signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  return json.features ?? []
}

function geojsonToOsmLike(feat, mapping) {
  const g = feat.geometry
  const tags = {
    [mapping.tag]: mapping.value,
    ...(mapping.extraTags ?? {}),
    ...(feat.properties ?? {}),
  }
  if (!g) return null
  if (g.type === 'LineString') {
    return {
      type: 'way',
      id: feat.id ?? Math.random(),
      geometry: g.coordinates.map(([lon, lat]) => ({ lat, lon })),
      tags,
    }
  }
  if (g.type === 'Polygon') {
    return {
      type: 'way',
      id: feat.id ?? Math.random(),
      geometry: g.coordinates[0].map(([lon, lat]) => ({ lat, lon })),
      tags,
    }
  }
  if (g.type === 'MultiPolygon') {
    return {
      type: 'relation',
      id: feat.id ?? Math.random(),
      members: g.coordinates.map(poly => ({
        type: 'way', role: 'outer',
        geometry: poly[0].map(([lon, lat]) => ({ lat, lon })),
      })),
      tags,
    }
  }
  if (g.type === 'Point') {
    return {
      type: 'node', id: feat.id ?? Math.random(),
      lat: g.coordinates[1], lon: g.coordinates[0], tags,
    }
  }
  return null
}

/**
 * Probe om N50 WFS er tilgjengelig fra denne klienten.
 * Returnerer true om bbox-spørring kan gjøres uten CORS-feil.
 */
export async function probeN50Available() {
  // Liten bbox over Oslo for testen
  const bbox = bboxFromCenter(59.91, 10.75, 0.1)
  try {
    await fetchN50(bbox, { signal: AbortSignal.timeout(5000) })
    return true
  } catch {
    return false
  }
}
