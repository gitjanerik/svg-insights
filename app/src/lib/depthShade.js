// Sjødybde-shading (v8.9.24). Tar Sjøkart-dybde-polygoner (ISOM 307) som
// allerede er rendret i SVG-en og raster-fyller dem med gråtoner (grunn =
// hvit, dypt = svart) til en PNG dataURL. Resultatet embeddes som SVG
// <image> over kartet med multiply-blend slik at sjø-områdene mørkner med
// økende dybde — samme visuelle prinsipp som hill-shading av terreng.
//
// Implementasjonen leser direkte fra DOM (live SVG-rot) fordi dybde-data
// allerede er kodet i `data-dybde`-attributtet på 307-paths som
// mapBuilder.js emitterer. Det unngår å persistere et eget raster-grid og
// fungerer både for klient-generete og innebygde kart.
//
// Path2D-konstruktøren tar SVG path-strenger (M/L/Z) direkte, så ctx.fill()
// fungerer uten egenparser. Canvas-koord er pikselbasert, så vi setter
// transform `pxPerM` for å mappe fra meter (user-units i SVG) til pixels.

/**
 * Bygg en PNG dataURL der hver Sjøkart-dybde-polygon er fylt med en
 * gråtone proporsjonal med dybden. Returnerer null hvis SVG-en ikke har
 * noen 307-polygoner med dybde-data.
 *
 * @param {SVGElement} svgRoot   Live SVG-rot (etter render)
 * @param {number} widthM        Kartets bredde i meter (viewBox-bredde)
 * @param {number} heightM       Kartets høyde i meter
 * @param {object} [opts]
 * @param {number} [opts.pxPerM=0.6]      Canvas-oppløsning
 * @param {number} [opts.maxDepthM=60]    Dybde der gråtone når ren svart
 * @param {number} [opts.gamma=0.85]      Gamma-kurve så grunne ikke vasker ut
 * @returns {string|null}                  data:image/png;base64,...
 */
export function computeDepthShadeDataUrl(svgRoot, widthM, heightM, opts = {}) {
  const { pxPerM = 0.6, maxDepthM = 60, gamma = 0.85 } = opts
  if (!svgRoot || !widthM || !heightM) return null

  const paths = svgRoot.querySelectorAll('[data-iso="307"][data-dybde]')
  if (paths.length === 0) return null

  const cw = Math.max(1, Math.round(widthM * pxPerM))
  const ch = Math.max(1, Math.round(heightM * pxPerM))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Hvit bakgrunn (land og udekket vann = "ingen dybde" = lyst).
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cw, ch)
  ctx.setTransform(pxPerM, 0, 0, pxPerM, 0, 0)

  // Render i rekkefølge fra grunneste til dypeste så dypere overstyrer
  // ved overlapp. Polygoner med samme dybde gir samme tone — uavhengig
  // av rekkefølge — så stabil sortering trengs ikke.
  const items = []
  for (const el of paths) {
    const d = el.getAttribute('d')
    const dybde = Number(el.getAttribute('data-dybde'))
    if (!d || !Number.isFinite(dybde)) continue
    items.push({ d, dybde })
  }
  items.sort((a, b) => a.dybde - b.dybde)

  for (const it of items) {
    const t = Math.max(0, Math.min(1, it.dybde / maxDepthM))
    const shade = Math.pow(t, gamma)
    const gray = Math.round(255 * (1 - shade))
    ctx.fillStyle = `rgb(${gray},${gray},${gray})`
    try {
      const path = new Path2D(it.d)
      ctx.fill(path, 'evenodd')
    } catch {
      // Malformed d-attr — hopp over i stedet for å ødelegge hele PNG-en.
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return canvas.toDataURL('image/png')
}
