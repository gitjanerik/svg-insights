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

export function exportSvgFile(svgString, filename = 'turkart.svg') {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  triggerDownload(blob, filename)
}

export async function exportPngFile(svgString, filename = 'turkart.png', { dpi = 300 } = {}) {
  // Parse for å få viewBox
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
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

  const canvas = document.createElement('canvas')
  canvas.width = pxW
  canvas.height = pxH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas-context utilgjengelig')

  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
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
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
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

  const canvas = document.createElement('canvas')
  canvas.width = pxW
  canvas.height = pxH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas-context utilgjengelig')

  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
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
  </head><body>${svgString}<script>
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
