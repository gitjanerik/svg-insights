/**
 * DEM-sampling — unpack, oppslag og utklipp av lagret DEM.
 *
 * DEM-strukturen (fra demFetcher.js) har:
 *   data:      Float32Array av lengde cols*rows, indeksert [row*cols + col]
 *   cols/rows: grid-dimensjoner
 *   transform: { originX:0, originY:0, pixelWidth, pixelHeight } i meter
 *   noData:    sentinel-verdi (-9999) for hull i datasettet
 *
 * SVG-koordinater i kart-viewBox (`0 0 widthM heightM`) mapper direkte til
 * grid-koord via col = svgX / pixelWidth, row = svgY / pixelHeight. Både
 * GeoTIFF-rekker og SVG y-aksen øker nedover, så ingen flip nødvendig.
 */

/** @typedef {{data: Float32Array, cols: number, rows: number, transform: {pixelWidth: number, pixelHeight: number, originX: number, originY: number}, noData: number}} DEM */

/**
 * Bilinear-interpolert elevasjon ved (svgX, svgY). Returnerer NaN ved
 * out-of-bounds eller hvis noen av de fire hjørne-cellene er noData.
 *
 * @param {DEM} dem
 * @param {number} svgX
 * @param {number} svgY
 * @returns {number} høyde i meter, eller NaN
 */
export function sampleElevation(dem, svgX, svgY) {
  const { data, cols, rows, transform, noData } = dem
  const colF = svgX / transform.pixelWidth
  const rowF = svgY / transform.pixelHeight
  if (colF < 0 || rowF < 0 || colF > cols - 1 || rowF > rows - 1) return NaN

  const c0 = Math.floor(colF)
  const c1 = Math.min(c0 + 1, cols - 1)
  const r0 = Math.floor(rowF)
  const r1 = Math.min(r0 + 1, rows - 1)
  const u = colF - c0
  const v = rowF - r0

  const v00 = data[r0 * cols + c0]
  const v10 = data[r0 * cols + c1]
  const v01 = data[r1 * cols + c0]
  const v11 = data[r1 * cols + c1]
  if (v00 === noData || v10 === noData || v01 === noData || v11 === noData) return NaN

  const top = v00 * (1 - u) + v10 * u
  const bot = v01 * (1 - u) + v11 * u
  return top * (1 - v) + bot * v
}

/**
 * Sentral-differanse gradient i SVG-koord. Returnerer (∂z/∂x, ∂z/∂y) i
 * meter-per-meter (dimensjonsløs helling). Steg = pixelWidth = ~25m i ekte
 * terreng, gir glatt nok gradient for fysikk-formål.
 *
 * Ved out-of-bounds eller noData i samples returneres 0 for den komponenten.
 *
 * @param {DEM} dem
 * @param {number} svgX
 * @param {number} svgY
 * @returns {{dzdx: number, dzdy: number}}
 */
export function sampleGradient(dem, svgX, svgY) {
  const eps = dem.transform.pixelWidth
  const eL = sampleElevation(dem, svgX - eps, svgY)
  const eR = sampleElevation(dem, svgX + eps, svgY)
  const eU = sampleElevation(dem, svgX, svgY - eps)
  const eD = sampleElevation(dem, svgX, svgY + eps)
  const dzdx = Number.isFinite(eL) && Number.isFinite(eR) ? (eR - eL) / (2 * eps) : 0
  const dzdy = Number.isFinite(eU) && Number.isFinite(eD) ? (eD - eU) / (2 * eps) : 0
  return { dzdx, dzdy }
}

/**
 * Finner høyeste punkt i DEM-griddet. Returnerer SVG-koord og elevasjon,
 * eller null hvis hele griddet er noData.
 *
 * @param {DEM} dem
 * @returns {{svgX: number, svgY: number, elevation: number} | null}
 */
export function findHighestPoint(dem) {
  const { data, cols, rows, transform, noData } = dem
  let maxIdx = -1
  let maxZ = -Infinity
  for (let i = 0; i < data.length; i++) {
    const z = data[i]
    if (z !== noData && z > maxZ) {
      maxZ = z
      maxIdx = i
    }
  }
  if (maxIdx < 0) return null
  const col = maxIdx % cols
  const row = Math.floor(maxIdx / cols)
  return {
    svgX: (col + 0.5) * transform.pixelWidth,
    svgY: (row + 0.5) * transform.pixelHeight,
    elevation: maxZ,
  }
}

/**
 * Klipp ut et akse-justert sub-grid av DEM-en som dekker meter-rektangelet
 * [offX, offX+sizeXM] × [offY, offY+sizeYM] i kart-SVG-koord. Det returnerte
 * DEM-et har sin EGEN (0,0) i hjørnet (offX, offY) — sample(gx, gy) på utklippet
 * tilsvarer altså sample(offX+gx, offY+gy) på kilden.
 *
 * Klipper ut det største sentrerte KVADRATISKE utsnittet av et A-format
 * (portrett) kart: kalleren jobber i 0..Sm-koord mot dette utklippet og
 * tilbake til kartets senter.
 *
 * Klipping skjer på celle-grenser (round), så meter-offset kan avvike inntil en
 * halv piksel (~12 m på 25 m DTM) — usynlig på kart-skala. pixelWidth/Height
 * bevares så sample-matematikken er uendret.
 *
 * @param {DEM} dem
 * @param {number} offX  venstre kant i kilde-meter
 * @param {number} offY  topp-kant i kilde-meter
 * @param {number} sizeXM  bredde i meter
 * @param {number} sizeYM  høyde i meter (default = sizeXM, dvs. kvadrat)
 * @returns {DEM} nytt DEM med eget origo; kilde-DEM-et returneres uendret hvis
 *   utklippet degenererer (0 celler)
 */
export function cropDem(dem, offX, offY, sizeXM, sizeYM = sizeXM) {
  const { data, cols, rows, transform, noData } = dem
  const pw = transform.pixelWidth
  const ph = transform.pixelHeight
  const c0 = Math.max(0, Math.round(offX / pw))
  const r0 = Math.max(0, Math.round(offY / ph))
  const colN = Math.min(Math.round(sizeXM / pw), cols - c0)
  const rowN = Math.min(Math.round(sizeYM / ph), rows - r0)
  if (colN <= 0 || rowN <= 0) return dem
  const out = new Float32Array(colN * rowN)
  for (let ry = 0; ry < rowN; ry++) {
    const srcStart = (r0 + ry) * cols + c0
    out.set(data.subarray(srcStart, srcStart + colN), ry * colN)
  }
  return {
    data: out,
    cols: colN,
    rows: rowN,
    transform: { ...transform, originX: 0, originY: 0 },
    noData,
  }
}

/**
 * Pakk DEM-data til en form som kan persisteres i IndexedDB. Returnerer
 * et POJO med ArrayBuffer for data-array (Float32Array er ikke direkte
 * structured-clonable i alle browsere, men ArrayBuffer er).
 *
 * @param {DEM} dem
 * @returns {{buffer: ArrayBuffer, cols: number, rows: number, transform: object, noData: number}}
 */
export function packDem(dem) {
  return {
    buffer: dem.data.buffer.slice(0),
    cols: dem.cols,
    rows: dem.rows,
    transform: { ...dem.transform },
    noData: dem.noData,
  }
}

/**
 * Pakk ut igjen til DEM-form med Float32Array-view.
 *
 * @param {{buffer: ArrayBuffer, cols: number, rows: number, transform: object, noData: number}} packed
 * @returns {DEM}
 */
export function unpackDem(packed) {
  return {
    data: new Float32Array(packed.buffer),
    cols: packed.cols,
    rows: packed.rows,
    transform: packed.transform,
    noData: packed.noData,
  }
}
