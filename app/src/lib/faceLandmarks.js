// Ansikts-deteksjon uten ML-modell.
//
// Strategi: hudtone-segmentering i YCbCr-fargerom (mer robust enn HSV mot
// belysningsendringer), connected-components for å finne den største
// hud-regionen, så bounding-box og sentroid.
//
// YCbCr-grenser hentet fra litteraturen for menneskelig hud:
//   77 ≤ Cb ≤ 127
//   133 ≤ Cr ≤ 173
//   60 ≤ Y ≤ 240
// Disse fungerer på tvers av hudtoner fordi Cb/Cr-rommet skiller hud
// fra ikke-hud relativt godt selv ved varierende lyshet.

export function rgbToYCbCr(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  return { y, cb, cr }
}

export function isSkinPixel(r, g, b) {
  const { y, cb, cr } = rgbToYCbCr(r, g, b)
  return y >= 60 && y <= 240 &&
         cb >= 77 && cb <= 127 &&
         cr >= 133 && cr <= 173
}

// Bygg en binær maske av hudpixler. Returnerer Uint8Array (0/1) av størrelse w*h.
export function buildSkinMask(rgba, w, h) {
  const mask = new Uint8Array(w * h)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    if (isSkinPixel(rgba[i], rgba[i + 1], rgba[i + 2])) {
      mask[j] = 1
    }
  }
  return mask
}

// Connected-components labeling med 4-connectivity. Returnerer:
//   { labels: Uint16Array(w*h), components: [{ id, area, minX, maxX, minY, maxY }] }
// Komponent-ID 0 er bakgrunn.
export function connectedComponents(mask, w, h) {
  const labels = new Uint16Array(w * h)
  const equiv = [0]
  let nextLabel = 1

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      const left = x > 0 && mask[i - 1] ? labels[i - 1] : 0
      const up = y > 0 && mask[i - w] ? labels[i - w] : 0
      if (left === 0 && up === 0) {
        labels[i] = nextLabel
        equiv.push(nextLabel)
        nextLabel++
      } else if (left !== 0 && up === 0) {
        labels[i] = left
      } else if (left === 0 && up !== 0) {
        labels[i] = up
      } else {
        labels[i] = Math.min(left, up)
        // Union: koble equiv[left] og equiv[up] til min
        const rootL = findRoot(equiv, left)
        const rootU = findRoot(equiv, up)
        if (rootL !== rootU) {
          if (rootL < rootU) equiv[rootU] = rootL
          else equiv[rootL] = rootU
        }
      }
    }
  }

  // Andre pass: erstatt labels med deres root
  const compMap = new Map()
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === 0) continue
    const root = findRoot(equiv, labels[i])
    labels[i] = root
    if (!compMap.has(root)) {
      compMap.set(root, { id: root, area: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity })
    }
    const c = compMap.get(root)
    c.area++
    const x = i % w
    const y = (i - x) / w
    if (x < c.minX) c.minX = x
    if (x > c.maxX) c.maxX = x
    if (y < c.minY) c.minY = y
    if (y > c.maxY) c.maxY = y
  }

  return { labels, components: Array.from(compMap.values()) }
}

function findRoot(equiv, label) {
  let r = label
  while (equiv[r] !== r) r = equiv[r]
  // Path compression
  while (equiv[label] !== r) {
    const next = equiv[label]
    equiv[label] = r
    label = next
  }
  return r
}

// Hovedinngang: detekter ansiktsregion fra et RGBA-bilde.
// Returnerer { cx, cy, w, h, area } eller null hvis ingen plausibel region funnet.
export function detectFaceRegion(rgba, width, height, opts = {}) {
  const {
    minAreaFraction = 0.01,  // minst 1% av bildet
    maxAreaFraction = 0.6,   // maks 60% av bildet
    aspectRatioRange = [0.5, 1.6], // høyde/bredde for et ansikt
    requireUpperHalf = true,  // ansiktets sentroid må være i øvre 75% av frame
  } = opts

  const mask = buildSkinMask(rgba, width, height)
  const { components } = connectedComponents(mask, width, height)

  if (components.length === 0) return null

  const totalPixels = width * height
  const minArea = totalPixels * minAreaFraction
  const maxArea = totalPixels * maxAreaFraction

  // Filtrer komponenter på areal og aspect ratio
  const candidates = components.filter(c => {
    if (c.area < minArea || c.area > maxArea) return false
    const w = c.maxX - c.minX + 1
    const h = c.maxY - c.minY + 1
    const ar = h / w
    if (ar < aspectRatioRange[0] || ar > aspectRatioRange[1]) return false
    if (requireUpperHalf) {
      const cy = (c.minY + c.maxY) / 2
      if (cy > height * 0.75) return false
    }
    return true
  })

  if (candidates.length === 0) return null

  // Velg den største kandidaten
  candidates.sort((a, b) => b.area - a.area)
  const best = candidates[0]

  return {
    cx: (best.minX + best.maxX) / 2,
    cy: (best.minY + best.maxY) / 2,
    w: best.maxX - best.minX + 1,
    h: best.maxY - best.minY + 1,
    area: best.area,
    bbox: { x: best.minX, y: best.minY, w: best.maxX - best.minX + 1, h: best.maxY - best.minY + 1 },
  }
}

// Beregn luminans (0..1) for et RGBA-bilde
function rgbaToLuma01(rgba, w, h) {
  const luma = new Float32Array(w * h)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    luma[j] = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255
  }
  return luma
}

// Finn lokalt minimum (mørkeste punkt) i et rektangulært område, vektet med
// en distance-from-center-falloff for å foretrekke punkter som ikke er i
// kanten av søke-vinduet. Returnerer { x, y, value } i bilde-koordinater.
function findDarkestPoint(luma, w, x0, y0, x1, y1) {
  let bestX = x0, bestY = y0, bestScore = Infinity
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const rx = (x1 - x0) / 2
  const ry = (y1 - y0) / 2
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      const r2 = dx * dx + dy * dy
      const v = luma[y * w + x]
      // Penalize edges
      const score = v + r2 * 0.05
      if (score < bestScore) {
        bestScore = score
        bestX = x
        bestY = y
      }
    }
  }
  return { x: bestX, y: bestY, value: luma[bestY * w + bestX] }
}

// Finn lyseste punkt i et område (samme prinsipp som findDarkestPoint)
function findBrightestPoint(luma, w, x0, y0, x1, y1) {
  let bestX = x0, bestY = y0, bestScore = -Infinity
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const rx = (x1 - x0) / 2
  const ry = (y1 - y0) / 2
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      const r2 = dx * dx + dy * dy
      const v = luma[y * w + x]
      const score = v - r2 * 0.05
      if (score > bestScore) {
        bestScore = score
        bestX = x
        bestY = y
      }
    }
  }
  return { x: bestX, y: bestY, value: luma[bestY * w + bestX] }
}

// Finn det midterste y-punktet med sterkest horisontal-mørke-bånd
// (gjennomsnittlig luma per y-rad er minst). Brukes til munn-deteksjon.
function findDarkestRow(luma, w, x0, y0, x1, y1) {
  let bestY = y0, bestSum = Infinity
  for (let y = y0; y < y1; y++) {
    let sum = 0
    for (let x = x0; x < x1; x++) sum += luma[y * w + x]
    if (sum < bestSum) {
      bestSum = sum
      bestY = y
    }
  }
  return bestY
}

// Hovedinngang for landemerke-deteksjon. Tar et RGBA-bilde og en allerede
// detektert ansiktsregion. Returnerer 6 landemerker eller null hvis regionen
// er for liten til pålitelig deteksjon.
//
// Alle koordinater er i bildets piksel-rom.
export function findLandmarks(rgba, width, height, faceRegion, opts = {}) {
  if (!faceRegion) return null

  const { x: fx, y: fy, w: fw, h: fh } = faceRegion.bbox
  const { minFaceWidth = 30 } = opts
  if (fw < minFaceWidth || fh < minFaceWidth) return null

  const luma = rgbaToLuma01(rgba, width, height)

  // Definer søkeregioner som proporsjoner av face bbox (typisk ansiktsanatomi):
  //   Øyne:    y i 0.30-0.50, x i 0.15-0.85 (delt midt)
  //   Nese:    y i 0.40-0.70, x i 0.35-0.65
  //   Munn:    y i 0.65-0.85, x i 0.30-0.70
  //   Hake:    y i 0.85-1.00, x i 0.40-0.60
  //   Panne:   y i 0.00-0.20, x i 0.40-0.60

  function rect(rxFrom, rxTo, ryFrom, ryTo) {
    return [
      Math.max(0, fx + Math.floor(fw * rxFrom)),
      Math.max(0, fy + Math.floor(fh * ryFrom)),
      Math.min(width, fx + Math.ceil(fw * rxTo)),
      Math.min(height, fy + Math.ceil(fh * ryTo)),
    ]
  }

  // Venstre øye (i bildet)
  const [lex0, ley0, lex1, ley1] = rect(0.15, 0.45, 0.30, 0.55)
  const leftEye = findDarkestPoint(luma, width, lex0, ley0, lex1, ley1)

  // Høyre øye
  const [rex0, rey0, rex1, rey1] = rect(0.55, 0.85, 0.30, 0.55)
  const rightEye = findDarkestPoint(luma, width, rex0, rey0, rex1, rey1)

  // Nesetipp (lyseste punkt midtveis)
  const [nx0, ny0, nx1, ny1] = rect(0.40, 0.60, 0.45, 0.70)
  const nose = findBrightestPoint(luma, width, nx0, ny0, nx1, ny1)

  // Munn-senter (mørkeste rad i munn-området)
  const [mx0, my0, mx1, my1] = rect(0.30, 0.70, 0.65, 0.85)
  const mouthY = findDarkestRow(luma, width, mx0, my0, mx1, my1)
  const mouthX = (mx0 + mx1) / 2
  const mouth = { x: mouthX, y: mouthY }

  // Panne-senter (proporsjonalt — vi har ikke hud-kontur til å finne grensa
  // pålitelig her, så vi bruker bbox-toppen + offset)
  const forehead = {
    x: fx + fw * 0.5,
    y: fy + fh * 0.10,
  }

  // Hake (proporsjonalt — bbox-bunnen)
  const chin = {
    x: fx + fw * 0.5,
    y: fy + fh * 0.95,
  }

  return {
    leftEye: { x: leftEye.x, y: leftEye.y },
    rightEye: { x: rightEye.x, y: rightEye.y },
    nose: { x: nose.x, y: nose.y },
    mouth,
    forehead,
    chin,
  }
}
