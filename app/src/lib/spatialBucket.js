// Romlig bucketing av merge-de SVG-paths + data-bbox-emisjon.
//
// v8.10.4-merging slo alle features med samme stil sammen til ÉN mega-path
// per lag — suverent for DOM-tallet, men én path hvis bounds spenner hele
// kartet skjærer ALLE nettleserens raster-tiles, så hele geometrien
// prosesseres for hver tile ved hver re-raster (pinch-zoom, gest-slutt).
// Løsning: merge per stil × grid-celle i stedet for globalt. Buckets forblir
// i samme <g data-layer>-forelder (painter's order/lag-toggles urørt), og
// hver bucket-path får data-bbox="minX,minY,maxX,maxY" så både nettleserens
// tile-culling og viewport-cullingen i MapView (lib/viewportCull.js) får
// reelle, små bounds å jobbe med.
//
// Tildelingsregel: HEL feature per bucket (cellen som inneholder featurens
// bbox-senter), aldri geometri-splitting — bevarer evenodd-hull-semantikk,
// dash-fase på stiplede linjer og linecaps. En kart-kryssende feature blåser
// opp sin buckets bbox så den sjelden culles; akseptert degradering.
//
// Worker-trygg: ingen DOM-avhengigheter (buildSvg kjører i mapSvg.worker.js).

// Celle-størrelse i meter. Avveining (S22, 5×5 km-flis): ved navigasjons-zoom
// dekker viewporten + cull-margin ~2×2–4×4 av 5×5 celler → 50–85 % av
// bucket-pathene har bounds helt utenfor og hverken rastreres eller males.
// Mindre celler gir finere culling men flere DOM-noder; 1024 m holder
// path-tallet på noen hundre for en 5 km-flis.
export const CELL_M = 1024

/** Bbox (AABB) for en liste [x,y]-punkter. Null ved tom input. */
export function bboxOfPoints(pts) {
  if (!pts || !pts.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/** Union av to bbokser; tåler null i begge posisjoner. */
export function unionBbox(a, b) {
  if (!a) return b
  if (!b) return a
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

/**
 * Grid-celle-nøkkel for en feature: cellen som inneholder bbox-senteret.
 * Stabil "cx:cy"-streng til bruk i merge-signaturer.
 */
export function cellKeyFor(bbox, cellM = CELL_M) {
  if (!bbox) return '0:0'
  const cx = Math.floor((bbox.minX + bbox.maxX) / 2 / cellM)
  const cy = Math.floor((bbox.minY + bbox.maxY) / 2 / cellM)
  return `${cx}:${cy}`
}

/**
 * data-bbox-attributt-streng (med ledende mellomrom) for en bbox, formatert
 * med kallerens fmt (mapBuilder bruker toFixed(1) = 0.1 m). Tom streng for
 * null/ikke-finite bbox så kallere kan konkatener-e blindt.
 */
export function bboxAttr(bbox, fmt = (n) => n) {
  if (!bbox) return ''
  const vals = [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]
  if (!vals.every(Number.isFinite)) return ''
  return ` data-bbox="${vals.map(fmt).join(',')}"`
}
