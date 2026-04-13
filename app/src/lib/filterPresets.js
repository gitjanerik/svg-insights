/**
 * filterPresets.js
 *
 * Global style presets and SVG filter definitions for the SVG line-drawing app.
 * Each preset is a configuration object that controls stroke appearance,
 * layer opacities, background colour, and optional SVG filter effects.
 */

// ---------------------------------------------------------------------------
// 1. Filter presets
// ---------------------------------------------------------------------------

/**
 * Each preset contains:
 *   strokeScale   - multiplier applied to base stroke-width
 *   opacity       - per-layer visibility (0-100)
 *     edges       - main edge lines
 *     contours    - surface contour lines
 *     hatching    - cross-hatch shading lines
 *   strokeColor   - CSS colour for all strokes
 *   bgColor       - background fill colour
 *   linecap       - stroke-linecap value  (default 'round')
 *   linejoin      - stroke-linejoin value (default 'round')
 *   svgFilter     - filter name to apply (null = none)
 *   wobble        - random jitter intensity (0 = none)
 *   dashPattern   - stroke-dasharray string ('' = solid)
 *   label         - Norwegian display name
 *   description   - short English description
 */
export const filterPresets = {
  'pen-ink': {
    strokeScale: 1.2,
    opacity: { edges: 100, contours: 100, hatching: 0 },
    strokeColor: '#000000',
    bgColor: '#ffffff',
    linecap: 'round',
    linejoin: 'round',
    svgFilter: null,
    wobble: 0,
    dashPattern: '',
    label: 'Penn og blekk',
    description: 'Clean black lines',
  },

  'pencil': {
    strokeScale: 0.8,
    opacity: { edges: 80, contours: 60, hatching: 40 },
    strokeColor: '#444444',
    bgColor: '#f5f5f0',
    linecap: 'round',
    linejoin: 'round',
    svgFilter: null,
    wobble: 0.5,
    dashPattern: '',
    label: 'Blyant',
    description: 'Pencil sketch',
  },

  'blueprint': {
    strokeScale: 1.0,
    opacity: { edges: 100, contours: 70, hatching: 30 },
    strokeColor: '#00d4ff',
    bgColor: '#0a3d6e',
    linecap: 'square',
    linejoin: 'round',
    svgFilter: 'glow',
    wobble: 0,
    dashPattern: '',
    label: 'Blakopi',
    description: 'Blueprint',
  },

  'neon': {
    strokeScale: 0.8,
    opacity: { edges: 100, contours: 50, hatching: 0 },
    strokeColor: '#ff00ff',
    bgColor: '#0a0a0f',
    linecap: 'round',
    linejoin: 'round',
    svgFilter: 'glow',
    wobble: 0,
    dashPattern: '',
    label: 'Neon',
    description: 'Neon glow',
  },

  'woodcut': {
    strokeScale: 2.0,
    opacity: { edges: 100, contours: 30, hatching: 100 },
    strokeColor: '#1a1a1a',
    bgColor: '#f5f0e8',
    linecap: 'butt',
    linejoin: 'miter',
    svgFilter: null,
    wobble: 0,
    dashPattern: '',
    label: 'Tresnitt',
    description: 'Woodcut print',
  },

  'watercolor': {
    strokeScale: 0.6,
    opacity: { edges: 60, contours: 40, hatching: 0 },
    strokeColor: '#6b5b4a',
    bgColor: '#faf8f3',
    linecap: 'round',
    linejoin: 'round',
    svgFilter: 'blur',
    wobble: 0,
    dashPattern: '',
    label: 'Akvarell',
    description: 'Watercolor',
  },

  'cartoon': {
    strokeScale: 2.0,
    opacity: { edges: 100, contours: 100, hatching: 100 },
    strokeColor: '#000000',
    bgColor: '#ffffff',
    linecap: 'round',
    linejoin: 'round',
    svgFilter: null,
    wobble: 0,
    dashPattern: '',
    autoColorize: true,
    label: 'Tegneserie',
    description: 'Bold ink + colors',
  },

  'auto-color': {
    strokeScale: 0.6,
    opacity: { edges: 45, contours: 25, hatching: 0 },
    strokeColor: '#1a1a1a',
    bgColor: '#ffffff',
    linecap: 'round',
    linejoin: 'round',
    svgFilter: null,
    wobble: 0,
    dashPattern: '',
    autoColorize: true,
    label: 'Foto-farger',
    description: 'Auto-colorize from photo',
  },
};

// ---------------------------------------------------------------------------
// 2. SVG filter definitions (<defs> markup)
// ---------------------------------------------------------------------------

/**
 * Ready-to-inject SVG <defs> block containing all reusable filter effects.
 * Every filter uses oversized x/y/width/height to avoid clipping on
 * elements that extend beyond their bounding box.
 */
export const svgFilterDefs = `<defs>
  <!-- Soft Gaussian blur -->
  <filter id="filter-blur" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" />
  </filter>

  <!-- Neon / blueprint glow: blurred copy merged with sharp original -->
  <filter id="filter-glow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
    <feMerge>
      <feMergeNode in="blur" />
      <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>

  <!-- Drop shadow -->
  <filter id="filter-shadow" x="-50%" y="-50%" width="200%" height="200%">
    <feDropShadow dx="2" dy="2" stdDeviation="2" flood-opacity="0.3" />
  </filter>

  <!-- Charcoal: fractal-noise displacement for rough edges -->
  <filter id="filter-charcoal" x="-50%" y="-50%" width="200%" height="200%">
    <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" result="noise" />
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" xChannelSelector="R" yChannelSelector="G" />
  </filter>

  <!-- Emboss: 3x3 convolution kernel for a raised-edge look -->
  <filter id="filter-emboss" x="-50%" y="-50%" width="200%" height="200%">
    <feConvolveMatrix order="3" kernelMatrix="-2 -1 0 -1 1 1 0 1 2" />
  </filter>
</defs>`;

// ---------------------------------------------------------------------------
// 3. Dash-pattern look-up table
// ---------------------------------------------------------------------------

/**
 * Maps human-readable pattern names to SVG stroke-dasharray values.
 * An empty string means a solid (continuous) stroke.
 */
export const dashPatterns = {
  solid: '',
  dashed: '6,4',
  dotted: '1.5,3',
  sketch: '2,2',
};
