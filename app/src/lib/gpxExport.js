// GPX 1.1-eksport av GPS-spor (v8.9.2). Konverterer SVG-koordinater
// tilbake til WGS84 via utm.js sin svgToWgs84() og bygger XML.
//
// GPX-spec: https://www.topografix.com/GPX/1/1/ — standardisert XML-format
// støttet av Strava, Komoot, Garmin, Suunto m.fl.

import { svgToWgs84 } from './utm.js'

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]))
}

/**
 * Bygg en GPX-tekst fra en track-entry.
 * @param {{ points: Array<{x:number,y:number,t:number,accM?:number}>, navn?:string, opprettet:number }} track
 * @param {{ minE:number, minN:number, widthM:number, heightM:number }} meta — kart-metadata (UTM-bbox)
 * @param {string} mapName — brukes som GPX `<metadata><name>`
 */
export function buildGpx(track, meta, mapName = 'SVG Insights tur') {
  if (!track?.points?.length) return ''
  const created = new Date(track.opprettet ?? Date.now()).toISOString()
  const trkName = escapeXml(track.navn || 'Tur ' + new Date(track.opprettet ?? Date.now()).toLocaleString('no-NO'))
  const points = track.points.map(p => {
    const ll = svgToWgs84(p.x, p.y, meta)
    const time = new Date(p.t).toISOString()
    const acc = p.accM != null ? `\n        <hdop>${(p.accM / 5).toFixed(1)}</hdop>` : ''
    return `      <trkpt lat="${ll.lat.toFixed(7)}" lon="${ll.lon.toFixed(7)}">
        <time>${time}</time>${acc}
      </trkpt>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SVG Insights"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(mapName)}</name>
    <time>${created}</time>
  </metadata>
  <trk>
    <name>${trkName}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`
}

/**
 * Last ned GPX-fil i nettleseren.
 */
export function downloadGpx(track, meta, mapName, fileName) {
  const text = buildGpx(track, meta, mapName)
  if (!text) return
  const blob = new Blob([text], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName ?? `${(mapName || 'tur').replace(/[^a-z0-9æøå]+/gi, '-').toLowerCase()}.gpx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Beregn total løpelengde i meter (sum av segment-distanser i SVG-rom,
 * der 1 unit = 1 m).
 */
export function trackLengthM(track) {
  const pts = track?.points
  if (!pts || pts.length < 2) return 0
  let sum = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x
    const dy = pts[i].y - pts[i - 1].y
    sum += Math.hypot(dx, dy)
  }
  return sum
}

/**
 * Varighet i ms mellom første og siste punkt.
 */
export function trackDurationMs(track) {
  const pts = track?.points
  if (!pts || pts.length < 2) return 0
  return pts[pts.length - 1].t - pts[0].t
}
