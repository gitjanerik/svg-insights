// Knaus-relieff-raster (v9.1.7).
//
// Knauser (ISOM 213) er TPI-derivert fra samme DEM som hillshade. Tidligere
// ble hver knaus rendret som et eget SVG-element (v9.1.5 slo dem sammen til
// én merged <path>, men det var fortsatt N path-segmenter + bytes i SVG-en).
// Her flyttes de helt ut av SVG-en: vi rasteriserer dem som små «embossed»
// prikker på et eget, høyoppløst <image>-lag som legges rett over hillshade
// og blender med samme modus. Da koster knaus 0 DOM-noder og 0 path-bytes,
// og skalerer billig ved zoom (én GPU-tekstur).
//
// Hvorfor dette ikke lagger selv ved høy oppløsning:
//   • Laget forblir ÉN <image> = én GPU-tekstur. Per-frame transform-kost er
//     uavhengig av kildeoppløsning opp til GPU-ens maks tekstur (~4096 px på
//     S22-klasse). Derfor klamper vi til MAX_DIM.
//   • Prikk-laget er ~99% gjennomsiktig → PNG komprimerer til noen få KB
//     uansett pikseldimensjon. Ingen byte-/minne-bekymring i praksis.
//
// Prikken tegnes som en kul belyst fra NV (azimut 315°, samme som
// computeHillshade): varmt høylys mot NV, brun skygge mot SØ. Under
// `multiply` (lyse tema) slår bare skygge-siden inn — nøyaktig som terrenget
// ellers leses — så den blir «embossed» i relieffet.

import { detectKnauser } from './dem.js'

const MAX_DIM = 4096        // GPU-tekstur-tak (S22-klasse Adreno/Mali)
const DEFAULT_PX_PER_MM = 8 // mer native oppløsning ⇒ skarpere prikk ved zoom

/**
 * Bygg et embossed knaus-prikk-raster som dekker hele kart-extentet.
 *
 * @param {{data: Float32Array, cols: number, rows: number, transform: object, noData: number}} dem
 * @param {Object} options
 * @param {number} options.widthMm   Print-bredde i mm (px-budsjett)
 * @param {number} options.heightMm  Print-høyde i mm
 * @param {number} [options.pxPerMm=6]
 * @param {number} [options.maxDim=4096]
 * @param {number} [options.azimuthDeg=315]  Sol-azimut (matcher hillshade)
 * @param {number} [options.dotRadiusMm=0.6] ISOM 213 ≈ 1.2mm diameter
 * @param {Array}  [options.knauser]  Forhåndsberegnede features (ellers detekteres)
 * @returns {{ dataUrl: string, width: number, height: number, count: number } | null}
 */
export function buildKnausRaster(dem, options = {}) {
  if (!dem || !dem.cols || !dem.rows) return null
  const {
    widthMm,
    heightMm,
    pxPerMm = DEFAULT_PX_PER_MM,
    maxDim = MAX_DIM,
    azimuthDeg = 315,
    dotRadiusMm = 0.6,
    knauser = null,
  } = options
  if (!widthMm || !heightMm) return null

  const feats = knauser ?? detectKnauser(dem)
  if (!feats.length) return null

  // Raster-dimensjoner fra mm-budsjett, klampet til GPU-taket.
  let W = Math.max(1, Math.round(widthMm * pxPerMm))
  let H = Math.max(1, Math.round(heightMm * pxPerMm))
  const cap = Math.max(W, H)
  if (cap > maxDim) {
    const s = maxDim / cap
    W = Math.max(1, Math.round(W * s))
    H = Math.max(1, Math.round(H * s))
  }
  const effPxPerMm = W / widthMm
  // Minst ~2.5px radius så prikken aldri degenererer til en enslig piksel.
  const r = Math.max(2.5, dotRadiusMm * effPxPerMm)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Lysretning mot sola i skjerm-koordinater (y vokser nedover).
  // Nord = opp = (0,-1); azimut måles med klokken fra nord.
  const az = azimuthDeg * Math.PI / 180
  const lx = Math.sin(az)
  const ly = -Math.cos(az)

  const { cols, rows } = dem
  for (const k of feats) {
    // gx/gy er DEM-grid-indeks; senter av cellen i raster-piksler.
    const cx = ((k.gx + 0.5) / cols) * W
    const cy = ((k.gy + 0.5) / rows) * H
    drawBevelDot(ctx, cx, cy, r, lx, ly)
  }

  return { dataUrl: canvas.toDataURL('image/png'), width: W, height: H, count: feats.length }
}

// Tegn én knaus som en skarp BEVEL (ikke diffus emboss-glød): en definert
// liten skive med hard ytre kant + retningsbestemt skygge/høylys på kanten.
// Tidligere brukte vi to ut-blødende radial-gradienter uten klipping → en
// myk halo som ble blurry ved innzooming. Her klipper vi alt til skiva, så
// kanten er skarp og prikken leser som en kul, ikke en sky.
function drawBevelDot(ctx, cx, cy, r, lx, ly) {
  ctx.save()
  // Hard ytre kant: alt under tegnes innenfor skiva.
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()

  // Definert kropp: jevn brun fyll, holder fargen nesten helt ut til kanten.
  let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  g.addColorStop(0, 'rgba(120,82,52,0.34)')
  g.addColorStop(0.78, 'rgba(120,82,52,0.30)')
  g.addColorStop(1, 'rgba(120,82,52,0.06)')
  ctx.fillStyle = g
  ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r)

  // Bevel-skygge på motsatt sol-side (SØ) — skarp brun crescent. Dette er det
  // som leser under `multiply` på lyse tema og gir 3D-følelsen.
  const sx = cx - lx * r * 0.55
  const sy = cy - ly * r * 0.55
  g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 1.05)
  g.addColorStop(0, 'rgba(56,34,17,0.92)')
  g.addColorStop(0.55, 'rgba(56,34,17,0.42)')
  g.addColorStop(1, 'rgba(56,34,17,0)')
  ctx.fillStyle = g
  ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r)

  // Bevel-høylys på sol-siden (NV) — leser under `screen` (mørke tema).
  const hx = cx + lx * r * 0.55
  const hy = cy + ly * r * 0.55
  g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 1.05)
  g.addColorStop(0, 'rgba(255,250,236,0.95)')
  g.addColorStop(0.55, 'rgba(255,250,236,0.40)')
  g.addColorStop(1, 'rgba(255,250,236,0)')
  ctx.fillStyle = g
  ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r)

  ctx.restore()
}
