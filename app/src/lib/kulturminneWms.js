// Offisielle kulturminner (Riksantikvaren / Askeladden) via WMS.
//
// Det finnes ingen offentlig, CORS-åpen vektor-API med geometri for de
// offisielle kulturminnene (api.ra.no/kulturminner gir geometry=null;
// kulturminnesok.no/api/v2 er intern uten CORS). Den eneste rene, CORS-åpne
// kilden er WMS-en `kart.ra.no/wms/kulturminner2` (raster). Se minne-notatet
// «askeladden-no-vector-api».
//
// Vi legger WMS-bildet som et <image> INNE i kart-SVG-ens UTM32-koordinatrom
// (EPSG:25832), så det roterer/zoomer/panner sammen med vektorene (ingen
// flytende-overlegg-alignment-risiko). Klikk → GetFeatureInfo (GML) for detaljer.
//
// Rene URL-byggere + GML-parser her (DOM-fri, testbar). MapView gjør DOM-biten.

const WMS_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_KULTURMINNE_WMS_URL) ||
  'https://kart.ra.no/wms/kulturminner2'

// Ikon-lagene er de som faktisk tegner punkt-markørene ved våre kart-skalaer
// (de stylede gruppe-lagene Lokaliteter/Enkeltminner ga tomt bilde). De er også
// de eneste som svarer på GetFeatureInfo (text/plain — se parseWmsFeatureInfo).
export const WMS_LAYERS = 'Lokalitetsikoner,Enkeltminneikoner'
const WMS_CRS = 'EPSG:25832'

function baseParams({ minE, minN, maxE, maxN, widthPx, heightPx, layers = WMS_LAYERS }) {
  // WMS 1.3.0 + projisert CRS (25832) → BBOX-akserekkefølge er E,N:
  // minE,minN,maxE,maxN (ingen lat/lon-swap som for EPSG:4326).
  return {
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    LAYERS: layers,
    CRS: WMS_CRS,
    BBOX: `${minE},${minN},${maxE},${maxN}`,
    WIDTH: String(Math.round(widthPx)),
    HEIGHT: String(Math.round(heightPx)),
    STYLES: '',
  }
}

/**
 * Bygg WMS GetMap-URL (transparent PNG) for kartets UTM32-extent.
 * @param {{minE,minN,maxE,maxN,widthPx,heightPx,layers?}} o
 */
export function buildWmsGetMapUrl(o) {
  const p = new URLSearchParams({
    ...baseParams(o),
    REQUEST: 'GetMap',
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
  })
  return `${WMS_BASE}?${p}`
}

/**
 * Bygg WMS GetFeatureInfo-URL for et klikk. i/j er pikselkoordinat i det samme
 * WIDTH×HEIGHT-rutenettet som GetMap. `buffer` gir tap-toleranse i piksler.
 * @param {{minE,minN,maxE,maxN,widthPx,heightPx,i,j,layers?,buffer?,featureCount?,infoFormat?}} o
 */
export function buildWmsGetFeatureInfoUrl(o) {
  const p = new URLSearchParams({
    ...baseParams(o),
    REQUEST: 'GetFeatureInfo',
    QUERY_LAYERS: o.layers ?? WMS_LAYERS,
    // text/plain: MapServer-en har ikke GML-mal (gml gir tomt msGMLOutput), men
    // text/plain gir «key = 'value'»-par vi parser i parseWmsFeatureInfo.
    INFO_FORMAT: o.infoFormat ?? 'text/plain',
    I: String(Math.round(o.i)),
    J: String(Math.round(o.j)),
    FEATURE_COUNT: String(o.featureCount ?? 8),
    BUFFER: String(o.buffer ?? 12),
    FORMAT: 'image/png',
  })
  return `${WMS_BASE}?${p}`
}

/**
 * Parser MapServer sitt GetFeatureInfo text/plain-format:
 *
 *   GetFeatureInfo results:
 *   Layer 'Lokalitetsikoner'
 *     Feature 48670:
 *       navn = 'Hurumprosjektet - R45'
 *       kulturminneid = '48670-1'
 *       ...
 *
 * Returnerer én liste med feature-egenskaps-objekter (ett pr «Feature N:»).
 * Ren streng-parsing → enhetstestbar i Node.
 * @param {string} text
 * @returns {Array<Object>}
 */
export function parseWmsFeatureInfo(text) {
  if (!text || typeof text !== 'string') return []
  const out = []
  let cur = null
  for (const line of text.split('\n')) {
    if (/^\s*Feature\s+\S+:/.test(line)) {
      cur = {}
      out.push(cur)
      continue
    }
    // «  key = 'value'» (verdien er hele resten mellom første og siste ' på linja)
    const m = line.match(/^\s{2,}([A-Za-zæøå_]+)\s*=\s*'(.*)'\s*$/)
    if (m && cur) {
      const key = m[1]
      const val = m[2].trim()
      if (val && cur[key] === undefined) cur[key] = val
    }
  }
  return out.filter((f) => Object.keys(f).length)
}

// Hent ut de mest relevante feltene fra et parset feature-objekt (SOSI-feltnavn
// fra Askeladden-WMS-en). Case-insensitivt nøkkel-oppslag med fallbacks.
export function summarizeKulturminne(fields) {
  if (!fields) return null
  const get = (...names) => {
    for (const n of names) {
      const k = Object.keys(fields).find((key) => key.toLowerCase() === n.toLowerCase())
      if (k && fields[k]) return fields[k]
    }
    return null
  }
  const kid = get('kulturminneid', 'lokalid', 'lokalitetid')
  const link = get('linkkulturminnesok')
  return {
    navn: get('navn', 'name'),
    art: get('enkeltminneart', 'lokalitetsart', 'enkeltminnekategori', 'lokaliteteskategori'),
    datering: get('datering', 'dateringtekst'),
    vernetype: get('vernetype', 'vernestatus'),
    kommune: get('kommune', 'kommunenavn'),
    informasjon: get('informasjon', 'beskrivelse'),
    // lokalitet-id = sifrene før en evt. bindestrek i kid (48670-1 → 48670)
    lokalitetid: kid ? (String(kid).split('-')[0].replace(/\D/g, '') || null) : null,
    link: link && /^https?:\/\//i.test(link) ? link : null,
    raw: fields,
  }
}

/** Kulturminnesøk-lenke for en lokalitet-id. */
export function kulturminnesokLokalitetUrl(lokalitetid) {
  return lokalitetid ? `https://kulturminnesok.no/ra/lokalitet/${encodeURIComponent(lokalitetid)}` : null
}
