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
