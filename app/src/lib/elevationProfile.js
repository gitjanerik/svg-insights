// Høydeprofil fra et GPS-spor (v8.9.4). Sampler DEM langs sporet, jevnt
// fordelt på avstand, og regner ut total stigning/fall + min/maks-høyde.
//
// Output:
//   samples       — array av { distM, elev } (elev kan være null ved noData)
//   totalDistM    — total løpelengde i meter
//   totalAscent   — sum av oppstigninger i meter (positive dz)
//   totalDescent  — sum av nedstigninger i meter (positive verdi for fall)
//   minElev, maxElev — i meter (Infinity hvis ingen valide samples)
//
// Buildes som ren JS så funksjonen kan testes uten DOM.

import { sampleElevation } from './demSampling.js'

const MAX_SAMPLES = 200
const TARGET_SAMPLE_INTERVAL_M = 5

/**
 * @param {{points: Array<{x:number,y:number}>}} track
 * @param {{data: Float32Array, cols: number, rows: number, transform: any, noData: number}} dem
 * @returns {null | { samples: Array<{distM:number, elev:number|null}>, totalDistM:number,
 *                    totalAscent:number, totalDescent:number, minElev:number, maxElev:number }}
 */
export function sampleProfile(track, dem) {
  const pts = track?.points
  if (!pts || pts.length < 2 || !dem) return null

  // Cumulative distance per track-point (samme rom som DEM = SVG-meter)
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  const totalDistM = cum[cum.length - 1]
  if (totalDistM <= 0) return null

  const wanted = Math.min(MAX_SAMPLES, Math.max(20, Math.floor(totalDistM / TARGET_SAMPLE_INTERVAL_M)))
  const samples = []
  let segIdx = 0

  for (let i = 0; i < wanted; i++) {
    const d = (totalDistM * i) / (wanted - 1)
    while (segIdx < cum.length - 2 && cum[segIdx + 1] < d) segIdx++
    const segStart = cum[segIdx]
    const segEnd = cum[segIdx + 1]
    const segLen = segEnd - segStart
    const t = segLen > 0 ? (d - segStart) / segLen : 0
    const a = pts[segIdx], b = pts[segIdx + 1]
    const x = a.x + (b.x - a.x) * t
    const y = a.y + (b.y - a.y) * t
    const elev = sampleElevation(dem, x, y)
    samples.push({ distM: d, elev: Number.isFinite(elev) ? elev : null })
  }

  // Stats: stigning/fall regnes på "smoothed" elevasjon for å unngå at
  // DEM-støy på desimeter-nivå akkumulerer kunstig stigning. 5-punkts
  // moving average er en grei kompromiss.
  const smoothed = movingAverage(samples.map(s => s.elev), 5)
  let totalAscent = 0, totalDescent = 0
  let minElev = Infinity, maxElev = -Infinity
  let prev = null
  for (let i = 0; i < smoothed.length; i++) {
    const e = smoothed[i]
    if (e == null) { prev = null; continue }
    if (e < minElev) minElev = e
    if (e > maxElev) maxElev = e
    if (prev != null) {
      const dz = e - prev
      if (dz > 0) totalAscent += dz
      else totalDescent -= dz
    }
    prev = e
  }
  if (!Number.isFinite(minElev)) { minElev = 0; maxElev = 0 }

  return { samples, totalDistM, totalAscent, totalDescent, minElev, maxElev }
}

function movingAverage(arr, window) {
  const half = Math.floor(window / 2)
  const out = new Array(arr.length).fill(null)
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      if (arr[j] != null) { sum += arr[j]; n++ }
    }
    if (n > 0) out[i] = sum / n
  }
  return out
}

/**
 * Bygg en SVG-path-d-streng for profilen, normalisert til (0,0) – (w,h)-rom.
 * Returnerer både linje-pathen (M…L…) og en lukket polygon-path (samme + L w h L 0 h Z)
 * for gradient-fyll under linjen.
 */
export function buildProfilePath(profile, w, h, padding = 4) {
  if (!profile || !profile.samples.length) return { line: '', area: '' }
  const { samples, totalDistM, minElev, maxElev } = profile
  const range = Math.max(1, maxElev - minElev)
  const ax = d => padding + (d / totalDistM) * (w - 2 * padding)
  const ay = e => h - padding - ((e - minElev) / range) * (h - 2 * padding)

  let line = ''
  const xy = []
  let started = false
  for (const s of samples) {
    if (s.elev == null) continue
    const x = ax(s.distM), y = ay(s.elev)
    line += (started ? ' L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1)
    xy.push({ x, y })
    started = true
  }
  if (!xy.length) return { line: '', area: '' }
  const first = xy[0], last = xy[xy.length - 1]
  const area = `${line} L${last.x.toFixed(1)},${(h - padding).toFixed(1)} L${first.x.toFixed(1)},${(h - padding).toFixed(1)} Z`
  return { line, area }
}
