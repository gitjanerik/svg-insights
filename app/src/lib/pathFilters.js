/**
 * pathFilters.js
 *
 * Pure-string utilities for manipulating SVG path `d` attributes and other
 * SVG markup.  Every function accepts an SVG string and returns a new SVG
 * string — no DOM required, so the module works in Node / test environments.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Insert an attribute before the closing `>` or `/>` of an element tag.
 */
function insertAttr(tag, attr) {
  return tag.replace(/\s*\/?>$/, ` ${attr}$&`.replace(/\s+\/>/, ' />').replace(/\s+>/, ' >'))
}

/**
 * Safely append an attribute to an SVG tag, handling both `>` and `/>` endings.
 */
function appendAttr(tag, attr) {
  if (tag.endsWith('/>')) {
    return tag.slice(0, -2) + ` ${attr}/>`;
  }
  return tag.slice(0, -1) + ` ${attr}>`;
}

/**
 * Simple linear congruential generator (LCG) for deterministic "random"
 * jitter so that repeated calls with the same seed produce identical output.
 *
 * Constants are from Numerical Recipes (Knuth).
 */
function createLCG(seed = 42) {
  let s = seed >>> 0; // ensure unsigned 32-bit
  return function next() {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (s >>> 0) / 0xFFFFFFFF; // 0..1
  };
}

// ---------------------------------------------------------------------------
// 1. straightenPaths
// ---------------------------------------------------------------------------

/**
 * Replace every cubic Bezier `C` command in path `d` attributes with a
 * straight `L` to the endpoint.
 *
 * A `C` command looks like: C cp1x,cp1y cp2x,cp2y x,y
 * We keep only the final (x, y) and emit `L x,y`.
 *
 * @param {string} svgString - raw SVG markup
 * @returns {string} SVG with straightened paths
 */
export function straightenPaths(svgString) {
  // Match the d="..." attribute value and operate inside it.
  return svgString.replace(/(\bd\s*=\s*")([^"]*?)(")/g, (_match, pre, d, post) => {
    // Replace each C command (absolute) with L to the endpoint.
    // C may be followed by multiple coordinate triples (implicit repetition).
    // We handle each explicit C command here.
    const straightened = d.replace(
      /C\s*([-\d.e]+[\s,][-\d.e]+)[\s,]([-\d.e]+[\s,][-\d.e]+)[\s,]([-\d.e]+[\s,]?[-\d.e]+)/gi,
      (_m, _cp1, _cp2, end) => `L ${end}`
    );
    return pre + straightened + post;
  });
}

// ---------------------------------------------------------------------------
// 2. wobblePaths
// ---------------------------------------------------------------------------

/**
 * Add deterministic random jitter to every numeric coordinate in path `d`
 * attributes.  Command letters (M, L, C, Z, etc.) are preserved.
 *
 * @param {string} svgString  - raw SVG markup
 * @param {number} intensity  - jitter magnitude (default 1.0)
 * @returns {string} SVG with wobbly paths
 */
export function wobblePaths(svgString, intensity = 1.0) {
  const rand = createLCG(42);

  return svgString.replace(/(\bd\s*=\s*")([^"]*?)(")/g, (_match, pre, d, post) => {
    // Jitter every numeric value in the d string while keeping letters intact.
    const wobbly = d.replace(/-?\d+(\.\d+)?([eE][+-]?\d+)?/g, (numStr) => {
      const n = parseFloat(numStr);
      const jitter = (rand() - 0.5) * intensity;
      return (n + jitter).toFixed(2);
    });
    return pre + wobbly + post;
  });
}

// ---------------------------------------------------------------------------
// 3. adjustStrokeWidths
// ---------------------------------------------------------------------------

/**
 * Multiply every `stroke-width` attribute value by the given scale factor.
 *
 * @param {string} svgString - raw SVG markup
 * @param {number} scale     - multiplier (e.g. 2.0 doubles width)
 * @returns {string} SVG with scaled stroke widths
 */
export function adjustStrokeWidths(svgString, scale) {
  return svgString.replace(
    /(\bstroke-width\s*=\s*")([^"]*?)(")/g,
    (_match, pre, value, post) => {
      const scaled = (parseFloat(value) * scale).toFixed(2);
      return pre + scaled + post;
    }
  );
}

// ---------------------------------------------------------------------------
// 4. setDashPattern
// ---------------------------------------------------------------------------

/**
 * Set (or remove) `stroke-dasharray` on every `<path` element.
 *
 * @param {string} svgString - raw SVG markup
 * @param {string} pattern   - dasharray value, e.g. '6,4'. Empty string
 *                             removes the attribute.
 * @returns {string} modified SVG
 */
export function setDashPattern(svgString, pattern) {
  if (pattern === '' || pattern == null) {
    // Remove existing stroke-dasharray attributes.
    return svgString.replace(/\s*stroke-dasharray="[^"]*"/g, '');
  }

  // For each <path ...> tag, either update existing or append new attribute.
  return svgString.replace(/<path\b[^>]*\/?>/g, (tag) => {
    if (/stroke-dasharray="[^"]*"/.test(tag)) {
      return tag.replace(/stroke-dasharray="[^"]*"/, `stroke-dasharray="${pattern}"`);
    }
    return appendAttr(tag, `stroke-dasharray="${pattern}"`);
  });
}

// ---------------------------------------------------------------------------
// 5. setLinecap
// ---------------------------------------------------------------------------

/**
 * Set `stroke-linecap` and `stroke-linejoin` on every `<path` element.
 *
 * @param {string} svgString - raw SVG markup
 * @param {string} linecap   - e.g. 'round', 'butt', 'square'
 * @param {string} linejoin  - e.g. 'round', 'miter', 'bevel'
 * @returns {string} modified SVG
 */
export function setLinecap(svgString, linecap, linejoin) {
  return svgString.replace(/<path\b[^>]*\/?>/g, (tag) => {
    let updated = tag;

    // --- linecap ---
    if (/stroke-linecap="[^"]*"/.test(updated)) {
      updated = updated.replace(/stroke-linecap="[^"]*"/, `stroke-linecap="${linecap}"`);
    } else {
      updated = appendAttr(updated, `stroke-linecap="${linecap}"`);
    }

    // --- linejoin ---
    if (/stroke-linejoin="[^"]*"/.test(updated)) {
      updated = updated.replace(/stroke-linejoin="[^"]*"/, `stroke-linejoin="${linejoin}"`);
    } else {
      updated = appendAttr(updated, `stroke-linejoin="${linejoin}"`);
    }

    return updated;
  });
}

// ---------------------------------------------------------------------------
// 6. setGroupOpacities
// ---------------------------------------------------------------------------

/**
 * Set the `opacity` attribute on layer groups identified by class name.
 * Expected groups: `<g class="edges" ...>`, `<g class="contours" ...>`,
 * `<g class="hatching" ...>`.
 *
 * @param {string} svgString  - raw SVG markup
 * @param {object} opacities  - { edges: 0-100, contours: 0-100, hatching: 0-100 }
 * @returns {string} modified SVG
 */
export function setGroupOpacities(svgString, opacities) {
  let result = svgString;

  for (const [layer, pct] of Object.entries(opacities)) {
    // Convert 0-100 percentage to 0-1 decimal.
    const opacityValue = (pct / 100).toFixed(2);

    // Match <g ... class="<layer>" ...> (class may not be the first attribute).
    const groupRe = new RegExp(
      `(<g\\b[^>]*\\bclass="${layer}"[^>]*>)`,
      'g'
    );

    result = result.replace(groupRe, (tag) => {
      if (/\bopacity="[^"]*"/.test(tag)) {
        // Update existing opacity attribute.
        return tag.replace(/\bopacity="[^"]*"/, `opacity="${opacityValue}"`);
      }
      return appendAttr(tag, `opacity="${opacityValue}"`);
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// 7. injectFilterDefs
// ---------------------------------------------------------------------------

/**
 * Insert (or replace) a `<defs>` block right after the opening `<svg ...>`
 * tag.  If the SVG already contains `<defs>...</defs>`, that block is
 * replaced with the new markup.
 *
 * @param {string} svgString  - raw SVG markup
 * @param {string} defsMarkup - complete `<defs>...</defs>` string
 * @returns {string} modified SVG
 */
export function injectFilterDefs(svgString, defsMarkup) {
  // If there is already a <defs> block, replace it.
  if (/<defs[\s>][\s\S]*?<\/defs>/i.test(svgString)) {
    return svgString.replace(/<defs[\s>][\s\S]*?<\/defs>/i, defsMarkup);
  }

  // Otherwise, insert right after the opening <svg ...> tag.
  return svgString.replace(/(<svg\b[^>]*>)/i, `$1\n${defsMarkup}`);
}

// ---------------------------------------------------------------------------
// 8. applyGroupFilter
// ---------------------------------------------------------------------------

/**
 * Apply an SVG filter to the edges group, or remove filters from all groups.
 *
 * @param {string}      svgString  - raw SVG markup
 * @param {string|null} filterName - filter id suffix (e.g. 'glow' ->
 *                                   url(#filter-glow)), or null / '' to
 *                                   remove all group filters.
 * @returns {string} modified SVG
 */
export function applyGroupFilter(svgString, filterName) {
  if (!filterName) {
    // Remove filter attributes from all <g> elements.
    return svgString.replace(/(<g\b[^>]*?)\s*filter="[^"]*"/g, '$1');
  }

  const filterAttr = `filter="url(#filter-${filterName})"`;

  // Apply to the edges group specifically.
  return svgString.replace(
    /(<g\b[^>]*\bclass="edges"[^>]*>)/g,
    (tag) => {
      if (/\bfilter="[^"]*"/.test(tag)) {
        // Update existing filter attribute.
        return tag.replace(/\bfilter="[^"]*"/, filterAttr);
      }
      return appendAttr(tag, filterAttr);
    }
  );
}

// ---------------------------------------------------------------------------
// 9. convertToDrawByNumbers
// ---------------------------------------------------------------------------

/**
 * Parse numeric coordinates from an SVG path `d` attribute.
 * Handles M, L (absolute) and C (takes endpoint only).
 * Returns array of {x, y} points.
 */
function parsePathPoints(d) {
  const points = []
  // Match command letter followed by its coordinates
  const re = /([MLCmlc])\s*([-\d.e]+[\s,]+[-\d.e]+(?:[\s,]+[-\d.e]+[\s,]+[-\d.e]+[\s,]+[-\d.e]+[\s,]+[-\d.e]+)?)/g
  let match
  let cx = 0, cy = 0

  while ((match = re.exec(d)) !== null) {
    const cmd = match[1]
    const nums = match[2].match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)
    if (!nums) continue

    const values = nums.map(Number)

    if (cmd === 'M' || cmd === 'L') {
      cx = values[0]; cy = values[1]
      points.push({ x: cx, y: cy })
    } else if (cmd === 'm' || cmd === 'l') {
      cx += values[0]; cy += values[1]
      points.push({ x: cx, y: cy })
    } else if (cmd === 'C') {
      // Cubic Bezier: take endpoint (last pair)
      cx = values[4]; cy = values[5]
      points.push({ x: cx, y: cy })
    } else if (cmd === 'c') {
      cx += values[4]; cy += values[5]
      points.push({ x: cx, y: cy })
    }
  }

  return points
}

/**
 * Subsample a list of points so that consecutive kept points are at least
 * `minDist` pixels apart.  Always keeps the first and last point.
 */
function subsamplePoints(points, minDist) {
  if (points.length <= 2) return points
  const result = [points[0]]
  let last = points[0]
  for (let i = 1; i < points.length - 1; i++) {
    const dx = points[i].x - last.x
    const dy = points[i].y - last.y
    if (dx * dx + dy * dy >= minDist * minDist) {
      result.push(points[i])
      last = points[i]
    }
  }
  result.push(points[points.length - 1])
  return result
}

/**
 * Detect corner points where the direction changes by more than `minAngle`
 * degrees.  Always includes the first and last point of the path.
 * Returns array of {x, y} points.
 */
function detectCorners(points, minAngleDeg) {
  if (points.length <= 2) return [...points]
  const minAngle = minAngleDeg * Math.PI / 180
  const corners = [points[0]]

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const next = points[i + 1]

    const ax = curr.x - prev.x
    const ay = curr.y - prev.y
    const bx = next.x - curr.x
    const by = next.y - curr.y

    const lenA = Math.sqrt(ax * ax + ay * ay)
    const lenB = Math.sqrt(bx * bx + by * by)
    if (lenA < 1 || lenB < 1) continue

    const dot = (ax * bx + ay * by) / (lenA * lenB)
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))

    if (angle >= minAngle) {
      corners.push(curr)
    }
  }

  corners.push(points[points.length - 1])
  return corners
}

/**
 * Evenly select `count` points from an array, always including first and last.
 */
function selectEvenlySpaced(points, count) {
  if (points.length <= count) return points
  if (count <= 2) return [points[0], points[points.length - 1]]
  const result = [points[0]]
  const step = (points.length - 1) / (count - 1)
  for (let i = 1; i < count - 1; i++) {
    result.push(points[Math.round(i * step)])
  }
  result.push(points[points.length - 1])
  return result
}

/**
 * Convert an SVG line drawing into a "draw by numbers" version.
 *
 * Points are placed at corners — where the path changes direction — so
 * a child can draw straight lines between consecutive numbered dots and
 * see the shape emerge.  The maxPoints slider controls the angle
 * sensitivity: fewer points = only sharp corners, more = subtler bends.
 *
 * @param {string} svgString   - Input SVG markup
 * @param {object} [options]
 * @param {number} [options.maxPoints=100]  - Target number of dots (50-200)
 * @param {number} [options.dotRadius=3]   - Radius of each dot
 * @param {number} [options.fontSize=6]    - Font size for the numbers
 * @param {string} [options.dotColor]      - Dot colour (default: current stroke)
 * @param {string} [options.numColor]      - Number colour (default: same as dot)
 * @param {boolean} [options.hideStrokes=false] - Completely hide guide strokes
 * @returns {string} Modified SVG with dots overlay and hidden strokes
 */
export function convertToDrawByNumbers(svgString, options = {}) {
  const {
    maxPoints = 100,
    dotRadius = 3,
    fontSize = 6,
    dotColor = null,
    numColor = null,
    hideStrokes = false,
  } = options

  // Parse all paths into separate chains of points
  const pathChains = []
  const pathDRegex = /\bd\s*=\s*"([^"]*)"/g
  let pathMatch

  while ((pathMatch = pathDRegex.exec(svgString)) !== null) {
    const raw = parsePathPoints(pathMatch[1])
    if (raw.length >= 2) {
      const deduped = subsamplePoints(raw, 3)
      if (deduped.length >= 2) pathChains.push(deduped)
    }
  }

  if (pathChains.length === 0) return svgString

  // Binary search for the right angle threshold to hit ~maxPoints
  // Lower angle = more points (catches subtle bends), higher = fewer (only sharp corners)
  let lo = 5, hi = 120, bestAngle = 30, bestPoints = []
  for (let iter = 0; iter < 15; iter++) {
    const mid = (lo + hi) / 2
    const pts = []
    for (const chain of pathChains) {
      pts.push(...detectCorners(chain, mid))
    }
    bestPoints = pts
    bestAngle = mid
    if (pts.length > maxPoints) {
      lo = mid
    } else if (pts.length < maxPoints * 0.8) {
      hi = mid
    } else {
      break
    }
  }

  // If still too many, trim evenly
  const allPoints = bestPoints.length > maxPoints
    ? selectEvenlySpaced(bestPoints, maxPoints)
    : bestPoints

  // Detect stroke colour from first path if not specified
  let color = dotColor
  if (!color) {
    const strokeMatch = svgString.match(/stroke="([^"]+)"/)
    color = strokeMatch ? strokeMatch[1] : '#c4b5fd'
  }
  const nColor = numColor || color

  // Build dot + number elements
  const dotEls = allPoints.map((p, i) => {
    const num = i + 1
    return [
      `    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${dotRadius}" fill="${color}" opacity="0.8"/>`,
      `    <text x="${(p.x + dotRadius + 1).toFixed(1)}" y="${(p.y + fontSize * 0.35).toFixed(1)}" font-size="${fontSize}" fill="${nColor}" opacity="0.6" font-family="sans-serif">${num}</text>`,
    ].join('\n')
  }).join('\n')

  const dotsGroup = `  <g class="draw-by-numbers">\n${dotEls}\n  </g>`

  // Hide or dim existing path strokes
  const guideOpacity = hideStrokes ? '0' : '0.08'
  let modified = svgString.replace(
    /<g\b([^>]*)\bclass="(edges|contours|hatching)"([^>]*)>/g,
    (tag) => {
      // Replace existing opacity or append it
      if (/\bopacity="[^"]*"/.test(tag)) {
        return tag.replace(/\bopacity="[^"]*"/, `opacity="${guideOpacity}"`)
      }
      return tag.replace(/>$/, ` opacity="${guideOpacity}">`)
    }
  )

  // Remove any existing draw-by-numbers group
  modified = modified.replace(/\s*<g class="draw-by-numbers">[\s\S]*?<\/g>\s*/g, '\n')

  // Insert dots before </svg>
  const closeIdx = modified.lastIndexOf('</svg>')
  if (closeIdx !== -1) {
    modified = modified.slice(0, closeIdx) + dotsGroup + '\n' + modified.slice(closeIdx)
  }

  return modified
}

// ---------------------------------------------------------------------------
// Helpers: colour parsing & spatial cluster merging for halftone dots
// ---------------------------------------------------------------------------

/**
 * Parse an rgb(...) or hex colour string into {r, g, b}.
 */
function parseColor(color) {
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (m) return { r: +m[1], g: +m[2], b: +m[3] }
  const hex = color.replace('#', '')
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    }
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }
  }
  return { r: 196, g: 181, b: 253 }
}

/**
 * Merge nearby halftone dots into larger circles using spatial hashing and
 * union-find.  `mergeFactor` (0–1) controls the merge threshold: how far
 * apart two dots can be (relative to their combined radii) and still merge.
 *
 * Returns a new array of dot objects.  Merged dots have `merged: true` and
 * an area-preserving radius (√Σrᵢ²).
 */
function mergeNearbyClusters(dots, mergeFactor) {
  if (mergeFactor <= 0 || dots.length === 0) return dots

  const n = dots.length

  // ── Union-Find ──
  const parent = Array.from({ length: n }, (_, i) => i)
  const rnk = new Array(n).fill(0)

  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
    return x
  }
  function union(a, b) {
    a = find(a); b = find(b)
    if (a === b) return
    if (rnk[a] < rnk[b]) { const t = a; a = b; b = t }
    parent[b] = a
    if (rnk[a] === rnk[b]) rnk[a]++
  }

  // ── Spatial grid for O(n) neighbour lookup ──
  let maxR = 0
  for (let i = 0; i < n; i++) if (dots[i].radius > maxR) maxR = dots[i].radius
  const cellSize = Math.max(maxR * 2 * (1 + mergeFactor * 2.5), 1)
  const grid = new Map()

  for (let i = 0; i < n; i++) {
    const key = `${Math.floor(dots[i].x / cellSize)},${Math.floor(dots[i].y / cellSize)}`
    let cell = grid.get(key)
    if (!cell) { cell = []; grid.set(key, cell) }
    cell.push(i)
  }

  // ── Find merge pairs ──
  for (let i = 0; i < n; i++) {
    const gx = Math.floor(dots[i].x / cellSize)
    const gy = Math.floor(dots[i].y / cellSize)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get(`${gx + dx},${gy + dy}`)
        if (!cell) continue
        for (const j of cell) {
          if (j <= i) continue
          const distX = dots[i].x - dots[j].x
          const distY = dots[i].y - dots[j].y
          const dist = Math.sqrt(distX * distX + distY * distY)
          const threshold = (dots[i].radius + dots[j].radius) * (1 + mergeFactor * 2.5)
          if (dist < threshold) union(i, j)
        }
      }
    }
  }

  // ── Group clusters ──
  const clusters = new Map()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    let arr = clusters.get(root)
    if (!arr) { arr = []; clusters.set(root, arr) }
    arr.push(i)
  }

  // ── Build merged dots ──
  const result = []
  for (const indices of clusters.values()) {
    if (indices.length === 1) {
      result.push(dots[indices[0]])
      continue
    }

    // Area-weighted centroid + colour blend
    let totalArea = 0, wx = 0, wy = 0
    let rSum = 0, gSum = 0, bSum = 0
    for (const i of indices) {
      const area = dots[i].radius * dots[i].radius
      totalArea += area
      wx += dots[i].x * area
      wy += dots[i].y * area
      const c = parseColor(dots[i].color)
      rSum += c.r * area
      gSum += c.g * area
      bSum += c.b * area
    }

    result.push({
      x: wx / totalArea,
      y: wy / totalArea,
      radius: Math.sqrt(totalArea),
      color: `rgb(${Math.round(rSum / totalArea)},${Math.round(gSum / totalArea)},${Math.round(bSum / totalArea)})`,
      merged: true,
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// 10. convertToHalftone
// ---------------------------------------------------------------------------

/**
 * Convert an SVG line drawing into a halftone dot pattern, like newspaper
 * rasterization.  Each path vertex is replaced with a filled circle whose
 * radius reflects local luminance (darker → larger) and whose colour is
 * sampled from the original photo, producing a full-color halftone effect.
 *
 * Photo data is read from `window.__svgInsights_rgba` if available.
 * Without it, dots use the current stroke colour at uniform size.
 *
 * @param {string} svgString   - Input SVG markup
 * @param {object} [options]
 * @param {number} [options.gridSpacing=6]    - Min pixel spacing between dots
 * @param {number} [options.minRadius=0.4]    - Radius for brightest areas
 * @param {number} [options.maxRadius=3.5]    - Radius for darkest areas
 * @param {number} [options.scale=1.0]        - Overall scale multiplier
 * @param {boolean} [options.usePhotoColors=false] - Colour each dot from photo
 * @param {string} [options.dotColor]         - Fallback dot colour
 * @param {number} [options.merge=0]          - Merge factor (0–1): nearby dots fuse into larger circles
 * @param {number} [options.maxDots=800]      - Cap on dot count for performance
 * @param {string} [options.blend='normal']   - CSS mix-blend-mode for the halftone group
 * @param {number} [options.opacity=100]      - 0–100 opacity for the halftone group
 * @returns {string} Modified SVG with halftone dots and hidden strokes
 */
/**
 * Shared internal: build the raw dot list for halftone rendering (or for
 * interactive gamification modes that need the data without SVG output).
 *
 * Returns { dots, svgW, svgH }.
 */
export function computeHalftoneDots(svgString, options = {}) {
  const {
    gridSpacing = null,    // null = auto-compute from scale (exponential)
    minRadius = 1.0,
    maxRadius = 3.0,       // 1:3 max-to-min ratio ensures visible variation
    scale = 1.0,
    usePhotoColors = false,
    dotColor = null,
    merge = 0,
    maxDots = 4800,
    lightThreshold = 230,  // pixels lighter than this are treated as background
  } = options

  // When gridSpacing isn't explicitly set, make dot density fall off exponentially
  // with dot size: small dots → dense grid, large dots → sparse grid.
  const effSpacing = gridSpacing != null
    ? gridSpacing
    : Math.max(2, 2 * Math.pow(scale, 1.4))

  // Parse SVG dimensions — prefer width/height attrs, fall back to viewBox
  const widthMatch = svgString.match(/\bwidth="(\d+(?:\.\d+)?)"/)
  const heightMatch = svgString.match(/\bheight="(\d+(?:\.\d+)?)"/)
  let svgW = widthMatch ? parseFloat(widthMatch[1]) : null
  let svgH = heightMatch ? parseFloat(heightMatch[1]) : null
  if (svgW == null || svgH == null) {
    const vb = svgString.match(/\bviewBox="([^"]+)"/)
    if (vb) {
      const parts = vb[1].split(/[\s,]+/).map(Number)
      if (parts.length === 4) {
        if (svgW == null) svgW = parts[2]
        if (svgH == null) svgH = parts[3]
      }
    }
  }
  svgW = svgW || 600
  svgH = svgH || 400

  // Get original photo data if available
  const rgba = typeof window !== 'undefined' ? window.__svgInsights_rgba : null

  // Fallback stroke colour
  let fallbackColor = dotColor
  if (!fallbackColor) {
    const strokeMatch = svgString.match(/stroke="([^"]+)"/)
    fallbackColor = strokeMatch ? strokeMatch[1] : '#c4b5fd'
  }

  const rMin = minRadius * scale
  const rMax = maxRadius * scale

  function samplePixel(px, py) {
    if (!rgba || !rgba.width || !rgba.data) return null
    const ix = Math.round((px / svgW) * (rgba.width - 1))
    const iy = Math.round((py / svgH) * (rgba.height - 1))
    const idx = (iy * rgba.width + ix) * 4
    if (idx < 0 || idx + 2 >= rgba.data.length) return null
    const r = rgba.data[idx]
    const g = rgba.data[idx + 1]
    const b = rgba.data[idx + 2]
    return { r, g, b, lum: 0.299 * r + 0.587 * g + 0.114 * b }
  }

  let dots = []

  if (rgba && rgba.width && rgba.data) {
    // ── Grid sampling: cover natural blocks (contiguous fields) in the motif ──
    // A regular grid over the SVG frame. At each cell, sample the photo's luminance
    // and drop a dot if the pixel is dark enough. The dot's radius scales with
    // darkness (within the rMin..rMax range). Small jitter keeps it organic.
    const cellStep = Math.max(2, effSpacing * 0.55)
    const rand = createLCG(1337)

    // Average ~2x2 pixel neighbourhood to smooth over noise
    function sampleAvg(cx, cy) {
      const s1 = samplePixel(cx, cy)
      if (!s1) return null
      const s2 = samplePixel(cx + cellStep * 0.25, cy)
      const s3 = samplePixel(cx, cy + cellStep * 0.25)
      const samples = [s1, s2, s3].filter(Boolean)
      let sr = 0, sg = 0, sb = 0, sl = 0
      for (const s of samples) { sr += s.r; sg += s.g; sb += s.b; sl += s.lum }
      const n = samples.length
      return { r: sr / n, g: sg / n, b: sb / n, lum: sl / n }
    }

    for (let y = cellStep / 2; y < svgH; y += cellStep) {
      for (let x = cellStep / 2; x < svgW; x += cellStep) {
        const sample = sampleAvg(x, y)
        if (!sample) continue
        if (sample.lum > lightThreshold) continue // background pixel — skip

        // Darkness 0..1
        const t = Math.max(0, Math.min(1, (lightThreshold - sample.lum) / lightThreshold))
        const radius = rMin + t * (rMax - rMin)
        if (radius < rMin * 0.5) continue

        const jx = (rand() - 0.5) * cellStep * 0.35
        const jy = (rand() - 0.5) * cellStep * 0.35

        let color = fallbackColor
        if (usePhotoColors) {
          const max = Math.max(sample.r, sample.g, sample.b, 1)
          const boost = 1.15
          const r = Math.min(255, Math.round(sample.r / max * 255 * boost))
          const g = Math.min(255, Math.round(sample.g / max * 255 * boost))
          const b = Math.min(255, Math.round(sample.b / max * 255 * boost))
          color = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
        }

        dots.push({ x: x + jx, y: y + jy, radius, color, merged: false })
      }
    }
  } else {
    // ── Fallback: path-vertex-based placement (when no photo data) ──
    const allPoints = []
    const pathDRegex = /\bd\s*=\s*"([^"]*)"/g
    let pathMatch
    while ((pathMatch = pathDRegex.exec(svgString)) !== null) {
      const raw = parsePathPoints(pathMatch[1])
      const deduped = subsamplePoints(raw, effSpacing)
      allPoints.push(...deduped)
    }
    dots = allPoints.map(p => ({
      x: p.x, y: p.y,
      radius: (rMin + rMax) / 2,
      color: fallbackColor,
      merged: false,
    }))
  }

  // Cap dot count for performance
  if (dots.length > maxDots) {
    const step = dots.length / maxDots
    const capped = []
    for (let i = 0; i < maxDots; i++) capped.push(dots[Math.floor(i * step)])
    dots = capped
  }

  if (merge > 0) {
    dots = mergeNearbyClusters(dots, merge)
  }

  return { dots, svgW, svgH }
}

// ─────────────────────────────────────────────────────────────────────────
// Strek-tab effect filters (v4.11)
// ─────────────────────────────────────────────────────────────────────────

/**
 * trimPaths — remove a fraction of <path> elements from the SVG. Paths are
 * stripped in a stable pseudo-random order (seeded) so sliding back restores
 * exactly what was trimmed. `amount` is in [0, 1] and maps linearly from 0%
 * (keep all) to 100% (keep only 10% — sensible floor so the drawing never
 * fully disappears). Typical usage: the caller caps the slider range itself.
 *
 * Implementation tokenises on the pattern `<path ... />` (self-closing) or
 * `<path ...></path>` (open). Non-path elements are left intact.
 *
 * @param {string} svgString
 * @param {number} amount      0..1 — fraction of paths to REMOVE
 * @param {number} seed        stable seed so the same amount picks the same paths
 * @returns {string}
 */
export function trimPaths(svgString, amount = 0, seed = 1) {
  if (amount <= 0) return svgString
  amount = Math.min(1, Math.max(0, amount))

  // Collect path occurrences (start..end offsets) in document order
  const occurrences = []
  const re = /<path\b[^>]*?(?:\/>|>\s*<\/path>)/gi
  let m
  while ((m = re.exec(svgString)) !== null) {
    occurrences.push({ start: m.index, end: re.lastIndex })
  }
  if (!occurrences.length) return svgString

  // Stable shuffle via seeded LCG — so equal `amount` gives equal result
  const order = occurrences.map((_, i) => i)
  const rand = createLCG(seed)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }

  // Mark the first `amount * total` shuffled indices for removal
  const removeCount = Math.floor(occurrences.length * amount)
  const removeSet = new Set(order.slice(0, removeCount))

  // Rebuild the string by walking original and dropping marked ranges
  let out = ''
  let cursor = 0
  for (let i = 0; i < occurrences.length; i++) {
    const { start, end } = occurrences[i]
    out += svgString.slice(cursor, start)
    if (!removeSet.has(i)) {
      out += svgString.slice(start, end)
    }
    cursor = end
  }
  out += svgString.slice(cursor)
  return out
}

/**
 * simplifyPaths — reduce the number of anchor points in every path using
 * a lightweight Ramer-Douglas-Peucker pass on the raw coordinate stream.
 * `amount` in [0, 1] controls how aggressive the simplification is; 0 is
 * a no-op, 1 strips all but the first and last point of each path.
 *
 * This operates on the flat coordinate list after a cheap tokenise so
 * it's fast enough to run on every keystroke.
 */
export function simplifyPaths(svgString, amount = 0) {
  if (amount <= 0) return svgString
  const tolerance = 0.2 + amount * 8 // 0.2 → 8 px at max
  return svgString.replace(/(\bd\s*=\s*")([^"]*?)(")/g, (_m, pre, d, post) => {
    const simplified = simplifyDAttr(d, tolerance)
    return pre + simplified + post
  })
}

/**
 * spaghettify — the inverse of wobbliness: smooth out high-frequency wiggles
 * in paths. Runs a 3-point moving average over numeric coordinates, keeping
 * command letters intact. `amount` in [0, 1] controls how many smoothing
 * passes are applied (1 → 5 passes).
 */
export function spaghettify(svgString, amount = 0) {
  if (amount <= 0) return svgString
  const passes = Math.max(1, Math.round(amount * 5))
  return svgString.replace(/(\bd\s*=\s*")([^"]*?)(")/g, (_m, pre, d, post) => {
    let cur = d
    for (let i = 0; i < passes; i++) cur = smoothCoords(cur, 0.35)
    return pre + cur + post
  })
}

/**
 * calligraphy — vary stroke-width along the path: give each path a per-stroke
 * tapering profile. Since SVG doesn't support variable stroke width natively,
 * we do it the cheap-but-effective way: we *mark* each path with a calligraphy
 * class + scale. The render pipeline then replaces that class with a chain
 * of substroked copies at varying widths. For now we approximate by writing
 * a stroke-width that's modulated by amount and a flag in a data attribute —
 * consumers can read it later if they want the fancy multi-stroke rendering.
 *
 * `amount` maps [-1, 1]:
 *   -1 → "konkav"   (thickest in the middle, tapered ends) — default pen feel
 *    0 → flat (no variation)
 *   +1 → "konveks" (thickest at ends, thinner middle) — inflated marker
 *
 * The actual visual variation is produced by duplicating each path with a
 * slightly shrunken `stroke-dasharray`, which gives a pseudo-tapered effect.
 */
export function calligraphy(svgString, amount = 0) {
  if (Math.abs(amount) < 0.01) return svgString
  const sign = amount > 0 ? 1 : -1
  const strength = Math.min(1, Math.abs(amount))

  return svgString.replace(
    /<path\b([^>]*?)\/>/gi,
    (_m, attrs) => {
      // Extract existing stroke-width if any
      const wMatch = attrs.match(/stroke-width\s*=\s*"([^"]+)"/i)
      const baseW = wMatch ? parseFloat(wMatch[1]) : 1
      // For "konkav" (sign=-1): ends thin, middle thick → outer stroke narrower
      // For "konveks" (sign=+1): ends thick, middle thin → outer stroke wider
      const widths = sign < 0
        ? [baseW * (1 - strength * 0.7), baseW * (1 + strength * 0.2)]
        : [baseW * (1 + strength * 0.5), baseW * (1 - strength * 0.4)]

      // Layer two copies: wide underlay + narrow overlay or vice versa
      const cleaned = attrs.replace(/stroke-width\s*=\s*"[^"]+"/i, '')
      const layer1 = `<path${cleaned} stroke-width="${widths[0].toFixed(3)}" stroke-linecap="round" opacity="0.85"/>`
      const layer2 = `<path${cleaned} stroke-width="${widths[1].toFixed(3)}" stroke-linecap="round"/>`
      return layer1 + layer2
    }
  )
}

/**
 * kurvatur — named after the Norwegian cartoonist (Pondus, Rocky …) who only
 * draws with straight lines. `amount` in [0, 1] converts the given fraction
 * of curves (C, Q, S, T) to straight lines. 0 = keep all curves, 1 = all
 * straightened. Selection is stable (seeded shuffle) so the same amount
 * gives the same subset.
 */
export function kurvatur(svgString, amount = 0, seed = 7) {
  if (amount <= 0) return svgString
  amount = Math.min(1, Math.max(0, amount))

  return svgString.replace(/(\bd\s*=\s*")([^"]*?)(")/g, (_m, pre, d, post) => {
    // Find curve-command positions so we can choose a stable subset
    const curveRe = /([CcSsQqTt])([^A-Za-z]*)/g
    const matches = []
    let cm
    while ((cm = curveRe.exec(d)) !== null) {
      matches.push({ start: cm.index, end: curveRe.lastIndex, cmd: cm[1], args: cm[2] })
    }
    if (!matches.length) return pre + d + post

    const rand = createLCG(seed)
    const order = matches.map((_, i) => i)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    const flipCount = Math.floor(matches.length * amount)
    const flipSet = new Set(order.slice(0, flipCount))

    let out = ''
    let cursor = 0
    for (let i = 0; i < matches.length; i++) {
      const { start, end, cmd, args } = matches[i]
      out += d.slice(cursor, start)
      if (flipSet.has(i)) {
        // Replace curve with line to the ENDPOINT of the curve
        const nums = args.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) || []
        // C/S take 6 coords per segment; Q/T take 4 or 2. Endpoint is the
        // last pair in the argument list.
        if (nums.length >= 2) {
          const ex = nums[nums.length - 2]
          const ey = nums[nums.length - 1]
          out += (cmd === cmd.toUpperCase() ? 'L' : 'l') + ex + ',' + ey + ' '
        } else {
          out += cmd + args // malformed, leave untouched
        }
      } else {
        out += cmd + args
      }
      cursor = end
    }
    out += d.slice(cursor)
    return pre + out + post
  })
}

/**
 * setStrokeOpacity — sets stroke-opacity on every <path> element to the given
 * value in [0, 1]. Useful for a "strøk-transparens"-slider that dims lines
 * without affecting fills or halftone dots.
 */
export function setStrokeOpacity(svgString, opacity = 1) {
  opacity = Math.min(1, Math.max(0, opacity))
  const opStr = opacity.toFixed(3)
  return svgString.replace(/<path\b([^>]*?)(\/?)>/gi, (_m, attrs, slash) => {
    // Remove existing stroke-opacity, then inject ours
    const cleaned = attrs.replace(/\s*stroke-opacity\s*=\s*"[^"]*"/gi, '')
    return `<path${cleaned} stroke-opacity="${opStr}"${slash}>`
  })
}

/**
 * setHatchOpacity — dims hatching / shading strokes that live inside groups
 * whose id starts with "hatch" or class contains "hatch". Falls back to
 * styling the group itself via an opacity attribute.
 */
export function setHatchOpacity(svgString, opacity = 1) {
  opacity = Math.min(1, Math.max(0, opacity))
  const opStr = opacity.toFixed(3)
  return svgString.replace(
    /<g\b([^>]*?(?:id\s*=\s*"[^"]*hatch[^"]*"|class\s*=\s*"[^"]*hatch[^"]*")[^>]*?)>/gi,
    (_m, attrs) => {
      const cleaned = attrs.replace(/\s*opacity\s*=\s*"[^"]*"/gi, '')
      return `<g${cleaned} opacity="${opStr}">`
    }
  )
}

// ── Internal helpers for the new filters ────────────────────────────────

/**
 * Simplify a single `d` attribute string using Ramer-Douglas-Peucker on
 * consecutive M/L/C/Q/T/S endpoints. Curve control points are preserved; we
 * only thin out the anchor chain.
 */
function simplifyDAttr(d, tolerance) {
  // Tokenise into commands with their arg arrays
  const tokens = []
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^A-Za-z]*)/g
  let m
  while ((m = re.exec(d)) !== null) {
    const nums = (m[2].match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) || []).map(parseFloat)
    tokens.push({ cmd: m[1], nums })
  }
  if (tokens.length < 3) return d

  // Build the endpoint chain (pairs of [x, y]) and keep command metadata so
  // we can rebuild afterwards with the same command letters, just fewer.
  const points = []
  const cmds = []
  let cx = 0, cy = 0
  for (const { cmd, nums } of tokens) {
    if (cmd === 'Z' || cmd === 'z') {
      cmds.push({ cmd: 'Z', nums: [] })
      continue
    }
    // Last two numbers are the endpoint for most commands
    if (nums.length >= 2) {
      const ex = nums[nums.length - 2]
      const ey = nums[nums.length - 1]
      const isRel = cmd === cmd.toLowerCase()
      const x = isRel ? cx + ex : ex
      const y = isRel ? cy + ey : ey
      points.push([x, y])
      cmds.push({ cmd, nums, pointIndex: points.length - 1 })
      cx = x; cy = y
    } else {
      cmds.push({ cmd, nums })
    }
  }

  // RDP pass — identify which points to keep
  const keep = new Uint8Array(points.length)
  if (points.length <= 2) points.forEach((_, i) => keep[i] = 1)
  else rdp(points, 0, points.length - 1, tolerance, keep)

  // Rebuild — keep every non-point command, and only kept endpoint commands
  const out = []
  for (const c of cmds) {
    if (c.nums == null || c.nums.length === 0) {
      out.push(c.cmd)
      continue
    }
    if (c.pointIndex != null && !keep[c.pointIndex]) continue
    out.push(c.cmd + c.nums.join(','))
  }
  return out.join('')
}

function rdp(points, start, end, tol, keep) {
  keep[start] = 1
  keep[end] = 1
  if (end <= start + 1) return
  let maxD = 0, maxIdx = -1
  const [sx, sy] = points[start]
  const [ex, ey] = points[end]
  for (let i = start + 1; i < end; i++) {
    const d = perpDist(points[i], sx, sy, ex, ey)
    if (d > maxD) { maxD = d; maxIdx = i }
  }
  if (maxD > tol && maxIdx >= 0) {
    rdp(points, start, maxIdx, tol, keep)
    rdp(points, maxIdx, end, tol, keep)
  }
}

function perpDist([x, y], sx, sy, ex, ey) {
  const dx = ex - sx, dy = ey - sy
  const len = Math.hypot(dx, dy) || 1
  return Math.abs((dy * x - dx * y + ex * sy - ey * sx) / len)
}

/**
 * Run a moving-average smoothing pass over numbers within a `d` attribute
 * while keeping command letters intact.
 */
function smoothCoords(d, strength = 0.3) {
  // Extract all numbers with positions
  const nums = []
  const re = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
  let m
  while ((m = re.exec(d)) !== null) {
    nums.push({ value: parseFloat(m[0]), start: m.index, end: re.lastIndex })
  }
  if (nums.length < 6) return d // too short to meaningfully smooth

  // Smooth in pairs (x, y) — pair index is `i / 2` treated as a sequence
  const values = nums.map(n => n.value)
  const smoothed = values.slice()
  for (let i = 2; i < values.length - 2; i += 2) {
    // Average with neighbours on same axis (two pairs back and forward)
    smoothed[i] = values[i] * (1 - strength) + (values[i - 2] + values[i + 2]) * 0.5 * strength
    smoothed[i + 1] = values[i + 1] * (1 - strength) + (values[i - 1] + values[i + 3]) * 0.5 * strength
  }

  // Rebuild string: walk original and splice smoothed values in
  let out = ''
  let cursor = 0
  for (let i = 0; i < nums.length; i++) {
    out += d.slice(cursor, nums[i].start)
    out += smoothed[i].toFixed(2)
    cursor = nums[i].end
  }
  out += d.slice(cursor)
  return out
}


export function convertToHalftone(svgString, options = {}) {
  const {
    blend = 'normal',
    opacity = 100,
  } = options

  const { dots } = computeHalftoneDots(svgString, options)

  if (dots.length === 0) return svgString

  // Generate SVG circles
  const hasMerged = dots.some(d => d.merged)
  const circles = dots.map(d => {
    let attrs = `cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${d.radius.toFixed(2)}" fill="${d.color}"`
    if (d.merged) {
      const delay = (((d.x * 7 + d.y * 13) | 0) % 500) / 1000
      attrs += ` class="ht-merged" style="animation-delay:${delay.toFixed(2)}s"`
    }
    return `    <circle ${attrs}/>`
  }).join('\n')

  // Ripple animation style for merged dots
  const mergeStyle = hasMerged ? `    <style>
      .ht-merged {
        transform-box: fill-box;
        transform-origin: center;
        animation: ht-ripple 0.7s ease-out both;
      }
      @keyframes ht-ripple {
        0%   { transform: scale(0.4); opacity: 0.5; }
        60%  { transform: scale(1.18); opacity: 1; }
        100% { transform: scale(1); opacity: 0.93; }
      }
    </style>\n` : ''

  const opacityVal = (Math.max(0, Math.min(100, opacity)) / 100).toFixed(2)
  const styleAttr = blend && blend !== 'normal' ? ` style="mix-blend-mode:${blend}"` : ''
  const halftoneGroup = `  <g class="halftone-dots" opacity="${opacityVal}"${styleAttr}>\n${mergeStyle}${circles}\n  </g>`

  // NOTE: guide strokes (edges/contours/hatching) keep whatever opacity the
  // user set in the "Lag" tab. Halftone sits on top of them without forcing
  // them to fade.

  // Remove any existing halftone group
  let modified = svgString.replace(/\s*<g class="halftone-dots"[^>]*>[\s\S]*?<\/g>\s*/g, '\n')

  // Insert before </svg>
  const closeIdx = modified.lastIndexOf('</svg>')
  if (closeIdx !== -1) {
    modified = modified.slice(0, closeIdx) + halftoneGroup + '\n' + modified.slice(closeIdx)
  }

  return modified
}
