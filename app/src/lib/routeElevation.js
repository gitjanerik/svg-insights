// Høydeprofil for Ruteplanleggerens PLANLAGTE ruter (v12.1.14). Ren logikk
// (ingen DOM) — brukes av den interaktive profil-komponenten i skuffen og av
// den stiliserte SVG-eksporten. (Turkartets GPS-spor-profil i
// elevationProfile.js jobber i SVG-meter-rom mot lagret kart-DEM og er en
// annen datamodell — denne er lon/lat-nativ.)
//
// Høydekilder, i prioritert rekkefølge:
//  1. BRouter-geometrien selv — parseRoute beholder tredje koordinat
//     ([lon, lat, ele]), så ferske ruter har høyde gratis, uten ekstra kall.
//  2. Kartverket WCS DTM (demFetcher fra turkartet) — lagrede ruter mister
//     høyden ved DP-forenkling ved lagring, da samples terrenget langs
//     polylinjen i stedet (useRouteElevation.js). Syntetisk DEM skal ALDRI
//     brukes her (samme stance som skipContoursIfSynthetic: falske høyder er
//     verre enn ingen).

import { haversineM } from './brouterClient.js'
import { sampleElevation } from './demSampling.js'
import { wgs84ToUtm32 } from './utm.js'

// Alt utenfor Norges reelle høydespenn behandles som manglende måling
// (WCS-nodata er -9999; BRouter kan mangle tredje koordinat helt).
function validEle(v) {
  return Number.isFinite(v) && v > -500 && v < 3000
}

/** Kumulativ distanse (meter) langs [lon, lat, …]-punkter. */
export function cumulativeDistances(points) {
  const out = new Array(points.length)
  out[0] = 0
  for (let i = 1; i < points.length; i++) {
    out[i] = out[i - 1] + haversineM(
      { lat: points[i - 1][1], lon: points[i - 1][0] },
      { lat: points[i][1], lon: points[i][0] },
    )
  }
  return out
}

// Lineær interpolasjon over hull i høydeserien (kant-hull klampes til
// nærmeste målte verdi). Forutsetter minst én gyldig verdi (dekkes av
// coverage-sjekken i buildRouteProfile).
function fillGaps(eles) {
  const n = eles.length
  const out = eles.slice()
  let prev = -1
  for (let i = 0; i < n; i++) {
    if (!validEle(out[i])) continue
    if (prev < 0) {
      for (let j = 0; j < i; j++) out[j] = out[i]
    } else {
      for (let j = prev + 1; j < i; j++) {
        out[j] = out[prev] + ((out[i] - out[prev]) * (j - prev)) / (i - prev)
      }
    }
    prev = i
  }
  for (let i = prev + 1; i < n; i++) out[i] = out[prev]
  return out
}

// Glidende snitt (radius r) — BRouter-/DEM-høyder har meter-støy som ellers
// blåser opp stigningssummen.
function smooth(eles, r = 2) {
  if (r < 1 || eles.length < 3) return eles.slice()
  const out = new Array(eles.length)
  for (let i = 0; i < eles.length; i++) {
    let sum = 0, cnt = 0
    for (let j = Math.max(0, i - r); j <= Math.min(eles.length - 1, i + r); j++) { sum += eles[j]; cnt++ }
    out[i] = sum / cnt
  }
  return out
}

// Total stigning/fall med hysterese: småbølger under terskelen akkumuleres
// ikke (standard GPS-praksis — uten dette blir «stigning» kunstig høy).
export function ascentDescent(eles, thresholdM = 2) {
  let ref = eles[0]
  let up = 0, down = 0
  for (let i = 1; i < eles.length; i++) {
    const d = eles[i] - ref
    if (d >= thresholdM) { up += d; ref = eles[i] }
    else if (d <= -thresholdM) { down -= d; ref = eles[i] }
  }
  return { ascentM: Math.round(up), descentM: Math.round(down) }
}

// Nedsampling for tegning: behold første/siste eksakt, og pr bucket både
// min- og maks-punktet — topper og daler skal aldri forsvinne.
function downsample(samples, maxSamples) {
  if (samples.length <= maxSamples) return samples
  const buckets = Math.max(2, Math.floor(maxSamples / 2))
  const out = [samples[0]]
  const step = (samples.length - 2) / buckets
  for (let b = 0; b < buckets; b++) {
    const from = 1 + Math.floor(b * step)
    const to = Math.min(samples.length - 1, 1 + Math.floor((b + 1) * step))
    let lo = null, hi = null
    for (let i = from; i < to; i++) {
      if (!lo || samples[i].eleM < lo.eleM) lo = samples[i]
      if (!hi || samples[i].eleM > hi.eleM) hi = samples[i]
    }
    if (lo) out.push(...(lo === hi ? [lo] : (lo.dM <= hi.dM ? [lo, hi] : [hi, lo])))
  }
  out.push(samples[samples.length - 1])
  return out
}

/**
 * Bygg profil fra rutepunkter [lon, lat, ele?].
 * `segments` (parseRoute-format, {fromIdx, toIdx, gravel}) gir underlag pr
 * sample så profilen kan fargelegges grus/asfalt. Returnerer null når mindre
 * enn `minCoverage` av punktene har brukbar høyde (da må DEM-fallback til).
 */
export function buildRouteProfile(points, { segments = null, maxSamples = 480, minCoverage = 0.8 } = {}) {
  if (!Array.isArray(points) || points.length < 2) return null
  const rawEles = points.map((p) => p[2])
  const covered = rawEles.filter(validEle).length
  if (covered / points.length < minCoverage) return null

  const dists = cumulativeDistances(points)
  const eles = smooth(fillGaps(rawEles))
  const { ascentM, descentM } = ascentDescent(eles)

  let gravelAt = null
  if (Array.isArray(segments) && segments.length) {
    gravelAt = new Array(points.length).fill(null)
    for (const s of segments) {
      for (let i = s.fromIdx; i <= Math.min(s.toIdx, points.length - 1); i++) gravelAt[i] = !!s.gravel
    }
  }

  const samples = downsample(points.map((_, i) => ({
    dM: dists[i],
    eleM: eles[i],
    gravel: gravelAt ? gravelAt[i] : null,
  })), maxSamples)

  let minEle = Infinity, maxEle = -Infinity
  for (const s of samples) {
    if (s.eleM < minEle) minEle = s.eleM
    if (s.eleM > maxEle) maxEle = s.eleM
  }
  return {
    samples,
    lengthM: dists[dists.length - 1],
    minEle, maxEle, ascentM, descentM,
  }
}

/**
 * Sample høyder fra en DEM (fetchDEM-resultat) langs [lon, lat]-punkter.
 * DEM-en er hentet for `utmBbox` (EPSG:25832, rad 0 = nord) — punktene
 * konverteres til DEM-ens SVG-meter-rom og bilineær-samples via demSampling.
 * Returnerer nye punkter [lon, lat, ele] (ele = NaN utenfor/nodata).
 */
export function sampleElevationsFromDem(points, dem, utmBbox) {
  const heightM = utmBbox.maxN - utmBbox.minN
  return points.map((p) => {
    const u = wgs84ToUtm32(p[1], p[0])
    const ele = sampleElevation(dem, u.e - utmBbox.minE, heightM - (u.n - utmBbox.minN))
    return [p[0], p[1], ele]
  })
}

/**
 * Pent avrundet høydedomene for aksen: 5-meters-runding og et minste spenn
 * så flate ruter ikke zoomes inn til meter-støy.
 */
export function niceEleDomain(minEle, maxEle, { minSpanM = 40 } = {}) {
  let floor = Math.floor(minEle / 5) * 5
  let ceil = Math.ceil(maxEle / 5) * 5
  if (ceil - floor < minSpanM) {
    const missing = minSpanM - (ceil - floor)
    floor = Math.floor((floor - missing / 2) / 5) * 5
    ceil = floor + Math.ceil(minSpanM / 5) * 5
  }
  return { floor, ceil }
}

/**
 * Profil → SVG-path-data i en gitt boks {x0, y0, w, h}.
 * `runs` er linjestykker gruppert på underlag med delt grensepunkt så streken
 * er kontinuerlig; `areaD` er lukket flate under hele kurven. Underlag null
 * (ingen segmentdata) behandles som grus — samme regel som rutetegningen i
 * kartet (uniform oransje uten segmenter). xOf/yOf returneres for markører
 * og akseticks.
 */
export function profileToPathData(profile, box) {
  const { samples, lengthM } = profile
  const { floor, ceil } = niceEleDomain(profile.minEle, profile.maxEle)
  const xOf = (dM) => box.x0 + (lengthM > 0 ? (dM / lengthM) * box.w : 0)
  const yOf = (ele) => box.y0 + box.h - ((ele - floor) / (ceil - floor)) * box.h
  const pt = (s) => `${xOf(s.dM).toFixed(1)} ${yOf(s.eleM).toFixed(1)}`

  const runs = []
  let cur = null
  for (const s of samples) {
    const gravel = s.gravel !== false
    if (!cur || cur.gravel !== gravel) {
      const prev = cur ? cur.pts[cur.pts.length - 1] : null
      cur = { gravel, pts: prev ? [prev] : [] }
      runs.push(cur)
    }
    cur.pts.push(pt(s))
  }
  const baseY = (box.y0 + box.h).toFixed(1)
  return {
    eleFloor: floor,
    eleCeil: ceil,
    xOf,
    yOf,
    runs: runs
      .filter((r) => r.pts.length >= 2)
      .map((r) => ({ gravel: r.gravel, d: 'M' + r.pts.join(' L') })),
    areaD: `M${xOf(samples[0].dM).toFixed(1)} ${baseY} L` +
      samples.map(pt).join(' L') +
      ` L${xOf(samples[samples.length - 1].dM).toFixed(1)} ${baseY} Z`,
  }
}

/** Distanse-akseticks i km: pent steg som gir maks ~`maxTicks` ticks. */
export function distanceTicks(lengthM, maxTicks = 6) {
  const km = lengthM / 1000
  if (!(km > 0)) return []
  const step = [0.5, 1, 2, 5, 10, 20, 50, 100].find((s) => km / s <= maxTicks - 1) ?? 200
  const out = []
  for (let v = 0; v <= km + 1e-9; v += step) out.push(Math.round(v * 10) / 10)
  return out
}
