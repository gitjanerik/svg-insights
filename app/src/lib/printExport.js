// Print-eksport av kart-SVG.
//
//   exportSvgFile(svgString, filename)
//      Last ned som ren SVG (anbefalt for vektor-kvalitet).
//
//   exportPngFile(svgString, filename, dpi)
//      Render til canvas og last ned som PNG. dpi=300 gir høy kvalitet,
//      dpi=600 gir A1/A0 print.
//
//   exportPdfFile(svgString, filename, dpi)
//      Lagre som PDF direkte (ingen print-dialog). Bruker jsPDF lazy-
//      loaded. Embed PNG ved valgt DPI i en PDF med riktig papirstørrelse.
//
//   printDocument(svgString, options)
//      Åpner et nytt vindu og triggrer window.print() — for de som vil
//      printe på papir. Dropper kombinasjon med PDF (egen funksjon).

// v8.9.25: max canvas-dimensjon (px). Chrome Android OOM-feilet på
// fullscale 5–10 km kart ved 300 dpi (canvas-bytes = px² × 4 — et
// 6000×6000 canvas = 144 MB). Clamp til 4096 → maks 64 MB canvas,
// trygt på alle mobile chromium. Print-kvalitet beholdes på A3/A4
// utskrifter; A0/A1 må eksporteres som SVG fra desktop.
const MAX_CANVAS_PX = 4096

/**
 * Fjern runtime-overlay-lag som ikke skal inn i eksporterte filer:
 * GPS-spor, brukerposisjon, annotation-pin-er, måleverktøy, samt
 * potensielt store dybde-shading PNG-er hvis de er inni `<img>`-
 * inkompatible <image>-tagger. Hill-shading beholdes — den er en
 * autoritativ kart-feature, ikke en bruker-overlay.
 *
 * v8.9.26: sørger også for at root-svg har `xmlns:xlink` deklarert.
 * Setup-koden i MapView lager <svg> via createElementNS uten å sette
 * xlink-namespace, mens applyHillshade / applyDepthShade legger til
 * `xlink:href` på <image>-elementene. Uten deklarasjonen feiler XML-
 * parsing i Chrome Android ved gjenåpning av eksportert SVG.
 */
function stripRuntimeOverlays(svgString) {
  // Match og fjern <g id="user-layer">…</g>, og tilsvarende for andre
  // klient-injiserte lag. Bruker non-greedy match og `[^]*` for å fange
  // newlines (`.` matcher ikke \n uten s-flag, ikke alle JS-runtimes har).
  let s = svgString
  const layerIds = ['user-layer', 'annotation-layer', 'track-layer', 'measure-layer']
  for (const id of layerIds) {
    const re = new RegExp(`<g[^>]*id="${id}"[^]*?</g>`, 'g')
    s = s.replace(re, '')
  }
  // v9.1.13: knaus-relieffet er nå malt inn i hillshade-bildet (ett relieff-
  // lag), som beholdes i eksport. Ingen egen knaus-<image> å strippe lenger.
  if (!s.includes('xmlns:xlink')) {
    s = s.replace(/<svg\b([^>]*)>/, '<svg$1 xmlns:xlink="http://www.w3.org/1999/xlink">')
  }
  return s
}

export function exportSvgFile(svgString, filename = 'turkart.svg') {
  const cleaned = stripRuntimeOverlays(svgString)
  const blob = new Blob([cleaned], { type: 'image/svg+xml;charset=utf-8' })
  triggerDownload(blob, filename)
}

function clampCanvasDims(pxW, pxH) {
  const maxDim = Math.max(pxW, pxH)
  if (maxDim <= MAX_CANVAS_PX) return { pxW, pxH }
  const k = MAX_CANVAS_PX / maxDim
  return { pxW: Math.round(pxW * k), pxH: Math.round(pxH * k) }
}

export async function exportPngFile(svgString, filename = 'turkart.png', { dpi = 300 } = {}) {
  const cleanedSvg = stripRuntimeOverlays(svgString)
  // Parse for å få viewBox
  const parser = new DOMParser()
  const doc = parser.parseFromString(cleanedSvg, 'image/svg+xml')
  const root = doc.documentElement
  const widthAttr = root.getAttribute('width')
  const heightAttr = root.getAttribute('height')

  // Hvis SVG har width/height i mm, konverter til pixler ved gitt DPI
  // 1 mm = dpi / 25.4 px
  let pxW, pxH
  if (widthAttr?.endsWith('mm') && heightAttr?.endsWith('mm')) {
    const wMm = parseFloat(widthAttr)
    const hMm = parseFloat(heightAttr)
    pxW = Math.round(wMm * dpi / 25.4)
    pxH = Math.round(hMm * dpi / 25.4)
  } else {
    const vb = (root.getAttribute('viewBox') ?? '0 0 1000 1000').split(/\s+/).map(parseFloat)
    pxW = Math.round(vb[2])
    pxH = Math.round(vb[3])
  }

  ;({ pxW, pxH } = clampCanvasDims(pxW, pxH))

  const canvas = document.createElement('canvas')
  canvas.width = pxW
  canvas.height = pxH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas-context utilgjengelig')

  const blob = new Blob([cleanedSvg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = url
    })
    ctx.drawImage(img, 0, 0, pxW, pxH)
    const pngBlob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/png', 1.0))
    triggerDownload(pngBlob, filename)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Render SVG til kanvas + returner pxW/pxH/wMm/hMm. Gjenbrukes av PNG og PDF.
 */
async function renderSvgToCanvas(svgString, dpi) {
  const cleanedSvg = stripRuntimeOverlays(svgString)
  const parser = new DOMParser()
  const doc = parser.parseFromString(cleanedSvg, 'image/svg+xml')
  const root = doc.documentElement
  const widthAttr = root.getAttribute('width')
  const heightAttr = root.getAttribute('height')

  let pxW, pxH, wMm, hMm
  if (widthAttr?.endsWith('mm') && heightAttr?.endsWith('mm')) {
    wMm = parseFloat(widthAttr)
    hMm = parseFloat(heightAttr)
    pxW = Math.round(wMm * dpi / 25.4)
    pxH = Math.round(hMm * dpi / 25.4)
  } else {
    const vb = (root.getAttribute('viewBox') ?? '0 0 1000 1000').split(/\s+/).map(parseFloat)
    pxW = Math.round(vb[2])
    pxH = Math.round(vb[3])
    wMm = pxW * 25.4 / dpi
    hMm = pxH * 25.4 / dpi
  }

  ;({ pxW, pxH } = clampCanvasDims(pxW, pxH))

  const canvas = document.createElement('canvas')
  canvas.width = pxW
  canvas.height = pxH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas-context utilgjengelig')

  const blob = new Blob([cleanedSvg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = url
    })
    ctx.drawImage(img, 0, 0, pxW, pxH)
  } finally {
    URL.revokeObjectURL(url)
  }
  return { canvas, pxW, pxH, wMm, hMm }
}

export async function exportPdfFile(svgString, filename = 'turkart.pdf', { dpi = 300 } = {}) {
  // Lazy-load jsPDF — ~40 KB gzipped, kun aktivert ved PDF-eksport.
  const { default: jsPDF } = await import('jspdf')

  const { canvas, wMm, hMm } = await renderSvgToCanvas(svgString, dpi)

  const orientation = wMm > hMm ? 'l' : 'p'
  const pdf = new jsPDF({
    unit: 'mm',
    orientation,
    format: [wMm, hMm],
    compress: true,
  })

  const dataUrl = canvas.toDataURL('image/png', 1.0)
  pdf.addImage(dataUrl, 'PNG', 0, 0, wMm, hMm, undefined, 'FAST')
  pdf.save(filename)
}

export function printDocument(svgString, { title = 'Turkart' } = {}) {
  const w = window.open('', '_blank', 'width=1200,height=900')
  if (!w) { alert('Tillat popup for å printe'); return }
  const cleanedSvg = stripRuntimeOverlays(svgString)
  // Sett inn SVG i et minimalt dokument
  w.document.write(`<!doctype html><html><head>
    <title>${title}</title>
    <meta charset="utf-8">
    <style>
      @page { margin: 0; }
      html, body { margin: 0; padding: 0; background: white; }
      svg { width: 100%; height: 100vh; display: block; page-break-after: avoid; }
      @media print {
        svg { width: 100%; height: auto; }
      }
    </style>
  </head><body>${cleanedSvg}<script>
    window.addEventListener('load', () => setTimeout(() => window.print(), 300))
  </script></body></html>`)
  w.document.close()
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
