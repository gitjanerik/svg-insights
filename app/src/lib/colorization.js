/**
 * colorization.js
 *
 * Module for colorizing SVG line drawings by detecting regions and filling
 * them with colors sampled from the original photo. All functions are pure
 * (no DOM, no DOMParser, no canvas) so they can be tested with vitest.
 */

// ---------------------------------------------------------------------------
// 1. Color space helpers
// ---------------------------------------------------------------------------

/**
 * Convert RGB (0-255) to HSL.
 * @param {number} r - Red channel (0-255)
 * @param {number} g - Green channel (0-255)
 * @param {number} b - Blue channel (0-255)
 * @returns {{h: number, s: number, l: number}} HSL where h=0-360, s=0-100, l=0-100
 */
export function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    if (max === rn) {
      h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
    } else if (max === gn) {
      h = ((bn - rn) / delta + 2) * 60;
    } else {
      h = ((rn - gn) / delta + 4) * 60;
    }
  }

  return {
    h: Math.round(h * 100) / 100,
    s: Math.round(s * 10000) / 100,
    l: Math.round(l * 10000) / 100,
  };
}

/**
 * Convert HSL back to RGB.
 * @param {number} h - Hue (0-360)
 * @param {number} s - Saturation (0-100)
 * @param {number} l - Lightness (0-100)
 * @returns {{r: number, g: number, b: number}} RGB (0-255)
 */
export function hslToRgb(h, s, l) {
  const sn = s / 100;
  const ln = l / 100;

  if (sn === 0) {
    const val = Math.round(ln * 255);
    return { r: val, g: val, b: val };
  }

  const hueToRgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hn = h / 360;

  return {
    r: Math.round(hueToRgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, hn) * 255),
    b: Math.round(hueToRgb(p, q, hn - 1 / 3) * 255),
  };
}

// ---------------------------------------------------------------------------
// 2. Region detection
// ---------------------------------------------------------------------------

/**
 * BFS flood-fill from a starting pixel on a binary mask.
 * Only fills pixels where mask[i] === 0 (empty / non-edge).
 * 4-connected neighbors.
 *
 * @param {Uint8Array} mask  - Binary mask (1=edge, 0=empty)
 * @param {number} w         - Width of the mask
 * @param {number} h         - Height of the mask
 * @param {number} startX    - Starting X coordinate
 * @param {number} startY    - Starting Y coordinate
 * @returns {Array<[number, number]>} Array of [x, y] coordinate pairs
 */
export function floodFill(mask, w, h, startX, startY) {
  const startIdx = startY * w + startX;
  if (mask[startIdx] !== 0) return [];

  const visited = new Uint8Array(w * h);
  const pixels = [];

  // Use a typed-array queue for performance
  // Maximum possible queue size is w*h
  const queueX = new Int32Array(w * h);
  const queueY = new Int32Array(w * h);
  let qHead = 0;
  let qTail = 0;

  queueX[qTail] = startX;
  queueY[qTail] = startY;
  qTail++;
  visited[startIdx] = 1;

  // 4-connected neighbor offsets
  const dx = [1, -1, 0, 0];
  const dy = [0, 0, 1, -1];

  while (qHead < qTail) {
    const cx = queueX[qHead];
    const cy = queueY[qHead];
    qHead++;

    pixels.push([cx, cy]);

    for (let d = 0; d < 4; d++) {
      const nx = cx + dx[d];
      const ny = cy + dy[d];

      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

      const ni = ny * w + nx;
      if (visited[ni] === 1 || mask[ni] !== 0) continue;

      visited[ni] = 1;
      queueX[qTail] = nx;
      queueY[qTail] = ny;
      qTail++;
    }
  }

  return pixels;
}

/**
 * Detect all distinct regions in a binary mask by scanning for unvisited
 * empty pixels and flood-filling each one.
 *
 * @param {Uint8Array} mask      - Binary mask (1=edge, 0=empty)
 * @param {number} w             - Width
 * @param {number} h             - Height
 * @param {number} [minSize=20]  - Minimum pixel count for a region to be kept
 * @returns {Array<{id: number, pixels: Array<[number, number]>, centroid: {x: number, y: number}, size: number}>}
 */
export function detectAllRegions(mask, w, h, minSize = 20) {
  const visited = new Uint8Array(w * h);
  const regions = [];
  let nextId = 0;

  // 4-connected neighbor offsets
  const dx = [1, -1, 0, 0];
  const dy = [0, 0, 1, -1];

  // Pre-allocate queue buffers once
  const queueX = new Int32Array(w * h);
  const queueY = new Int32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx] === 1 || mask[idx] !== 0) continue;

      // BFS flood-fill inlined for performance
      let qHead = 0;
      let qTail = 0;
      queueX[qTail] = x;
      queueY[qTail] = y;
      qTail++;
      visited[idx] = 1;

      const pixels = [];
      let sumX = 0;
      let sumY = 0;

      while (qHead < qTail) {
        const cx = queueX[qHead];
        const cy = queueY[qHead];
        qHead++;

        pixels.push([cx, cy]);
        sumX += cx;
        sumY += cy;

        for (let d = 0; d < 4; d++) {
          const nx = cx + dx[d];
          const ny = cy + dy[d];
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

          const ni = ny * w + nx;
          if (visited[ni] === 1 || mask[ni] !== 0) continue;

          visited[ni] = 1;
          queueX[qTail] = nx;
          queueY[qTail] = ny;
          qTail++;
        }
      }

      if (pixels.length >= minSize) {
        regions.push({
          id: nextId++,
          pixels,
          centroid: {
            x: Math.round(sumX / pixels.length),
            y: Math.round(sumY / pixels.length),
          },
          size: pixels.length,
        });
      }
    }
  }

  return regions;
}

// ---------------------------------------------------------------------------
// 3. Color extraction
// ---------------------------------------------------------------------------

/**
 * Compute the average RGB color across all pixels in a region from RGBA
 * image data.
 *
 * @param {Uint8ClampedArray} imageData - RGBA pixel data
 * @param {number} w                    - Image width
 * @param {{pixels: Array<[number, number]>}} region - Region from detectAllRegions
 * @returns {{r: number, g: number, b: number}}
 */
export function sampleRegionColor(imageData, w, region) {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  const count = region.pixels.length;

  for (let i = 0; i < count; i++) {
    const px = region.pixels[i][0];
    const py = region.pixels[i][1];
    const offset = (py * w + px) * 4;
    rSum += imageData[offset];
    gSum += imageData[offset + 1];
    bSum += imageData[offset + 2];
  }

  return {
    r: Math.round(rSum / count),
    g: Math.round(gSum / count),
    b: Math.round(bSum / count),
  };
}

/**
 * Adjust a color's lightness proportionally to the region's average luminance,
 * preserving depth cues. Slightly boosts saturation for mid-tones.
 *
 * @param {{r: number, g: number, b: number}} color - Input RGB color
 * @param {number} avgLuminance - Average luminance of the region (0-255)
 * @returns {{r: number, g: number, b: number}}
 */
export function modulateByLuminance(color, avgLuminance) {
  const hsl = rgbToHsl(color.r, color.g, color.b);

  // Scale lightness proportionally to luminance (0-255 mapped to 0-100)
  const luminanceFactor = avgLuminance / 255;
  hsl.l = hsl.l * (0.4 + 0.6 * luminanceFactor);

  // Boost saturation for mid-tones (luminance roughly 64-192)
  const midToneness = 1 - Math.abs(avgLuminance - 128) / 128; // 0 at edges, 1 at center
  hsl.s = Math.min(100, hsl.s * (1 + 0.2 * midToneness));

  return hslToRgb(hsl.h, hsl.s, hsl.l);
}

// ---------------------------------------------------------------------------
// 4. Palette
// ---------------------------------------------------------------------------

/**
 * Extract dominant colors from image data using simplified k-means.
 * Samples every 4th pixel for speed. Runs 5 iterations.
 *
 * @param {Uint8ClampedArray} imageData - RGBA pixel data
 * @param {number} w                    - Image width
 * @param {number} h                    - Image height
 * @param {number} [numColors=8]        - Number of palette colors to extract
 * @returns {Array<{r: number, g: number, b: number}>} Colors sorted by frequency (most common first)
 */
export function extractPalette(imageData, w, h, numColors = 8) {
  const totalPixels = w * h;

  // Sample every 4th pixel into a compact array
  const sampleCount = Math.ceil(totalPixels / 4);
  const samplesR = new Float32Array(sampleCount);
  const samplesG = new Float32Array(sampleCount);
  const samplesB = new Float32Array(sampleCount);

  let si = 0;
  for (let i = 0; i < totalPixels; i += 4) {
    const offset = i * 4;
    samplesR[si] = imageData[offset];
    samplesG[si] = imageData[offset + 1];
    samplesB[si] = imageData[offset + 2];
    si++;
  }
  const actualSamples = si;

  // Initialize centroids by evenly spacing through the sample set
  const centroids = [];
  for (let c = 0; c < numColors; c++) {
    const idx = Math.floor((c / numColors) * actualSamples);
    centroids.push({
      r: samplesR[idx],
      g: samplesG[idx],
      b: samplesB[idx],
    });
  }

  // Assignment array: which centroid each sample belongs to
  const assignments = new Int32Array(actualSamples);

  // Run 5 iterations of k-means
  for (let iter = 0; iter < 5; iter++) {
    // Assignment step: assign each sample to the nearest centroid
    for (let i = 0; i < actualSamples; i++) {
      let bestDist = Infinity;
      let bestC = 0;
      const sr = samplesR[i];
      const sg = samplesG[i];
      const sb = samplesB[i];

      for (let c = 0; c < numColors; c++) {
        const dr = sr - centroids[c].r;
        const dg = sg - centroids[c].g;
        const db = sb - centroids[c].b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestC = c;
        }
      }
      assignments[i] = bestC;
    }

    // Update step: recompute centroids
    const sumR = new Float32Array(numColors);
    const sumG = new Float32Array(numColors);
    const sumB = new Float32Array(numColors);
    const counts = new Int32Array(numColors);

    for (let i = 0; i < actualSamples; i++) {
      const c = assignments[i];
      sumR[c] += samplesR[i];
      sumG[c] += samplesG[i];
      sumB[c] += samplesB[i];
      counts[c]++;
    }

    for (let c = 0; c < numColors; c++) {
      if (counts[c] > 0) {
        centroids[c].r = sumR[c] / counts[c];
        centroids[c].g = sumG[c] / counts[c];
        centroids[c].b = sumB[c] / counts[c];
      }
    }
  }

  // Count final assignments for sorting by frequency
  const finalCounts = new Int32Array(numColors);
  for (let i = 0; i < actualSamples; i++) {
    finalCounts[assignments[i]]++;
  }

  // Build result sorted by frequency (descending)
  const indexed = centroids.map((c, i) => ({ ...c, count: finalCounts[i] }));
  indexed.sort((a, b) => b.count - a.count);

  return indexed.map(({ r, g, b }) => ({
    r: Math.round(r),
    g: Math.round(g),
    b: Math.round(b),
  }));
}

/**
 * Find the closest color in the palette by Euclidean distance in RGB space.
 *
 * @param {{r: number, g: number, b: number}} color   - The query color
 * @param {Array<{r: number, g: number, b: number}>} palette - Palette of colors
 * @returns {{r: number, g: number, b: number}}
 */
export function nearestPaletteColor(color, palette) {
  let bestDist = Infinity;
  let best = palette[0];

  for (let i = 0; i < palette.length; i++) {
    const dr = color.r - palette[i].r;
    const dg = color.g - palette[i].g;
    const db = color.b - palette[i].b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = palette[i];
    }
  }

  return { r: best.r, g: best.g, b: best.b };
}

// ---------------------------------------------------------------------------
// 5. Edge mask creation
// ---------------------------------------------------------------------------

/**
 * Bresenham's line rasterization. Sets mask pixels to 1 along the line,
 * plus 1-pixel-thick neighbors (resulting in ~3px wide lines) so that
 * regions are properly enclosed.
 *
 * @param {Uint8Array} mask - Binary mask to draw into
 * @param {number} w        - Mask width
 * @param {number} h        - Mask height
 * @param {number} x0       - Start X
 * @param {number} y0       - Start Y
 * @param {number} x1       - End X
 * @param {number} y1       - End Y
 */
export function bresenhamLine(mask, w, h, x0, y0, x1, y1) {
  let ix0 = Math.round(x0);
  let iy0 = Math.round(y0);
  const ix1 = Math.round(x1);
  const iy1 = Math.round(y1);

  const dx = Math.abs(ix1 - ix0);
  const dy = Math.abs(iy1 - iy0);
  const sx = ix0 < ix1 ? 1 : -1;
  const sy = iy0 < iy1 ? 1 : -1;
  let err = dx - dy;

  // Helper to set a pixel and its immediate neighbors (3px wide)
  const setPixel = (px, py) => {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = px + ox;
        const ny = py + oy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          mask[ny * w + nx] = 1;
        }
      }
    }
  };

  while (true) {
    setPixel(ix0, iy0);

    if (ix0 === ix1 && iy0 === iy1) break;

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      ix0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      iy0 += sy;
    }
  }
}

/**
 * Evaluate a cubic Bezier curve at parameter t.
 *
 * @param {number} p0 - Start point coordinate
 * @param {number} p1 - First control point coordinate
 * @param {number} p2 - Second control point coordinate
 * @param {number} p3 - End point coordinate
 * @param {number} t  - Parameter (0-1)
 * @returns {number}
 */
function cubicBezier(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

/**
 * Parse SVG path d attribute into an array of command objects.
 * Handles M, m, L, l, C, c, H, h, V, v, Z, z commands.
 *
 * @param {string} d - SVG path d attribute string
 * @returns {Array<{cmd: string, args: number[]}>}
 */
function parseSvgPathD(d) {
  const commands = [];
  // Match command letter followed by its numeric arguments
  const regex = /([MmLlCcHhVvZzSsQqTtAa])([\s,\-e.\d]*)/g;
  let match;

  while ((match = regex.exec(d)) !== null) {
    const cmd = match[1];
    const argStr = match[2].trim();
    let args = [];

    if (argStr.length > 0) {
      // Parse numbers, handling negative signs and scientific notation
      args = argStr.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
      args = args ? args.map(Number) : [];
    }

    commands.push({ cmd, args });
  }

  return commands;
}

/**
 * Create a binary edge mask from SVG path data WITHOUT using DOM/canvas.
 * Parses the SVG string to extract path d attributes, then rasterizes
 * line segments using Bresenham's algorithm.
 *
 * @param {string} svgString - SVG markup string
 * @param {number} w         - Output mask width
 * @param {number} h         - Output mask height
 * @returns {Uint8Array} Binary mask where 1=edge pixel, 0=empty
 */
export function createEdgeMask(svgString, w, h) {
  const mask = new Uint8Array(w * h);

  // Extract all path d attributes from the SVG string
  const pathRegex = /<path[^>]*\bd="([^"]+)"/g;
  let pathMatch;

  while ((pathMatch = pathRegex.exec(svgString)) !== null) {
    const dAttr = pathMatch[1];
    const commands = parseSvgPathD(dAttr);

    let curX = 0;
    let curY = 0;
    let startX = 0; // For Z command: return to start of subpath
    let startY = 0;

    for (const { cmd, args } of commands) {
      switch (cmd) {
        case 'M': {
          // Absolute moveto — may contain implicit lineto pairs after the first pair
          curX = args[0];
          curY = args[1];
          startX = curX;
          startY = curY;
          // Extra pairs are implicit L commands
          for (let i = 2; i + 1 < args.length; i += 2) {
            const nx = args[i];
            const ny = args[i + 1];
            bresenhamLine(mask, w, h, curX, curY, nx, ny);
            curX = nx;
            curY = ny;
          }
          break;
        }
        case 'm': {
          // Relative moveto
          curX += args[0];
          curY += args[1];
          startX = curX;
          startY = curY;
          for (let i = 2; i + 1 < args.length; i += 2) {
            const nx = curX + args[i];
            const ny = curY + args[i + 1];
            bresenhamLine(mask, w, h, curX, curY, nx, ny);
            curX = nx;
            curY = ny;
          }
          break;
        }
        case 'L': {
          // Absolute lineto (may have multiple pairs)
          for (let i = 0; i + 1 < args.length; i += 2) {
            const nx = args[i];
            const ny = args[i + 1];
            bresenhamLine(mask, w, h, curX, curY, nx, ny);
            curX = nx;
            curY = ny;
          }
          break;
        }
        case 'l': {
          // Relative lineto
          for (let i = 0; i + 1 < args.length; i += 2) {
            const nx = curX + args[i];
            const ny = curY + args[i + 1];
            bresenhamLine(mask, w, h, curX, curY, nx, ny);
            curX = nx;
            curY = ny;
          }
          break;
        }
        case 'H': {
          // Absolute horizontal lineto
          for (let i = 0; i < args.length; i++) {
            const nx = args[i];
            bresenhamLine(mask, w, h, curX, curY, nx, curY);
            curX = nx;
          }
          break;
        }
        case 'h': {
          // Relative horizontal lineto
          for (let i = 0; i < args.length; i++) {
            const nx = curX + args[i];
            bresenhamLine(mask, w, h, curX, curY, nx, curY);
            curX = nx;
          }
          break;
        }
        case 'V': {
          // Absolute vertical lineto
          for (let i = 0; i < args.length; i++) {
            const ny = args[i];
            bresenhamLine(mask, w, h, curX, curY, curX, ny);
            curY = ny;
          }
          break;
        }
        case 'v': {
          // Relative vertical lineto
          for (let i = 0; i < args.length; i++) {
            const ny = curY + args[i];
            bresenhamLine(mask, w, h, curX, curY, curX, ny);
            curY = ny;
          }
          break;
        }
        case 'C': {
          // Absolute cubic Bezier (6 args per curve)
          for (let i = 0; i + 5 < args.length; i += 6) {
            const cp1x = args[i];
            const cp1y = args[i + 1];
            const cp2x = args[i + 2];
            const cp2y = args[i + 3];
            const ex = args[i + 4];
            const ey = args[i + 5];

            // Approximate with 8 line segments (t=0, 0.125, 0.25, ... 1.0)
            let prevX = curX;
            let prevY = curY;
            for (let step = 1; step <= 8; step++) {
              const t = step / 8;
              const nx = cubicBezier(curX, cp1x, cp2x, ex, t);
              const ny = cubicBezier(curY, cp1y, cp2y, ey, t);
              bresenhamLine(mask, w, h, prevX, prevY, nx, ny);
              prevX = nx;
              prevY = ny;
            }

            curX = ex;
            curY = ey;
          }
          break;
        }
        case 'c': {
          // Relative cubic Bezier
          for (let i = 0; i + 5 < args.length; i += 6) {
            const cp1x = curX + args[i];
            const cp1y = curY + args[i + 1];
            const cp2x = curX + args[i + 2];
            const cp2y = curY + args[i + 3];
            const ex = curX + args[i + 4];
            const ey = curY + args[i + 5];

            let prevX = curX;
            let prevY = curY;
            for (let step = 1; step <= 8; step++) {
              const t = step / 8;
              const nx = cubicBezier(curX, cp1x, cp2x, ex, t);
              const ny = cubicBezier(curY, cp1y, cp2y, ey, t);
              bresenhamLine(mask, w, h, prevX, prevY, nx, ny);
              prevX = nx;
              prevY = ny;
            }

            curX = ex;
            curY = ey;
          }
          break;
        }
        case 'Z':
        case 'z': {
          // Close path: draw line back to start of subpath
          bresenhamLine(mask, w, h, curX, curY, startX, startY);
          curX = startX;
          curY = startY;
          break;
        }
        // S, s, Q, q, T, t, A, a are not handled in this simplified parser.
        // They would need additional logic for smooth curves and arcs.
        default:
          break;
      }
    }
  }

  return mask;
}

// ---------------------------------------------------------------------------
// 6. Region to SVG path
// ---------------------------------------------------------------------------

/**
 * Compute the cross product of vectors OA and OB where O is the origin point.
 * Used by Graham scan.
 */
function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Convert a region's pixel list to a simplified SVG path for the fill element.
 * Uses Graham scan to compute the convex hull, then generates an SVG path
 * from the hull points.
 *
 * @param {Array<[number, number]>} pixels - Pixel coordinate pairs
 * @param {number} w - Image width (unused but kept for API consistency)
 * @param {number} h - Image height (unused but kept for API consistency)
 * @returns {string} SVG path d attribute string
 */
export function regionBoundaryToSvgPath(pixels, w, h) {
  if (pixels.length === 0) return '';
  if (pixels.length === 1) {
    return `M${pixels[0][0]},${pixels[0][1]}L${pixels[0][0] + 1},${pixels[0][1]}Z`;
  }
  if (pixels.length === 2) {
    return `M${pixels[0][0]},${pixels[0][1]}L${pixels[1][0]},${pixels[1][1]}Z`;
  }

  // Graham scan for convex hull
  // 1. Find the bottom-most point (and left-most if tie)
  const points = pixels.slice();
  let lowestIdx = 0;
  for (let i = 1; i < points.length; i++) {
    if (
      points[i][1] > points[lowestIdx][1] ||
      (points[i][1] === points[lowestIdx][1] && points[i][0] < points[lowestIdx][0])
    ) {
      lowestIdx = i;
    }
  }

  // Swap lowest to front
  const temp = points[0];
  points[0] = points[lowestIdx];
  points[lowestIdx] = temp;

  const pivot = points[0];

  // 2. Sort by polar angle with respect to pivot
  points.sort((a, b) => {
    if (a === pivot) return -1;
    if (b === pivot) return 1;

    const c = cross(pivot, a, b);
    if (c === 0) {
      // Collinear: sort by distance
      const distA = (a[0] - pivot[0]) ** 2 + (a[1] - pivot[1]) ** 2;
      const distB = (b[0] - pivot[0]) ** 2 + (b[1] - pivot[1]) ** 2;
      return distA - distB;
    }
    // Positive cross = counter-clockwise = a comes first
    return -c;
  });

  // 3. Build the hull
  const hull = [points[0], points[1]];

  for (let i = 2; i < points.length; i++) {
    while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], points[i]) <= 0) {
      hull.pop();
    }
    hull.push(points[i]);
  }

  // 4. Generate SVG path from hull points
  if (hull.length === 0) return '';

  let d = `M${hull[0][0]},${hull[0][1]}`;
  for (let i = 1; i < hull.length; i++) {
    d += `L${hull[i][0]},${hull[i][1]}`;
  }
  d += 'Z';

  return d;
}

// ---------------------------------------------------------------------------
// 7. Auto-colorize orchestrator
// ---------------------------------------------------------------------------

/**
 * Convert an RGB color to a CSS hex string.
 */
export function rgbToHex(r, g, b) {
  const toHex = (v) => {
    const clamped = Math.max(0, Math.min(255, Math.round(v)));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Compute the average luminance (perceived brightness) of a region from
 * RGBA image data using the standard luminance formula.
 *
 * @param {Uint8ClampedArray} imageData
 * @param {number} w
 * @param {Array<[number, number]>} pixels
 * @returns {number} Average luminance (0-255)
 */
function regionLuminance(imageData, w, pixels) {
  let sum = 0;
  for (let i = 0; i < pixels.length; i++) {
    const offset = (pixels[i][1] * w + pixels[i][0]) * 4;
    const r = imageData[offset];
    const g = imageData[offset + 1];
    const b = imageData[offset + 2];
    // Standard luminance: 0.299R + 0.587G + 0.114B
    sum += 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return sum / pixels.length;
}

/**
 * Compute fill data (paths + colors) without modifying the SVG.
 * Returns an array of fills that can be applied incrementally.
 *
 * @param {string} svgString
 * @param {Uint8ClampedArray} imageData
 * @param {number} w
 * @param {number} h
 * @param {object} [options]
 * @returns {Array<{id: number, pathD: string, color: string, centroid: {x: number, y: number}}>}
 */
export function computeFills(svgString, imageData, w, h, options = {}) {
  const { minRegionSize = 20 } = options;
  const mask = createEdgeMask(svgString, w, h);
  const regions = detectAllRegions(mask, w, h, minRegionSize);
  const fills = [];

  for (const region of regions) {
    const color = sampleRegionColor(imageData, w, region);
    const avgLum = regionLuminance(imageData, w, region.pixels);
    const modulated = modulateByLuminance(color, avgLum);
    const pathD = regionBoundaryToSvgPath(region.pixels, w, h);
    if (!pathD) continue;

    fills.push({
      id: region.id,
      pathD,
      color: rgbToHex(modulated.r, modulated.g, modulated.b),
      centroid: region.centroid,
    });
  }

  return fills;
}

/**
 * Insert pre-computed fills into SVG as a fills group.
 *
 * @param {string} svgString
 * @param {Array<{pathD: string, color: string}>} fills
 * @param {number} [fillOpacity=0.85]
 * @returns {string}
 */
export function insertFills(svgString, fills, fillOpacity = 0.85) {
  const pathEls = fills
    .map((f, i) => `    <path d="${f.pathD}" fill="${f.color}" class="fill-region" data-fill-index="${i}" />`)
    .join('\n');
  const fillsGroup = `  <g class="fills" opacity="${fillOpacity}">\n${pathEls}\n  </g>`;

  const firstGMatch = svgString.match(/<g[\s>]/);
  if (firstGMatch) {
    const insertPos = svgString.indexOf(firstGMatch[0]);
    return svgString.slice(0, insertPos) + fillsGroup + '\n' + svgString.slice(insertPos);
  }
  const closingIdx = svgString.lastIndexOf('</svg>');
  if (closingIdx !== -1) {
    return svgString.slice(0, closingIdx) + fillsGroup + '\n' + svgString.slice(closingIdx);
  }
  return svgString + '\n' + fillsGroup;
}

/**
 * Full auto-colorization pipeline.
 *
 * 1. Creates an edge mask from SVG paths
 * 2. Detects all regions in the mask
 * 3. For each region, samples the original photo's color
 * 4. Modulates color by luminance to preserve depth
 * 5. Generates fill <path> elements for each region
 * 6. Inserts a <g class="fills"> group into the SVG before the edges
 * 7. Returns the modified SVG and fill data
 *
 * @param {string} svgString               - Input SVG string (line drawing)
 * @param {Uint8ClampedArray} imageData     - RGBA pixel data of the original photo
 * @param {number} w                        - Width
 * @param {number} h                        - Height
 * @param {object} [options]
 * @param {number} [options.numLevels=8]       - Number of palette levels (unused directly, reserved)
 * @param {number} [options.minRegionSize=20]  - Minimum region size in pixels
 * @param {number} [options.fillOpacity=0.85]  - Fill layer opacity
 * @returns {{svg: string, fills: Array<{id: number, color: string, centroid: {x: number, y: number}}>}}
 */
export function autoColorize(svgString, imageData, w, h, options = {}) {
  const {
    minRegionSize = 20,
    fillOpacity = 0.85,
  } = options;

  // Step 1: Create binary edge mask from SVG paths
  const mask = createEdgeMask(svgString, w, h);

  // Step 2: Detect all regions
  const regions = detectAllRegions(mask, w, h, minRegionSize);

  // Step 3-5: For each region, sample color, modulate, and generate fill path
  const fillPaths = [];
  const fillData = [];

  for (const region of regions) {
    // Sample the average color from the original photo
    const color = sampleRegionColor(imageData, w, region);

    // Compute luminance for depth modulation
    const avgLum = regionLuminance(imageData, w, region.pixels);

    // Modulate color by luminance
    const modulated = modulateByLuminance(color, avgLum);

    // Generate SVG path from region boundary
    const pathD = regionBoundaryToSvgPath(region.pixels, w, h);
    if (!pathD) continue;

    const hex = rgbToHex(modulated.r, modulated.g, modulated.b);

    fillPaths.push(`    <path d="${pathD}" fill="${hex}" />`);
    fillData.push({
      id: region.id,
      color: hex,
      centroid: region.centroid,
    });
  }

  // Step 6: Insert fills group into SVG before the first <g> or before </svg>
  const fillsGroup =
    `  <g class="fills" opacity="${fillOpacity}">\n` +
    fillPaths.join('\n') +
    '\n  </g>';

  let modifiedSvg;

  // Try to insert before an existing group (typically the edges group)
  const firstGMatch = svgString.match(/<g[\s>]/);
  if (firstGMatch) {
    const insertPos = svgString.indexOf(firstGMatch[0]);
    modifiedSvg =
      svgString.slice(0, insertPos) +
      fillsGroup +
      '\n' +
      svgString.slice(insertPos);
  } else {
    // Fallback: insert before </svg>
    const closingIdx = svgString.lastIndexOf('</svg>');
    if (closingIdx !== -1) {
      modifiedSvg =
        svgString.slice(0, closingIdx) +
        fillsGroup +
        '\n' +
        svgString.slice(closingIdx);
    } else {
      modifiedSvg = svgString + '\n' + fillsGroup;
    }
  }

  return {
    svg: modifiedSvg,
    fills: fillData,
  };
}

// ---------------------------------------------------------------------------
// 8. Manual colorize helper
// ---------------------------------------------------------------------------

/**
 * Add a single fill path to the SVG's fills group. If no fills group
 * exists, create one before the first <g> or before </svg>.
 *
 * @param {string} svgString   - Current SVG markup
 * @param {string} regionPath  - SVG path d attribute for the fill region
 * @param {string} color       - CSS color string (e.g., "#ff0000")
 * @returns {string} Modified SVG string
 */
export function colorizeRegion(svgString, regionPath, color) {
  const fillElement = `    <path d="${regionPath}" fill="${color}" />`;

  // Check if a fills group already exists
  const fillsGroupRegex = /<g\s+class="fills"[^>]*>([\s\S]*?)<\/g>/;
  const match = svgString.match(fillsGroupRegex);

  if (match) {
    // Append the new fill path inside the existing group, before </g>
    const closingTag = '</g>';
    const groupEndIdx = svgString.indexOf(closingTag, svgString.indexOf(match[0]));
    return (
      svgString.slice(0, groupEndIdx) +
      '\n' +
      fillElement +
      '\n  ' +
      svgString.slice(groupEndIdx)
    );
  }

  // No fills group: create one
  const fillsGroup =
    `  <g class="fills" opacity="0.85">\n` +
    fillElement +
    '\n  </g>';

  // Insert before the first <g> (edges group) or before </svg>
  const firstGMatch = svgString.match(/<g[\s>]/);
  if (firstGMatch) {
    const insertPos = svgString.indexOf(firstGMatch[0]);
    return (
      svgString.slice(0, insertPos) +
      fillsGroup +
      '\n' +
      svgString.slice(insertPos)
    );
  }

  // Fallback: insert before </svg>
  const closingIdx = svgString.lastIndexOf('</svg>');
  if (closingIdx !== -1) {
    return (
      svgString.slice(0, closingIdx) +
      fillsGroup +
      '\n' +
      svgString.slice(closingIdx)
    );
  }

  return svgString + '\n' + fillsGroup;
}

/**
 * Remove the entire fills group from the SVG.
 *
 * @param {string} svgString - SVG markup containing a fills group
 * @returns {string} Cleaned SVG string without the fills group
 */
export function removeColorization(svgString) {
  // Match the entire <g class="fills"...>...</g> block, including surrounding whitespace
  const fillsGroupRegex = /\s*<g\s+class="fills"[^>]*>[\s\S]*?<\/g>\s*/;
  return svgString.replace(fillsGroupRegex, '\n');
}
