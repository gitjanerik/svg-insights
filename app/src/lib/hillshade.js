// Hill-shading fra DEM (v8.9.4). Bruker standard Horn-formel: gradient
// fra 3×3 nabolag, kombinert med sol-azimut + elevasjon for å regne ut
// lokal lyshet. Output: grayscale RGBA-buffer + canvas → dataURL som kan
// embeddes som SVG <image>.
//
// Konvensjoner:
//   azimuth 315°  → solen fra nordvest (klassisk kartografi-konvensjon)
//   elevation 45° → solen halvveis oppe
// Endre via options for å eksperimentere.

/**
 * @param {{data: Float32Array, cols: number, rows: number, transform: {pixelWidth: number, pixelHeight: number}, noData: number}} dem
 * @param {{azimuthDeg?: number, elevationDeg?: number, zFactor?: number, gamma?: number}} [options]
 * @returns {{rgba: Uint8ClampedArray, cols: number, rows: number, widthM: number, heightM: number}}
 */
export function computeHillshade(dem, options = {}) {
  // zFactor 1.5: overdriv skråninger litt så relieffet trer tydeligere fram —
  // store/slake kart (f.eks. Tyrifjorden, 25 m ekvidistanse) ga ellers et veldig
  // svakt relieff under multiply-blend. gamma 1.0 (nøytral) i stedet for 0.85 så
  // skyggesidene ikke lysnes opp — dypere skygger = sterkere relieff. (v9.3.36)
  const { azimuthDeg = 315, elevationDeg = 45, zFactor = 1.5, gamma = 1.0 } = options
  const { data, cols, rows, transform, noData } = dem
  const cellSize = transform.pixelWidth
  const zenithRad = (90 - elevationDeg) * Math.PI / 180
  // GDAL-konvensjon: azimuth måles med klokken fra nord, mens atan2 returnerer
  // matematisk vinkel (mot klokken fra øst). Konverter.
  const azimuthRad = (360 - azimuthDeg + 90) * Math.PI / 180

  const cosZenith = Math.cos(zenithRad)
  const sinZenith = Math.sin(zenithRad)
  const rgba = new Uint8ClampedArray(cols * rows * 4)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // 3×3-nabolag med kant-clamping (mirror)
      const rUp = r > 0 ? r - 1 : 0
      const rDn = r < rows - 1 ? r + 1 : rows - 1
      const cL = c > 0 ? c - 1 : 0
      const cR = c < cols - 1 ? c + 1 : cols - 1
      const get = (rr, cc) => {
        const v = data[rr * cols + cc]
        return v === noData ? 0 : v
      }
      const z00 = get(rUp, cL), z01 = get(rUp, c), z02 = get(rUp, cR)
      const z10 = get(r,   cL),                    z12 = get(r,   cR)
      const z20 = get(rDn, cL), z21 = get(rDn, c), z22 = get(rDn, cR)

      // Sobel-vektet gradient (8 nabopunkter)
      const dzdx = ((z02 + 2 * z12 + z22) - (z00 + 2 * z10 + z20)) / (8 * cellSize)
      const dzdy = ((z20 + 2 * z21 + z22) - (z00 + 2 * z01 + z02)) / (8 * cellSize)

      const slope = Math.atan(zFactor * Math.hypot(dzdx, dzdy))
      const aspect = Math.atan2(dzdy, -dzdx)

      let shade = cosZenith * Math.cos(slope)
                + sinZenith * Math.sin(slope) * Math.cos(azimuthRad - aspect)
      if (shade < 0) shade = 0
      else if (shade > 1) shade = 1
      // Gamma-kurve så skyggene blir litt mer markante uten å bli kullsorte
      shade = Math.pow(shade, gamma)
      const px = Math.round(shade * 255)

      const idx = (r * cols + c) * 4
      rgba[idx]     = px
      rgba[idx + 1] = px
      rgba[idx + 2] = px
      rgba[idx + 3] = 255
    }
  }

  return {
    rgba,
    cols,
    rows,
    widthM: cols * cellSize,
    heightM: rows * Math.abs(transform.pixelHeight ?? cellSize),
  }
}

/**
 * Bak blend-modus inn i alfa-kanalen så relieffet kan tegnes med NORMAL
 * kompositt i stedet for `mix-blend-mode` (v9.3.39). mix-blend-mode tvinger
 * nettleseren til å re-rasterisere backdrop-en (hele vektor-kartet) per frame
 * under pan/zoom — en alvorlig mobil-flaskehals. Normal alfa-kompositt er
 * pikselidentisk når vi velger riktig farge + alfa:
 *
 *   multiply  (lyse tema): result = base × (skygge/255)
 *             = base × (1 − α)  ⇒  svart overlegg, α = 255 − skygge
 *   screen    (mørke tema): result = 1 − (1−base)(1−skygge/255)
 *             = base + α(1−base) ⇒  hvitt overlegg, α = skygge
 *
 * Begge er matematisk eksakt lik de respektive blend-modusene. Ren funksjon
 * (ingen canvas/DOM) så den er enhetstestbar.
 *
 * @param {{rgba: Uint8ClampedArray, cols: number, rows: number}} shade  grayscale-skygge fra computeHillshade
 * @param {'multiply'|'screen'} mode
 * @returns {Uint8ClampedArray} RGBA med tonet farge + bakt alfa
 */
export function shadeToToneRGBA(shade, mode) {
  const src = shade.rgba
  const out = new Uint8ClampedArray(src.length)
  const white = mode === 'screen'
  const v = white ? 255 : 0
  for (let i = 0; i < src.length; i += 4) {
    const g = src[i]                 // grå skyggeverdi 0..255 (kanalene er like)
    out[i] = v; out[i + 1] = v; out[i + 2] = v
    out[i + 3] = white ? g : 255 - g
  }
  return out
}

/**
 * Render hillshade RGBA til en data-URL (PNG). Brukes for å embedde resultatet
 * som SVG <image href="data:image/png;base64,..."/>.
 *
 * v9.3.39: valgfri `mode` ('multiply'/'screen') baker blend inn i alfa (se
 * shadeToToneRGBA) så <image> kan tegnes med normal kompositt. Default 'opaque'
 * beholder den gamle grå-opake teksturen (bakoverkompat).
 *
 * v9.1.13: valgfri `decorate(ctx, cols, rows)`-callback kjøres etter at
 * skyggingen er tegnet, men før toDataURL — slik at f.eks. knaus-relieff kan
 * males inn på SAMME canvas. Da blir hele relieffet ÉN blendet <image>-tekstur
 * (i DEM-oppløsning) i stedet for to (hillshade + et stort eget knaus-raster
 * på opptil 4096² = ~67 MB), som var en alvorlig mobil-GPU-flaskehals.
 */
export function hillshadeToDataURL(shade, { mode = 'opaque', decorate } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = shade.cols
  canvas.height = shade.rows
  const ctx = canvas.getContext('2d')
  const rgba = (mode === 'multiply' || mode === 'screen')
    ? shadeToToneRGBA(shade, mode)
    : new Uint8ClampedArray(shade.rgba)
  const imgData = new ImageData(rgba, shade.cols, shade.rows)
  ctx.putImageData(imgData, 0, 0)
  if (typeof decorate === 'function') decorate(ctx, shade.cols, shade.rows)
  return canvas.toDataURL('image/png')
}
