/**
 * fontBuilder.js
 *
 * Builds an OpenType font (OTF/CFF) from glyph paths using opentype.js,
 * and returns it as an ArrayBuffer ready for download. The library is loaded
 * dynamically so it only lands in the bundle when the user clicks "export".
 */

let _opentypeLib = null
async function getOpentype() {
  if (!_opentypeLib) {
    _opentypeLib = await import('opentype.js')
  }
  return _opentypeLib.default || _opentypeLib
}

/**
 * @param {object} params
 * @param {string} params.familyName    e.g. "MinFont"
 * @param {object} params.glyphs        map<char, { pathD, advanceWidth, status }>
 * @param {object} params.metrics       { unitsPerEm, ascender, descender }
 * @param {object} params.settings      { tracking, skewDeg }
 * @returns {Promise<ArrayBuffer>}
 */
export async function buildFont({ familyName, glyphs, metrics, settings }) {
  const opentype = await getOpentype()

  const upm = metrics.unitsPerEm || 1000
  const ascender  = metrics.ascender  ||  800
  const descender = metrics.descender || -200
  const tracking  = (settings && settings.tracking) || 0
  const skewDeg   = (settings && settings.skewDeg)  || 0
  const skewTan   = Math.tan((skewDeg * Math.PI) / 180)

  // .notdef is mandatory
  const notdefPath = new opentype.Path()
  notdefPath.moveTo(100, 0)
  notdefPath.lineTo(100, ascender * 0.7)
  notdefPath.lineTo(500, ascender * 0.7)
  notdefPath.lineTo(500, 0)
  notdefPath.closePath()

  const glyphList = [
    new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: 600,
      path: notdefPath,
    }),
    // Space
    new opentype.Glyph({
      name: 'space',
      unicode: 0x20,
      advanceWidth: 300 + tracking,
      path: new opentype.Path(),
    }),
  ]

  for (const [char, g] of Object.entries(glyphs)) {
    if (!g || !g.pathD || g.status === 'empty') continue
    const path = parsePathDToOpentype(g.pathD, opentype, skewTan)
    if (!path) continue
    glyphList.push(new opentype.Glyph({
      name: 'uni' + char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'),
      unicode: char.charCodeAt(0),
      advanceWidth: (g.advanceWidth || metrics.defaultAdvanceWidth || 600) + tracking,
      path,
    }))
  }

  const font = new opentype.Font({
    familyName,
    styleName: skewDeg !== 0 ? 'Italic' : 'Regular',
    unitsPerEm: upm,
    ascender,
    descender,
    glyphs: glyphList,
  })

  return font.toArrayBuffer()
}

function parsePathDToOpentype(pathD, opentype, skewTan) {
  const path = new opentype.Path()
  const tokens = pathD.match(/[MLCQZmlcqz]|[-+]?[0-9]*\.?[0-9]+(?:\.[0-9]+)?/g) || []
  let i = 0
  let cmd = null
  let hasDrawn = false
  // Apply horizontal shear on-the-fly so the exported font matches preview
  const shear = (x, y) => skewTan ? Math.round(x + y * skewTan) : x

  const num = () => parseFloat(tokens[i++])
  while (i < tokens.length) {
    if (/[MLCQZmlcqz]/.test(tokens[i])) cmd = tokens[i++]
    if (cmd === 'Z' || cmd === 'z') {
      path.closePath()
      continue
    }
    if (cmd === 'M' || cmd === 'm') {
      const x = num(), y = num()
      path.moveTo(shear(x, y), y)
      hasDrawn = true
    } else if (cmd === 'L' || cmd === 'l') {
      const x = num(), y = num()
      path.lineTo(shear(x, y), y)
    } else if (cmd === 'C' || cmd === 'c') {
      const c1x = num(), c1y = num()
      const c2x = num(), c2y = num()
      const  ex = num(),  ey = num()
      path.curveTo(
        shear(c1x, c1y), c1y,
        shear(c2x, c2y), c2y,
        shear( ex,  ey),  ey
      )
    } else if (cmd === 'Q' || cmd === 'q') {
      const c1x = num(), c1y = num()
      const  ex = num(),  ey = num()
      path.quadraticCurveTo(
        shear(c1x, c1y), c1y,
        shear( ex,  ey),  ey
      )
    } else {
      i++
    }
  }
  return hasDrawn ? path : null
}

/** Save an ArrayBuffer as a file via a Blob + anchor click. */
export function downloadBuffer(buffer, filename) {
  const blob = new Blob([buffer], { type: 'font/otf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
