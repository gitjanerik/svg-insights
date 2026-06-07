// tileGrid.js — geometri for 3×3-fliskartet (v9.3.40).
//
// «Turkart»-visningen viser ÉN full midt-flis (alle detaljer) omgitt av 8
// periferi-fliser som kun viser stier + vann (lett vektor). Dette modulen er
// REN geometri: den regner ut naboflisenes bbokser og deres meter-offset
// relativt midt-flisen, så de kan plasseres pikselperfekt i delt SVG-meter-rom
// (samme transform som hovedkartet panner/zoomer/roterer). Ingen DOM, ingen
// nettverk — alt det ligger i integrasjonslaget (MapView + liteTile).
//
// Konvensjon: SVG-meter-rommet har origo i kartets NORDVEST-hjørne, x mot øst,
// y mot SØR (nord opp = mindre y). UTM har nord oppover (større N). Derfor
// y-offset = ΔN med motsatt fortegn.

import { utm32ToWgs84 } from './utm.js'

/** Flis-størrelse (m) fra en UTM-bbox. */
export function tileSize(utmBbox) {
  return {
    w: utmBbox.maxE - utmBbox.minE,
    h: utmBbox.maxN - utmBbox.minN,
  }
}

/**
 * Grid-nøkkel for en flis: senter snappet til heltalls flis-koordinater. Samme
 * utsnitt får samme nøkkel uansett delpiksel-drift → brukes som LRU-cache-nøkkel
 * så en flis ikke bygges på nytt når man beveger seg tilbake til den.
 */
export function tileKey(utmBbox) {
  const { w, h } = tileSize(utmBbox)
  const cx = (utmBbox.minE + utmBbox.maxE) / 2
  const cy = (utmBbox.minN + utmBbox.maxN) / 2
  return `${Math.round(cx / w)}:${Math.round(cy / h)}`
}

/**
 * De 8 naboflisene rundt en midt-flis. Hver nabo er en EKSAKT tilstøtende bboks
 * av samme størrelse (ingen overlapp, ingen glipe), så de flukter pikselperfekt.
 *
 * @param {{minE:number,maxE:number,minN:number,maxN:number}} centerUtmBbox
 * @returns {Array<{
 *   dx:number, dy:number,                 // verdens-retning: dx øst, dy nord (∈ −1,0,1)
 *   utmBbox:{minE,maxE,minN,maxN},
 *   bbox:{south,west,north,east},         // WGS84 (for Overpass)
 *   offsetM:{x:number,y:number},          // naboens NV-hjørne i SVG-meter rel. midt-flisen
 *   key:string,
 * }>}
 */
export function neighborTiles(centerUtmBbox) {
  const { w, h } = tileSize(centerUtmBbox)
  const out = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const minE = centerUtmBbox.minE + dx * w
      const maxE = minE + w
      const minN = centerUtmBbox.minN + dy * h
      const maxN = minN + h
      const utmBbox = { minE, maxE, minN, maxN }
      const sw = utm32ToWgs84(minE, minN)
      const ne = utm32ToWgs84(maxE, maxN)
      const bbox = { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon }
      // NV-hjørne (minE, maxN) rel. midt-flisens NV-hjørne (minE, maxN).
      // x = ΔE (øst positiv). y = −ΔN (nord opp ⇒ nordlig nabo får negativ y).
      const offsetM = {
        x: minE - centerUtmBbox.minE,
        y: centerUtmBbox.maxN - maxN,
      }
      out.push({ dx, dy, utmBbox, bbox, offsetM, key: tileKey(utmBbox) })
    }
  }
  return out
}

/**
 * Liten LRU-cache for ferdigbygde fliser (maks `capacity`, default 9 = 3×3).
 * Nøkkel = tileKey. `get` markerer som nylig brukt; `set` skyver ut den eldste
 * når kapasiteten er nådd og returnerer den utskøvne entry-en (så kalleren kan
 * rydde DOM/SVG). Holder minnet bundet uansett hvor langt brukeren panner.
 */
export class TileLRU {
  constructor(capacity = 9) {
    this.capacity = capacity
    this.map = new Map()   // Map bevarer innsettings-/bruks-rekkefølge
  }
  has(key) { return this.map.has(key) }
  get(key) {
    if (!this.map.has(key)) return undefined
    const v = this.map.get(key)
    this.map.delete(key)        // re-innsett bakerst = nylig brukt
    this.map.set(key, v)
    return v
  }
  /** Sett/oppdater. Returnerer evt. utskøvet { key, value } eller null. */
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value
      const oldestValue = this.map.get(oldestKey)
      this.map.delete(oldestKey)
      return { key: oldestKey, value: oldestValue }
    }
    return null
  }
  keys() { return [...this.map.keys()] }
  values() { return [...this.map.values()] }
  delete(key) { return this.map.delete(key) }
  clear() { this.map.clear() }
  get size() { return this.map.size }
}
