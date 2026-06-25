// Vektor-relieff: terrengskygge som diskrete tone-bånd (polygoner) i stedet for
// en innbakt base64-PNG (<image>). Gjenbruker d3-contour (samme marching-squares
// som buildContours i dem.js) på selve shade-rasteret, og produserer noen få
// gråtone-bånd som rene SVG <path>. Resultatet er knivskarpt ved zoom/print,
// tema-bart, og bidrar med ~KB i SVG-en mot rasterets MB-er.
//
// Pikselverdiene i `shade` er 0..255 lyshet (1=lyst/sollys, 0=skygge), eksakt som
// computeHillshade() (hillshade.js) gir. Vi binner dem i N bånd; hvert bånd er
// ringen mellom to terskler (`s ≥ t_k` minus `s ≥ t_{k+1}`), bygget som ett
// even-odd-fylt polygon. Bånd-alfaen speiler shadeToToneRGBA-matematikken:
//   multiply (lyse tema): svart overlegg, alfa = 1 − s   (mørkest i skyggen)
//   screen   (mørke tema): hvitt overlegg, alfa = s
// så vektor-relieffet matcher rasterets intensitet bånd for bånd.

import { contours as d3Contours } from 'd3-contour'
import { simplifyDP, chaikin } from './pathUtils.js'

function fmt(n) { return Number(n.toFixed(1)) }

function ringsToPath(multiPolygon, sx, sy, cols, rows, widthM, heightM, tolM, smooth) {
  let d = ''
  for (const poly of multiPolygon) {
    for (const ring of poly) {
      // Detekter hele-raster-rammen (ringen som følger kartkanten). d3-contour
      // gir slike for enhver terskel under lokal min-skygge, og de spenner hele
      // rasteret. Chaikin-glattingen avfaser da rektangel-hjørnene til en oktagon,
      // og to nær-identiske rammer (region≥0 vs region≥t1) glattes litt ulikt →
      // differansen ble fire mørke hjørne-trekanter pr flis. Vi emitterer derfor
      // ramme-ringer som ET EKSAKT, skarpt rektangel — da kanselleres de presist
      // i even-odd, og ingen hjørne-artefakt oppstår. Indre kontur-former glattes
      // som før.
      let gminx = Infinity, gmaxx = -Infinity, gminy = Infinity, gmaxy = -Infinity
      for (const [x, y] of ring) {
        if (x < gminx) gminx = x; if (x > gmaxx) gmaxx = x
        if (y < gminy) gminy = y; if (y > gmaxy) gmaxy = y
      }
      const isFrame = gminx <= 1 && gmaxx >= cols - 1 && gminy <= 1 && gmaxy >= rows - 1
      if (isFrame) {
        d += `M0,0L${fmt(widthM)},0L${fmt(widthM)},${fmt(heightM)}L0,${fmt(heightM)}Z`
        continue
      }
      let pts = ring.map(([x, y]) => [x * sx, y * sy])
      if (pts.length > 4) {
        pts = simplifyDP(pts, tolM)
        if (smooth) pts = chaikin(pts, 1, true)
      }
      if (pts.length < 3) continue
      d += 'M' + pts.map((p) => fmt(p[0]) + ',' + fmt(p[1])).join('L') + 'Z'
    }
  }
  return d
}

/**
 * @param {{rgba: Uint8ClampedArray|number[], cols: number, rows: number}} shade  fra computeHillshade
 * @param {{bands?: number, blend?: 'multiply'|'screen', widthM: number, heightM: number, simplifyM?: number, smooth?: boolean}} opts
 * @returns {Array<{d: string, fill: string, fillOpacity: number}>}  bånd, mørkest først (tegnerekkefølge)
 */
export function buildReliefBands(shade, opts) {
  const { rgba, cols, rows } = shade
  const {
    bands = 5,
    blend = 'multiply',
    widthM,
    heightM,
    simplifyM,
    smooth = true,
  } = opts ?? {}

  const values = new Array(cols * rows)
  for (let i = 0; i < cols * rows; i++) values[i] = rgba[i * 4] / 255

  const sx = widthM / cols
  const sy = heightM / rows
  const tolM = simplifyM ?? Math.max(2, widthM / 400)
  const white = blend === 'screen'

  // Terskler t_k = k/bands for k = 0..bands-1. levels[k] = region (s ≥ k/bands).
  // Vi tar med k=0 (region ≥ 0 = hele rasteret) som ytre ramme for bånd 0 i
  // stedet for et manuelt rektangel: d3-contour avfaser hjørnene på regionene,
  // så et firkantet manuelt rektangel minus en avfaset region etterlot fire
  // mørke hjørne-trekanter (v11.0.50-bug). Nå avfaser ytre og indre likt → ingen
  // hjørne-artefakt.
  const thresholds = []
  for (let k = 0; k < bands; k++) thresholds.push(k / bands)
  const levels = d3Contours().size([cols, rows]).thresholds(thresholds)(values)

  const out = []
  for (let k = 0; k < bands; k++) {
    const sMid = (k + 0.5) / bands
    const alpha = white ? sMid : 1 - sMid
    if (alpha <= 0.001) continue

    // Ytre = region (s ≥ k/bands). Hull = region (s ≥ (k+1)/bands).
    let d = ringsToPath(levels[k].coordinates, sx, sy, cols, rows, widthM, heightM, tolM, smooth)
    if (k < bands - 1) d += ringsToPath(levels[k + 1].coordinates, sx, sy, cols, rows, widthM, heightM, tolM, smooth)

    if (!d) continue
    out.push({ d, fill: white ? '#ffffff' : '#000000', fillOpacity: Number(alpha.toFixed(3)) })
  }
  return out
}
