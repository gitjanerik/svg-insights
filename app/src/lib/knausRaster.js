// Knaus-relieff (ISOM 213, TPI-derivert fra DEM-en).
//
// v9.1.13: knaus males nå rett inn på HILLSHADE-canvaset (paintKnausDabs),
// så hele relieffet blir ÉN blendet <image> i DEM-oppløsning. Tidligere lå
// knaus i et eget høyoppløst raster (opptil 4096² ≈ 67 MB) — en alvorlig
// mobil-GPU-flaskehals siden to mix-blend-mode-teksturer måtte re-komponeres
// per pan/zoom-frame. Nå er det null ekstra tekstur: prikkene tegnes i samme
// cols×rows-canvas som skyggingen, og flukter eksakt med terrenget (1 px =
// 1 DEM-celle = de samme cellene computeHillshade allerede skygger).
//
// Prikken er en myk, kant-løs relieff-dab: mørk lobe mot SØ + lys mot NV
// (sol-azimut 315°, samme som computeHillshade). Under `multiply` (lyse tema)
// bærer skyggen, under `screen` (mørke tema) høylyset — leser som en liten
// naturlig kul i terrenget, ikke en stemplet sirkel.

import { detectKnauser } from './dem.js'

/**
 * Mal knaus-relieff-dabber rett på et eksisterende canvas-ctx (typisk
 * hillshade-canvaset, cols×rows). Ingen egen tekstur.
 *
 * @param {CanvasRenderingContext2D} ctx  Mål-canvas (forventet cols×rows)
 * @param {{cols:number, rows:number}} dem
 * @param {Object} options
 * @param {number} [options.widthMm]      Print-bredde (mm) → px/mm for dab-størrelse
 * @param {number} [options.azimuthDeg=315]
 * @param {number} [options.dotRadiusMm=0.6]
 * @param {number} [options.minRadiusPx=1.6]
 * @param {number} [options.tpiRef=1.5]
 * @param {Array}  [options.knauser]      Forhåndsberegnede features (ellers detekteres)
 * @returns {number} antall dabber tegnet
 */
export function paintKnausDabs(ctx, dem, options = {}) {
  if (!ctx || !dem?.cols || !dem?.rows) return 0
  const {
    widthMm,
    azimuthDeg = 315,
    dotRadiusMm = 0.6,
    minRadiusPx = 1.6,
    tpiRef = 1.5,
    knauser = null,
  } = options

  const feats = knauser ?? detectKnauser(dem)
  if (!feats.length) return 0

  const { cols, rows } = dem
  // Canvas er cols×rows = DEM-grid. Ved 1:10 000 og 10 m DEM ≈ 1 px/mm.
  const pxPerMm = widthMm ? cols / widthMm : 1
  const rBase = Math.max(minRadiusPx, dotRadiusMm * pxPerMm)

  // Lysretning mot sola i canvas-koord (y ned). Nord = opp = (0,-1).
  const az = azimuthDeg * Math.PI / 180
  const lx = Math.sin(az)
  const ly = -Math.cos(az)

  for (const k of feats) {
    // gx/gy er DEM-grid-indeks → senter av cellen i canvas-piksler (1:1).
    const cx = k.gx + 0.5
    const cy = k.gy + 0.5
    // Størrelsesvariasjon fra TPI → ikke alle prikker identiske.
    const f = Math.max(0.78, Math.min(1.45, (k.tpi ?? tpiRef) / tpiRef))
    drawKnausRelief(ctx, cx, cy, rBase * f, lx, ly)
  }
  return feats.length
}

// Tegn én knaus som ren, kant-løs relieff-skygging — INGEN bevel, ingen
// kropp-fyll, ingen klippet kant. Bare to myke, motstående lober: mørk mot
// SØ + lys mot NV (sol-azimut), lav opacity og generøs falloff. Da smelter
// prikken inn i hillshade og leser som en liten naturlig kul i terrenget,
// ikke en stemplet sirkel. Den mørke lobe-en bærer på lyse tema (multiply),
// den lyse på mørke tema (screen).
function drawKnausRelief(ctx, cx, cy, r, lx, ly) {
  const off = r * 0.55

  // Mørk lobe (SØ, le-siden).
  const sx = cx - lx * off
  const sy = cy - ly * off
  let g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
  g.addColorStop(0, 'rgba(62,40,22,0.50)')
  g.addColorStop(1, 'rgba(62,40,22,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(sx, sy, r, 0, Math.PI * 2)
  ctx.fill()

  // Lys lobe (NV, sol-siden).
  const hx = cx + lx * off
  const hy = cy + ly * off
  g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r)
  g.addColorStop(0, 'rgba(255,248,232,0.55)')
  g.addColorStop(1, 'rgba(255,248,232,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(hx, hy, r, 0, Math.PI * 2)
  ctx.fill()
}
