// Renderer en stipple-punktsky som SVG. Tre moduser:
//   'stippling' — uniformt små prikker
//   'halftone'  — prikker varierer i størrelse etter lokal density
//   'hybrid'    — fin stippling-base + større prikker i mørke områder

export function stipplingToSvg({
  points,
  width,
  height,
  palette,
  mode = 'halftone',
  background = null,
  blendMode = 'normal',
  preserveAspectRatio = 'xMidYMid meet',
} = {}) {
  if (!points || !points.length) return null

  const bg = background ?? palette?.bg ?? '#ffffff'
  const dotColor = palette?.outline ?? '#000000'

  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 ${width} ${height}" ` +
    `preserveAspectRatio="${preserveAspectRatio}" ` +
    `class="w-full h-full">`
  )
  parts.push(`<rect width="${width}" height="${height}" fill="${bg}"/>`)

  // Wrap prikker i en gruppe med mix-blend-mode (samme mønster som halftone i SVG-sporet)
  const groupStyle = blendMode && blendMode !== 'normal'
    ? ` style="mix-blend-mode:${blendMode}"`
    : ''
  parts.push(`<g${groupStyle}>`)

  if (mode === 'stippling') {
    for (const p of points) {
      parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="0.9" fill="${dotColor}"/>`)
    }
  } else if (mode === 'halftone') {
    for (const p of points) {
      const r = 0.5 + (p.weight ?? 0.5) * 2.6
      parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(2)}" fill="${dotColor}"/>`)
    }
  } else if (mode === 'hybrid') {
    for (const p of points) {
      parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="0.7" fill="${dotColor}"/>`)
    }
    for (const p of points) {
      if ((p.weight ?? 0) > 0.55) {
        const r = 1.2 + (p.weight - 0.55) * 5
        parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(2)}" fill="${dotColor}" opacity="0.85"/>`)
      }
    }
  }

  parts.push('</g>')
  parts.push('</svg>')
  return parts.join('')
}

// Tilgjengelige blend-modi (samme som halftone i SVG-sporet)
export const BLEND_MODES = [
  { value: 'normal', label: 'Normal' },
  { value: 'luminosity', label: 'Luminositet' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'difference', label: 'Difference' },
]
