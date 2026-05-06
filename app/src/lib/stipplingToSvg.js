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
} = {}) {
  if (!points || !points.length) return null

  const bg = background ?? palette?.bg ?? '#ffffff'
  const dotColor = palette?.outline ?? '#000000'

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="w-full h-full">`)
  parts.push(`<rect width="${width}" height="${height}" fill="${bg}"/>`)

  if (mode === 'stippling') {
    // Uniform liten radius — klassisk pen-and-ink
    for (const p of points) {
      parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="0.9" fill="${dotColor}"/>`)
    }
  } else if (mode === 'halftone') {
    // Størrelse skalerer med lokal density
    for (const p of points) {
      const r = 0.5 + (p.weight ?? 0.5) * 2.6
      parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(2)}" fill="${dotColor}"/>`)
    }
  } else if (mode === 'hybrid') {
    // To lag: alle som små prikker, så større prikker over de mørkeste
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

  parts.push('</svg>')
  return parts.join('')
}
