/**
 * Parametric 3D human wireframe generator.
 *
 * Generates SVG wireframe meshes of a human figure, similar to 3D modelling
 * wireframes — a grid of connected vertices projected with perspective.
 *
 * Body is defined as a stack of elliptical cross-sections along the Y axis.
 * Each limb/segment is a "tube" with configurable radius at each height.
 * Facial features are separate detail paths.
 */

// ─── 3D math helpers ────────────────────────────────────────────────

function vec3(x, y, z) { return { x, y, z } }

function rotateY(p, angle) {
  const c = Math.cos(angle), s = Math.sin(angle)
  return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c)
}

function rotateX(p, angle) {
  const c = Math.cos(angle), s = Math.sin(angle)
  return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c)
}

function project(p, fov = 800, cz = 400) {
  const scale = fov / (fov + p.z + cz)
  return { x: p.x * scale, y: p.y * scale, depth: p.z }
}

// ─── Body definition ────────────────────────────────────────────────

/**
 * A body segment is a tube defined by cross-section ellipses.
 * Each ring: { y, rx, rz, ox, oy, oz } (radii and offsets)
 */
function createBodyProfile() {
  // All coordinates: Y=0 is feet, Y goes up
  // Each entry: [y, radiusX, radiusZ, offsetX, offsetZ]
  return {
    torso: {
      rings: [
        { y: 95,  rx: 18, rz: 12, ox: 0, oz: 0 },  // waist
        { y: 105, rx: 20, rz: 13, ox: 0, oz: 0 },  // lower ribs
        { y: 115, rx: 22, rz: 14, ox: 0, oz: 0 },  // ribs
        { y: 125, rx: 23, rz: 14, ox: 0, oz: -1 }, // chest
        { y: 135, rx: 22, rz: 13, ox: 0, oz: -1 }, // upper chest
        { y: 142, rx: 19, rz: 11, ox: 0, oz: 0 },  // shoulders base
        { y: 148, rx: 16, rz: 10, ox: 0, oz: 0 },  // neck base
      ],
      segments: 16,
    },
    hip: {
      rings: [
        { y: 80,  rx: 16, rz: 11, ox: 0, oz: 0 },  // upper thigh connect
        { y: 85,  rx: 19, rz: 13, ox: 0, oz: 0 },  // hip
        { y: 90,  rx: 20, rz: 14, ox: 0, oz: 0 },  // widest hip
        { y: 95,  rx: 18, rz: 12, ox: 0, oz: 0 },  // waist connect
      ],
      segments: 16,
    },
    neck: {
      rings: [
        { y: 148, rx: 7,  rz: 7,  ox: 0, oz: 0 },
        { y: 153, rx: 6.5,rz: 6.5,ox: 0, oz: 0 },
        { y: 158, rx: 6,  rz: 6,  ox: 0, oz: 0 },
      ],
      segments: 10,
    },
    head: {
      rings: [
        { y: 158, rx: 8,  rz: 8,  ox: 0, oz: 0 },  // base
        { y: 162, rx: 9,  rz: 9.5,ox: 0, oz: 0 },
        { y: 166, rx: 9.5,rz: 10, ox: 0, oz: 0 },  // ear level
        { y: 170, rx: 9.5,rz: 10, ox: 0, oz: -0.5 },
        { y: 174, rx: 9,  rz: 9.5,ox: 0, oz: -1 },  // brow
        { y: 178, rx: 8,  rz: 8.5,ox: 0, oz: -1 },
        { y: 182, rx: 6,  rz: 6.5,ox: 0, oz: -0.5 },
        { y: 185, rx: 3,  rz: 3,  ox: 0, oz: 0 },  // crown
      ],
      segments: 12,
    },
    // Left arm segments
    leftUpperArm: {
      rings: [
        { y: 142, rx: 5.5,rz: 5,  ox: -23, oz: 0 },  // shoulder
        { y: 135, rx: 5,  rz: 4.5,ox: -26, oz: 0 },
        { y: 127, rx: 4.5,rz: 4,  ox: -28, oz: 0 },
        { y: 118, rx: 4,  rz: 3.5,ox: -30, oz: 0 },  // elbow
      ],
      segments: 8,
    },
    leftForearm: {
      rings: [
        { y: 118, rx: 4,  rz: 3.5,ox: -30, oz: 0 },  // elbow
        { y: 110, rx: 3.5,rz: 3,  ox: -31, oz: 0 },
        { y: 102, rx: 3,  rz: 2.5,ox: -32, oz: 0 },
        { y: 95,  rx: 2.5,rz: 2,  ox: -33, oz: 0 },  // wrist
      ],
      segments: 8,
    },
    leftHand: {
      rings: [
        { y: 95,  rx: 2.5,rz: 1.5,ox: -33, oz: 0 },  // wrist
        { y: 91,  rx: 3.5,rz: 1.5,ox: -33.5,oz: 0 },
        { y: 87,  rx: 3,  rz: 1.3,ox: -34, oz: 0 },
        { y: 84,  rx: 2,  rz: 1,  ox: -34, oz: 0 },   // fingertips
      ],
      segments: 8,
    },
    // Right arm (mirror)
    rightUpperArm: {
      rings: [
        { y: 142, rx: 5.5,rz: 5,  ox: 23,  oz: 0 },
        { y: 135, rx: 5,  rz: 4.5,ox: 26,  oz: 0 },
        { y: 127, rx: 4.5,rz: 4,  ox: 28,  oz: 0 },
        { y: 118, rx: 4,  rz: 3.5,ox: 30,  oz: 0 },
      ],
      segments: 8,
    },
    rightForearm: {
      rings: [
        { y: 118, rx: 4,  rz: 3.5,ox: 30,  oz: 0 },
        { y: 110, rx: 3.5,rz: 3,  ox: 31,  oz: 0 },
        { y: 102, rx: 3,  rz: 2.5,ox: 32,  oz: 0 },
        { y: 95,  rx: 2.5,rz: 2,  ox: 33,  oz: 0 },
      ],
      segments: 8,
    },
    rightHand: {
      rings: [
        { y: 95,  rx: 2.5,rz: 1.5,ox: 33,  oz: 0 },
        { y: 91,  rx: 3.5,rz: 1.5,ox: 33.5,oz: 0 },
        { y: 87,  rx: 3,  rz: 1.3,ox: 34,  oz: 0 },
        { y: 84,  rx: 2,  rz: 1,  ox: 34,  oz: 0 },
      ],
      segments: 8,
    },
    // Left leg
    leftUpperLeg: {
      rings: [
        { y: 80,  rx: 8,  rz: 7,  ox: -10, oz: 0 },  // hip joint
        { y: 72,  rx: 7.5,rz: 6.5,ox: -10, oz: 0 },
        { y: 63,  rx: 7,  rz: 6,  ox: -10, oz: 0 },
        { y: 53,  rx: 6,  rz: 5.5,ox: -10, oz: 0 },  // knee
      ],
      segments: 10,
    },
    leftLowerLeg: {
      rings: [
        { y: 53,  rx: 5.5,rz: 5,  ox: -10, oz: 0 },  // knee
        { y: 45,  rx: 5,  rz: 4.5,ox: -10, oz: 0 },
        { y: 35,  rx: 4,  rz: 3.5,ox: -10, oz: 0 },
        { y: 25,  rx: 3.5,rz: 3,  ox: -10, oz: 0 },
        { y: 18,  rx: 3,  rz: 3,  ox: -10, oz: 0 },   // ankle
      ],
      segments: 10,
    },
    leftFoot: {
      rings: [
        { y: 18,  rx: 3,  rz: 3,  ox: -10, oz: 0 },   // ankle
        { y: 14,  rx: 3.5,rz: 4,  ox: -10, oz: -2 },
        { y: 10,  rx: 4,  rz: 5.5,ox: -10, oz: -4 },
        { y: 8,   rx: 3.5,rz: 6,  ox: -10, oz: -5 },   // toe
      ],
      segments: 8,
    },
    // Right leg (mirror)
    rightUpperLeg: {
      rings: [
        { y: 80,  rx: 8,  rz: 7,  ox: 10,  oz: 0 },
        { y: 72,  rx: 7.5,rz: 6.5,ox: 10,  oz: 0 },
        { y: 63,  rx: 7,  rz: 6,  ox: 10,  oz: 0 },
        { y: 53,  rx: 6,  rz: 5.5,ox: 10,  oz: 0 },
      ],
      segments: 10,
    },
    rightLowerLeg: {
      rings: [
        { y: 53,  rx: 5.5,rz: 5,  ox: 10,  oz: 0 },
        { y: 45,  rx: 5,  rz: 4.5,ox: 10,  oz: 0 },
        { y: 35,  rx: 4,  rz: 3.5,ox: 10,  oz: 0 },
        { y: 25,  rx: 3.5,rz: 3,  ox: 10,  oz: 0 },
        { y: 18,  rx: 3,  rz: 3,  ox: 10,  oz: 0 },
      ],
      segments: 10,
    },
    rightFoot: {
      rings: [
        { y: 18,  rx: 3,  rz: 3,  ox: 10,  oz: 0 },
        { y: 14,  rx: 3.5,rz: 4,  ox: 10,  oz: -2 },
        { y: 10,  rx: 4,  rz: 5.5,ox: 10,  oz: -4 },
        { y: 8,   rx: 3.5,rz: 6,  ox: 10,  oz: -5 },
      ],
      segments: 8,
    },
  }
}

// ─── Facial features (3D points on the head surface) ────────────────

function createFacialFeatures() {
  // Defined relative to head center at y≈170
  const headCY = 170
  const headCX = 0
  const headCZ = 0

  return {
    leftEye: {
      // Elliptical eye shape
      type: 'ellipse',
      cx: headCX - 4, cy: headCY + 2, cz: headCZ - 10,
      rx: 2.2, ry: 1.2,
      segments: 10,
    },
    rightEye: {
      type: 'ellipse',
      cx: headCX + 4, cy: headCY + 2, cz: headCZ - 10,
      rx: 2.2, ry: 1.2,
      segments: 10,
    },
    leftPupil: {
      type: 'ellipse',
      cx: headCX - 4, cy: headCY + 2, cz: headCZ - 10.5,
      rx: 0.9, ry: 0.9,
      segments: 8,
    },
    rightPupil: {
      type: 'ellipse',
      cx: headCX + 4, cy: headCY + 2, cz: headCZ - 10.5,
      rx: 0.9, ry: 0.9,
      segments: 8,
    },
    nose: {
      type: 'path',
      points: [
        vec3(headCX - 1, headCY + 2, headCZ - 10),
        vec3(headCX - 0.5, headCY, headCZ - 11.5),
        vec3(headCX, headCY - 2, headCZ - 12),
        vec3(headCX + 0.5, headCY - 2.5, headCZ - 11.5),
        vec3(headCX - 0.5, headCY - 2.5, headCZ - 11.5),
        vec3(headCX, headCY - 2, headCZ - 12),
      ],
    },
    noseBottom: {
      type: 'path',
      points: [
        vec3(headCX - 2, headCY - 2, headCZ - 10.5),
        vec3(headCX - 1, headCY - 2.8, headCZ - 11),
        vec3(headCX, headCY - 3, headCZ - 11.2),
        vec3(headCX + 1, headCY - 2.8, headCZ - 11),
        vec3(headCX + 2, headCY - 2, headCZ - 10.5),
      ],
    },
    mouth: {
      type: 'path',
      points: [
        vec3(headCX - 3.5, headCY - 5, headCZ - 9.5),
        vec3(headCX - 2, headCY - 5.5, headCZ - 10),
        vec3(headCX, headCY - 5.8, headCZ - 10.2),
        vec3(headCX + 2, headCY - 5.5, headCZ - 10),
        vec3(headCX + 3.5, headCY - 5, headCZ - 9.5),
      ],
    },
    upperLip: {
      type: 'path',
      points: [
        vec3(headCX - 3.5, headCY - 5, headCZ - 9.5),
        vec3(headCX - 1.5, headCY - 4.7, headCZ - 10),
        vec3(headCX, headCY - 4.3, headCZ - 10.3),
        vec3(headCX + 1.5, headCY - 4.7, headCZ - 10),
        vec3(headCX + 3.5, headCY - 5, headCZ - 9.5),
      ],
    },
    leftEar: {
      type: 'path',
      points: [
        vec3(headCX - 10, headCY + 3, headCZ + 1),
        vec3(headCX - 11.5, headCY + 4, headCZ + 2),
        vec3(headCX - 12, headCY + 2, headCZ + 2),
        vec3(headCX - 11.5, headCY, headCZ + 1.5),
        vec3(headCX - 10, headCY - 1, headCZ + 1),
      ],
    },
    rightEar: {
      type: 'path',
      points: [
        vec3(headCX + 10, headCY + 3, headCZ + 1),
        vec3(headCX + 11.5, headCY + 4, headCZ + 2),
        vec3(headCX + 12, headCY + 2, headCZ + 2),
        vec3(headCX + 11.5, headCY, headCZ + 1.5),
        vec3(headCX + 10, headCY - 1, headCZ + 1),
      ],
    },
    leftEyebrow: {
      type: 'path',
      points: [
        vec3(headCX - 6, headCY + 3.5, headCZ - 9.5),
        vec3(headCX - 4.5, headCY + 4.2, headCZ - 10),
        vec3(headCX - 3, headCY + 4.5, headCZ - 10.2),
        vec3(headCX - 1.5, headCY + 4.2, headCZ - 10),
      ],
    },
    rightEyebrow: {
      type: 'path',
      points: [
        vec3(headCX + 1.5, headCY + 4.2, headCZ - 10),
        vec3(headCX + 3, headCY + 4.5, headCZ - 10.2),
        vec3(headCX + 4.5, headCY + 4.2, headCZ - 10),
        vec3(headCX + 6, headCY + 3.5, headCZ - 9.5),
      ],
    },
  }
}

// ─── Mesh generation ────────────────────────────────────────────────

function generateTubeMesh(segment) {
  const { rings, segments } = segment
  const grid = [] // [ring][segment] = vec3

  for (const ring of rings) {
    const row = []
    for (let s = 0; s <= segments; s++) {
      const angle = (s / segments) * Math.PI * 2
      const x = ring.ox + ring.rx * Math.cos(angle)
      const z = ring.oz + ring.rz * Math.sin(angle)
      const y = ring.y
      row.push(vec3(x, y, z))
    }
    grid.push(row)
  }

  return grid
}

function transformGrid(grid, rotX, rotY) {
  return grid.map(row =>
    row.map(p => {
      // Center vertically (body center at y≈97)
      let tp = vec3(p.x, p.y - 97, p.z)
      tp = rotateY(tp, rotY)
      tp = rotateX(tp, rotX)
      return tp
    })
  )
}

function projectGrid(grid, fov, cz) {
  return grid.map(row =>
    row.map(p => project(p, fov, cz))
  )
}

// ─── SVG rendering ──────────────────────────────────────────────────

function gridToSvgPaths(projected, strokeColor, strokeWidth) {
  const paths = []

  // Horizontal rings
  for (let r = 0; r < projected.length; r++) {
    const row = projected[r]
    let d = `M${row[0].x.toFixed(2)},${(-row[0].y).toFixed(2)}`
    for (let s = 1; s < row.length; s++) {
      d += ` L${row[s].x.toFixed(2)},${(-row[s].y).toFixed(2)}`
    }
    paths.push(d)
  }

  // Vertical lines connecting rings
  if (projected.length > 1) {
    const segs = projected[0].length
    for (let s = 0; s < segs; s++) {
      let d = `M${projected[0][s].x.toFixed(2)},${(-projected[0][s].y).toFixed(2)}`
      for (let r = 1; r < projected.length; r++) {
        if (s < projected[r].length) {
          d += ` L${projected[r][s].x.toFixed(2)},${(-projected[r][s].y).toFixed(2)}`
        }
      }
      paths.push(d)
    }
  }

  return paths
}

function featureToSvgPath(feature, rotX, rotY, fov, cz) {
  const transform = (p) => {
    let tp = vec3(p.x, p.y - 97, p.z)
    tp = rotateY(tp, rotY)
    tp = rotateX(tp, rotX)
    return project(tp, fov, cz)
  }

  if (feature.type === 'ellipse') {
    const points = []
    for (let i = 0; i <= feature.segments; i++) {
      const angle = (i / feature.segments) * Math.PI * 2
      const p = vec3(
        feature.cx + feature.rx * Math.cos(angle),
        feature.cy + feature.ry * Math.sin(angle),
        feature.cz
      )
      points.push(transform(p))
    }
    let d = `M${points[0].x.toFixed(2)},${(-points[0].y).toFixed(2)}`
    for (let i = 1; i < points.length; i++) {
      d += ` L${points[i].x.toFixed(2)},${(-points[i].y).toFixed(2)}`
    }
    d += ' Z'
    return d
  }

  if (feature.type === 'path') {
    const points = feature.points.map(transform)
    let d = `M${points[0].x.toFixed(2)},${(-points[0].y).toFixed(2)}`
    for (let i = 1; i < points.length; i++) {
      d += ` L${points[i].x.toFixed(2)},${(-points[i].y).toFixed(2)}`
    }
    return d
  }

  return ''
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Generate a full human wireframe SVG.
 *
 * @param {Object} options
 * @param {number} options.rotationY  - Y-axis rotation in radians (0 = front, PI/4 = 3/4 view, PI/2 = side)
 * @param {number} options.rotationX  - X-axis tilt in radians
 * @param {number} options.width      - SVG width
 * @param {number} options.height     - SVG height
 * @param {string} options.stroke     - Stroke color
 * @param {number} options.strokeWidth - Stroke width
 * @param {number} options.fov        - Perspective field of view
 * @param {boolean} options.showFace  - Whether to render facial features
 * @returns {{ svg: string, pathCount: number }}
 */
export function generateHumanWireframe(options = {}) {
  const {
    rotationY = 0,
    rotationX = 0,
    width = 400,
    height = 600,
    stroke = 'currentColor',
    strokeWidth = 0.8,
    fov = 800,
    showFace = true,
  } = options

  const cz = 200
  const body = createBodyProfile()
  const allPaths = []

  // Generate mesh for each body segment
  for (const key of Object.keys(body)) {
    const segment = body[key]
    const grid = generateTubeMesh(segment)
    const transformed = transformGrid(grid, rotationX, rotationY)
    const projected = projectGrid(transformed, fov, cz)
    const paths = gridToSvgPaths(projected, stroke, strokeWidth)
    allPaths.push(...paths)
  }

  // Facial features
  const facePaths = []
  if (showFace) {
    const features = createFacialFeatures()
    for (const key of Object.keys(features)) {
      const d = featureToSvgPath(features[key], rotationX, rotationY, fov, cz)
      if (d) facePaths.push(d)
    }
  }

  // Build SVG
  const bodyPathEls = allPaths
    .map(d => `    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity="0.6"/>`)
    .join('\n')

  const facePathEls = facePaths
    .map(d => `    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth * 1.4}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity="0.9"/>`)
    .join('\n')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-width/2} ${-height/2} ${width} ${height}" width="${width}" height="${height}" class="w-full h-full">
  <g class="wireframe-body">
${bodyPathEls}
  </g>
  <g class="wireframe-face">
${facePathEls}
  </g>
</svg>`

  return { svg, pathCount: allPaths.length + facePaths.length }
}

/**
 * Generate a multi-view panel (front, 3/4, side) like a character sheet.
 */
export function generateCharacterSheet(options = {}) {
  const {
    width = 900,
    height = 500,
    stroke = 'currentColor',
    strokeWidth = 0.7,
  } = options

  const views = [
    { label: '3/4', rotY: -Math.PI / 5, rotX: 0.05 },
    { label: 'Front', rotY: 0, rotX: 0 },
    { label: 'Side', rotY: Math.PI / 2, rotX: 0 },
  ]

  const panelW = width / 3
  let allContent = ''
  let totalPaths = 0

  views.forEach((view, i) => {
    const result = generateHumanWireframe({
      rotationY: view.rotY,
      rotationX: view.rotX,
      width: panelW - 20,
      height: height - 40,
      stroke,
      strokeWidth,
      fov: 900,
    })
    totalPaths += result.pathCount

    // Extract inner content from the generated SVG
    const inner = result.svg
      .replace(/<svg[^>]*>/, '')
      .replace(/<\/svg>/, '')

    const offsetX = i * panelW + panelW / 2
    const offsetY = height / 2
    allContent += `  <g transform="translate(${offsetX}, ${offsetY})">\n${inner}\n  </g>\n`
  })

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="w-full h-full">
${allContent}</svg>`

  return { svg, pathCount: totalPaths }
}
