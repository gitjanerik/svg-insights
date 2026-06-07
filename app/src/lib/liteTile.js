// liteTile.js — bygg en lett 3×3-periferi-flis (v9.3.40, v10.1.7).
//
// Periferi-flisene rundt midt-flisen viser stier + vann + MARKDEKKE (skog/eng/
// åker/myr — flate ISOM-farger via tag-basert classifyToIsom, se buildOverpass-
// QueryLite). v10.1.7: markdekket lagt til så det grønne/bakken flyter sømløst
// over flis-grensa i stedet for å stoppe brått mot bar kremfarge (rektangel-
// effekten). Fortsatt ingen DEM ⇒ ingen konturer/relieff/knaus (CHM-basert
// tetthets-klassifisering 405–408 skjer kun i midt-flisen), ingen bygninger/
// navn/POI. Resultatet er en liten vektor-SVG i samme meter-rom som
// hovedkartet (origo i flisens NV-hjørne, 1 enhet = 1 m), som MapView plasserer
// på flisens offset i den delte transform-containeren.
//
// Lazy + cachet: MapView kaller denne for naboer som ikke alt ligger i
// TileLRU-cachen, idle etter at brukeren har «landet» på en midt-flis.

import { fetchOverpass, buildOverpassQueryLite } from './mapBuilder.js'
import { buildSvgClient } from './buildSvgClient.js'

/**
 * Hent + bygg en lett periferi-flis for en WGS84-bbox.
 *
 * @param {{south,west,north,east}} bbox
 * @param {{ signal?: AbortSignal, utmBbox?: {minE,maxE,minN,maxN} }} [opts]
 * @returns {Promise<string>} SVG-streng (kun stier + vann)
 */
export async function buildLiteTile(bbox, { signal, utmBbox = null } = {}) {
  const osm = await fetchOverpass(bbox, { signal, query: buildOverpassQueryLite(bbox) })
  const { svg } = await buildSvgClient(osm.elements ?? [], bbox, {
    dem: null,                  // ingen DEM ⇒ ingen konturer/relieff/knaus/cliffs
    utmBbox,                    // eksakt rutenett-bboks fra neighborTiles → flukter med midt-flisen
    scaleDenom: 10000,
    includeCliffs: false,
    includeKnauser: false,
    includeBuildingMass: false,
    skipDemSea: true,
  }, { signal })
  return svg
}
