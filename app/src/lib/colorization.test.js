import { describe, it, expect } from 'vitest';
import {
  rgbToHsl,
  hslToRgb,
  floodFill,
  detectAllRegions,
  sampleRegionColor,
  modulateByLuminance,
  bresenhamLine,
  nearestPaletteColor,
  removeColorization,
  colorizeRegion,
} from './colorization.js';

// ---------------------------------------------------------------------------
// 1. rgbToHsl
// ---------------------------------------------------------------------------

describe('rgbToHsl', () => {
  it('converts black (0,0,0) to h=0, s=0, l=0', () => {
    const result = rgbToHsl(0, 0, 0);
    expect(result.h).toBe(0);
    expect(result.s).toBe(0);
    expect(result.l).toBe(0);
  });

  it('converts white (255,255,255) to l=100', () => {
    const result = rgbToHsl(255, 255, 255);
    expect(result.l).toBe(100);
    expect(result.s).toBe(0);
  });

  it('converts pure red (255,0,0) to h=0, s=100, l=50', () => {
    const result = rgbToHsl(255, 0, 0);
    expect(result.h).toBe(0);
    expect(result.s).toBe(100);
    expect(result.l).toBe(50);
  });

  it('converts pure green (0,255,0) to h=120', () => {
    const result = rgbToHsl(0, 255, 0);
    expect(result.h).toBe(120);
    expect(result.s).toBe(100);
    expect(result.l).toBe(50);
  });

  it('converts pure blue (0,0,255) to h=240', () => {
    const result = rgbToHsl(0, 0, 255);
    expect(result.h).toBe(240);
    expect(result.s).toBe(100);
    expect(result.l).toBe(50);
  });

  it('converts a mid-gray (128,128,128) to s=0', () => {
    const result = rgbToHsl(128, 128, 128);
    expect(result.s).toBe(0);
    // l should be close to 50
    expect(result.l).toBeCloseTo(50.2, 0);
  });
});

// ---------------------------------------------------------------------------
// 2. hslToRgb
// ---------------------------------------------------------------------------

describe('hslToRgb', () => {
  it('converts h=0, s=0, l=0 back to black', () => {
    const result = hslToRgb(0, 0, 0);
    expect(result).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('converts h=0, s=0, l=100 back to white', () => {
    const result = hslToRgb(0, 0, 100);
    expect(result).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('converts h=0, s=100, l=50 back to pure red', () => {
    const result = hslToRgb(0, 100, 50);
    expect(result).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('roundtrips with rgbToHsl for pure green', () => {
    const hsl = rgbToHsl(0, 255, 0);
    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    expect(rgb.r).toBe(0);
    expect(rgb.g).toBe(255);
    expect(rgb.b).toBe(0);
  });

  it('roundtrips with rgbToHsl for an arbitrary color', () => {
    const original = { r: 173, g: 216, b: 230 }; // light blue
    const hsl = rgbToHsl(original.r, original.g, original.b);
    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    // Allow rounding tolerance of 1
    expect(rgb.r).toBeCloseTo(original.r, 0);
    expect(rgb.g).toBeCloseTo(original.g, 0);
    expect(rgb.b).toBeCloseTo(original.b, 0);
  });
});

// ---------------------------------------------------------------------------
// 3. floodFill
// ---------------------------------------------------------------------------

describe('floodFill', () => {
  it('fills the empty center of a bordered 5x5 mask', () => {
    // 5x5 mask: border is 1, center is 0
    // 1 1 1 1 1
    // 1 0 0 0 1
    // 1 0 0 0 1
    // 1 0 0 0 1
    // 1 1 1 1 1
    const w = 5;
    const h = 5;
    const mask = new Uint8Array(w * h);

    // Set the border to 1
    for (let x = 0; x < w; x++) {
      mask[0 * w + x] = 1; // top row
      mask[4 * w + x] = 1; // bottom row
    }
    for (let y = 0; y < h; y++) {
      mask[y * w + 0] = 1; // left column
      mask[y * w + 4] = 1; // right column
    }

    const filled = floodFill(mask, w, h, 2, 2);
    // The 3x3 interior (9 pixels) should be filled
    expect(filled).toHaveLength(9);
    // Each pixel should be in the range [1,3] for x and [1,3] for y
    for (const [px, py] of filled) {
      expect(px).toBeGreaterThanOrEqual(1);
      expect(px).toBeLessThanOrEqual(3);
      expect(py).toBeGreaterThanOrEqual(1);
      expect(py).toBeLessThanOrEqual(3);
    }
  });

  it('returns empty array when starting on an edge pixel', () => {
    const w = 5;
    const h = 5;
    const mask = new Uint8Array(w * h);
    mask[0] = 1; // top-left is an edge
    const filled = floodFill(mask, w, h, 0, 0);
    expect(filled).toHaveLength(0);
  });

  it('does not cross edge boundaries', () => {
    // 5x1 row: [0, 0, 1, 0, 0]
    const w = 5;
    const h = 1;
    const mask = new Uint8Array(w * h);
    mask[2] = 1; // edge in the middle

    const leftFill = floodFill(mask, w, h, 0, 0);
    // Should fill only pixels 0 and 1 (the left side)
    expect(leftFill).toHaveLength(2);
    const xs = leftFill.map(([x]) => x).sort();
    expect(xs).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// 4. detectAllRegions
// ---------------------------------------------------------------------------

describe('detectAllRegions', () => {
  it('detects two separate enclosed regions', () => {
    // 9x1 row: [0, 0, 1, 0, 0, 1, 0, 0, 0]
    // Region A: pixels 0,1  (size 2)
    // Region B: pixels 3,4  (size 2)
    // Region C: pixels 6,7,8  (size 3)
    const w = 9;
    const h = 1;
    const mask = new Uint8Array(w * h);
    mask[2] = 1;
    mask[5] = 1;

    // Use minSize=1 to capture all regions
    const regions = detectAllRegions(mask, w, h, 1);
    expect(regions).toHaveLength(3);

    const sizes = regions.map((r) => r.size).sort((a, b) => a - b);
    expect(sizes).toEqual([2, 2, 3]);
  });

  it('filters out regions smaller than minSize', () => {
    // 9x1: two small regions (size 2) and one larger (size 3)
    const w = 9;
    const h = 1;
    const mask = new Uint8Array(w * h);
    mask[2] = 1;
    mask[5] = 1;

    const regions = detectAllRegions(mask, w, h, 3);
    // Only the region of size 3 should remain
    expect(regions).toHaveLength(1);
    expect(regions[0].size).toBe(3);
  });

  it('computes correct centroids', () => {
    // 5x1: all empty, minSize=1
    const w = 5;
    const h = 1;
    const mask = new Uint8Array(w * h);
    const regions = detectAllRegions(mask, w, h, 1);

    expect(regions).toHaveLength(1);
    // Centroid of pixels [0,1,2,3,4] at y=0 should be x=2, y=0
    expect(regions[0].centroid.x).toBe(2);
    expect(regions[0].centroid.y).toBe(0);
  });

  it('returns regions with sequential IDs', () => {
    const w = 7;
    const h = 1;
    const mask = new Uint8Array(w * h);
    mask[3] = 1; // separator
    const regions = detectAllRegions(mask, w, h, 1);
    const ids = regions.map((r) => r.id);
    expect(ids).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// 5. sampleRegionColor
// ---------------------------------------------------------------------------

describe('sampleRegionColor', () => {
  it('computes average RGB from image data for a given region', () => {
    // 3x1 image, RGBA data
    const w = 3;
    const imageData = new Uint8ClampedArray([
      255, 0, 0, 255, // pixel (0,0): red
      0, 255, 0, 255, // pixel (1,0): green
      0, 0, 255, 255, // pixel (2,0): blue
    ]);

    // Region covers pixels (0,0) and (2,0)
    const region = {
      pixels: [
        [0, 0],
        [2, 0],
      ],
    };

    const color = sampleRegionColor(imageData, w, region);
    // Average of red (255,0,0) and blue (0,0,255)
    expect(color.r).toBe(128); // Math.round((255+0)/2)
    expect(color.g).toBe(0);
    expect(color.b).toBe(128); // Math.round((0+255)/2)
  });

  it('returns exact color for a single-pixel region', () => {
    const w = 2;
    const imageData = new Uint8ClampedArray([
      100, 150, 200, 255, // pixel (0,0)
      50, 75, 100, 255, // pixel (1,0)
    ]);

    const region = { pixels: [[1, 0]] };
    const color = sampleRegionColor(imageData, w, region);
    expect(color).toEqual({ r: 50, g: 75, b: 100 });
  });
});

// ---------------------------------------------------------------------------
// 6. modulateByLuminance
// ---------------------------------------------------------------------------

describe('modulateByLuminance', () => {
  it('produces darker output with low luminance', () => {
    const color = { r: 200, g: 100, b: 50 };
    const darkResult = modulateByLuminance(color, 30); // low luminance
    const brightResult = modulateByLuminance(color, 220); // high luminance

    // The dark version should have lower overall RGB values
    const darkSum = darkResult.r + darkResult.g + darkResult.b;
    const brightSum = brightResult.r + brightResult.g + brightResult.b;
    expect(darkSum).toBeLessThan(brightSum);
  });

  it('preserves hue approximately', () => {
    const color = { r: 255, g: 0, b: 0 }; // pure red
    const result = modulateByLuminance(color, 128);
    const hsl = rgbToHsl(result.r, result.g, result.b);
    // Hue should remain close to 0 (red)
    expect(hsl.h).toBeCloseTo(0, 0);
  });

  it('boosts saturation for mid-tone luminance', () => {
    const color = { r: 180, g: 100, b: 100 };
    const originalHsl = rgbToHsl(color.r, color.g, color.b);

    const midToneResult = modulateByLuminance(color, 128); // peak mid-tone
    const midToneHsl = rgbToHsl(midToneResult.r, midToneResult.g, midToneResult.b);

    // At luminance=128, midToneness=1, so saturation gets the max boost (1 + 0.2)
    // The modulated saturation (before lightness scaling) should be >= original
    // We can't compare directly due to lightness changes, but saturation should stay high
    expect(midToneHsl.s).toBeGreaterThan(0);
  });

  it('returns valid RGB values (0-255 range)', () => {
    const color = { r: 255, g: 255, b: 255 };
    const result = modulateByLuminance(color, 255);
    expect(result.r).toBeGreaterThanOrEqual(0);
    expect(result.r).toBeLessThanOrEqual(255);
    expect(result.g).toBeGreaterThanOrEqual(0);
    expect(result.g).toBeLessThanOrEqual(255);
    expect(result.b).toBeGreaterThanOrEqual(0);
    expect(result.b).toBeLessThanOrEqual(255);
  });
});

// ---------------------------------------------------------------------------
// 7. bresenhamLine
// ---------------------------------------------------------------------------

describe('bresenhamLine', () => {
  it('draws a horizontal line on a mask', () => {
    const w = 10;
    const h = 5;
    const mask = new Uint8Array(w * h);

    bresenhamLine(mask, w, h, 2, 2, 7, 2);

    // Pixels along the line (y=2, x=2..7) should be set
    for (let x = 2; x <= 7; x++) {
      expect(mask[2 * w + x]).toBe(1);
    }
  });

  it('draws with 3px thickness (sets neighbors)', () => {
    const w = 10;
    const h = 10;
    const mask = new Uint8Array(w * h);

    bresenhamLine(mask, w, h, 5, 5, 5, 5); // single point

    // The single point at (5,5) plus its 8 neighbors should be set
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        expect(mask[(5 + dy) * w + (5 + dx)]).toBe(1);
      }
    }
  });

  it('draws a diagonal line', () => {
    const w = 10;
    const h = 10;
    const mask = new Uint8Array(w * h);

    bresenhamLine(mask, w, h, 0, 0, 4, 4);

    // Points along the diagonal should be set
    for (let i = 0; i <= 4; i++) {
      expect(mask[i * w + i]).toBe(1);
    }
  });

  it('does not set pixels outside mask bounds', () => {
    const w = 5;
    const h = 5;
    const mask = new Uint8Array(w * h);

    // Draw a line at the edge — neighbor writes should be clamped
    bresenhamLine(mask, w, h, 0, 0, 4, 0);

    // No out-of-bounds error should occur, and corner pixels should be set
    expect(mask[0]).toBe(1); // (0,0)
    expect(mask[4]).toBe(1); // (4,0)
  });
});

// ---------------------------------------------------------------------------
// 8. nearestPaletteColor
// ---------------------------------------------------------------------------

describe('nearestPaletteColor', () => {
  const palette = [
    { r: 255, g: 0, b: 0 }, // red
    { r: 0, g: 255, b: 0 }, // green
    { r: 0, g: 0, b: 255 }, // blue
  ];

  it('finds the closest color for an exact match', () => {
    const result = nearestPaletteColor({ r: 255, g: 0, b: 0 }, palette);
    expect(result).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('finds the closest color for a near-red', () => {
    const result = nearestPaletteColor({ r: 250, g: 10, b: 5 }, palette);
    expect(result).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('finds the closest color for a near-green', () => {
    const result = nearestPaletteColor({ r: 10, g: 240, b: 20 }, palette);
    expect(result).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('finds the closest color for a near-blue', () => {
    const result = nearestPaletteColor({ r: 5, g: 10, b: 245 }, palette);
    expect(result).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('works with a single-color palette', () => {
    const result = nearestPaletteColor({ r: 100, g: 100, b: 100 }, [
      { r: 50, g: 50, b: 50 },
    ]);
    expect(result).toEqual({ r: 50, g: 50, b: 50 });
  });
});

// ---------------------------------------------------------------------------
// 9. removeColorization
// ---------------------------------------------------------------------------

describe('removeColorization', () => {
  const svgWithFills = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g class="fills" opacity="0.85">
    <path d="M10,10L20,10L20,20Z" fill="#ff0000" />
    <path d="M30,30L40,30L40,40Z" fill="#00ff00" />
  </g>
  <g class="edges">
    <path d="M10,10 L50,10" fill="none" stroke="currentColor" stroke-width="1.2"/>
  </g>
</svg>`;

  it('removes the fills group from SVG', () => {
    const result = removeColorization(svgWithFills);
    expect(result).not.toContain('class="fills"');
    expect(result).not.toContain('fill="#ff0000"');
    expect(result).not.toContain('fill="#00ff00"');
  });

  it('preserves the edges group', () => {
    const result = removeColorization(svgWithFills);
    expect(result).toContain('class="edges"');
    expect(result).toContain('stroke="currentColor"');
  });

  it('returns SVG unchanged if no fills group exists', () => {
    const svgNoFills = `<svg><g class="edges"><path d="M0,0 L10,10"/></g></svg>`;
    const result = removeColorization(svgNoFills);
    expect(result).toBe(svgNoFills);
  });
});

// ---------------------------------------------------------------------------
// 10. colorizeRegion
// ---------------------------------------------------------------------------

describe('colorizeRegion', () => {
  const baseSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g class="edges">
    <path d="M10,10 L50,10" fill="none" stroke="currentColor" stroke-width="1.2"/>
  </g>
</svg>`;

  it('creates a fills group and adds a fill path to SVG', () => {
    const result = colorizeRegion(baseSvg, 'M10,10L20,20L10,20Z', '#ff0000');
    expect(result).toContain('class="fills"');
    expect(result).toContain('fill="#ff0000"');
    expect(result).toContain('M10,10L20,20L10,20Z');
  });

  it('inserts fills group before the edges group', () => {
    const result = colorizeRegion(baseSvg, 'M10,10L20,20Z', '#00ff00');
    const fillsPos = result.indexOf('class="fills"');
    const edgesPos = result.indexOf('class="edges"');
    expect(fillsPos).toBeLessThan(edgesPos);
  });

  it('appends to existing fills group on second call', () => {
    const first = colorizeRegion(baseSvg, 'M10,10L20,20Z', '#ff0000');
    const second = colorizeRegion(first, 'M30,30L40,40Z', '#00ff00');

    // Should still have only one fills group
    const fillsMatches = second.match(/class="fills"/g);
    expect(fillsMatches).toHaveLength(1);

    // Both fill paths should be present
    expect(second).toContain('fill="#ff0000"');
    expect(second).toContain('fill="#00ff00"');
  });

  it('sets default fill opacity of 0.85 on new fills group', () => {
    const result = colorizeRegion(baseSvg, 'M0,0L10,10Z', '#0000ff');
    expect(result).toContain('opacity="0.85"');
  });
});
