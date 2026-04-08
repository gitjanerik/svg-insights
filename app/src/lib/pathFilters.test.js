import { describe, it, expect } from 'vitest';
import {
  straightenPaths,
  wobblePaths,
  adjustStrokeWidths,
  setDashPattern,
  setLinecap,
  setGroupOpacities,
  injectFilterDefs,
  applyGroupFilter,
} from './pathFilters.js';

const testSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g class="edges">
    <path d="M10.0,10.0 L50.0,10.0 C55.0,10.0 60.0,15.0 60.0,20.0" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </g>
  <g class="contours" opacity="0.5">
    <path d="M20.0,30.0 L80.0,30.0" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </g>
  <g class="hatching" opacity="0.35">
    <path d="M5.0,50.0 L95.0,50.0" fill="none" stroke="currentColor" stroke-width="0.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </g>
</svg>`;

// ---------------------------------------------------------------------------
// 1. straightenPaths
// ---------------------------------------------------------------------------

describe('straightenPaths', () => {
  it('replaces C commands with L to the endpoint', () => {
    const result = straightenPaths(testSvg);
    // The C command "C55.0,10.0 60.0,15.0 60.0,20.0" should become "L 60.0,20.0"
    expect(result).toContain('L 60.0,20.0');
    expect(result).not.toMatch(/C\s*55/);
  });

  it('preserves M and L commands unchanged', () => {
    const result = straightenPaths(testSvg);
    expect(result).toContain('M10.0,10.0');
    expect(result).toContain('L50.0,10.0');
    expect(result).toContain('M20.0,30.0');
    expect(result).toContain('L80.0,30.0');
  });

  it('preserves non-path SVG elements', () => {
    const result = straightenPaths(testSvg);
    expect(result).toContain('class="edges"');
    expect(result).toContain('class="contours"');
    expect(result).toContain('class="hatching"');
  });

  it('handles SVG with no C commands (no-op)', () => {
    const noCurves = `<svg><path d="M0,0 L10,10 L20,0"/></svg>`;
    const result = straightenPaths(noCurves);
    expect(result).toContain('M0,0 L10,10 L20,0');
  });
});

// ---------------------------------------------------------------------------
// 2. wobblePaths
// ---------------------------------------------------------------------------

describe('wobblePaths', () => {
  it('jitters numeric coordinates in path d attributes', () => {
    const result = wobblePaths(testSvg, 2.0);
    // Original coordinates should be modified
    expect(result).not.toContain('M10.0,10.0');
  });

  it('is deterministic (same input produces same output)', () => {
    const result1 = wobblePaths(testSvg, 1.0);
    const result2 = wobblePaths(testSvg, 1.0);
    expect(result1).toBe(result2);
  });

  it('applies zero jitter when intensity is 0', () => {
    const simple = `<svg><path d="M10.0,20.0 L30.0,40.0"/></svg>`;
    const result = wobblePaths(simple, 0);
    // With intensity 0, all jitter is multiplied by 0 so coordinates stay the same
    // (though they may be reformatted to .toFixed(2))
    expect(result).toContain('10.00');
    expect(result).toContain('20.00');
    expect(result).toContain('30.00');
    expect(result).toContain('40.00');
  });

  it('preserves SVG structure outside of d attributes', () => {
    const result = wobblePaths(testSvg, 1.0);
    expect(result).toContain('class="edges"');
    expect(result).toContain('stroke="currentColor"');
    expect(result).toContain('fill="none"');
  });
});

// ---------------------------------------------------------------------------
// 3. adjustStrokeWidths
// ---------------------------------------------------------------------------

describe('adjustStrokeWidths', () => {
  it('scales stroke-width by 2x', () => {
    const result = adjustStrokeWidths(testSvg, 2.0);
    // 1.2 * 2 = 2.40
    expect(result).toContain('stroke-width="2.40"');
    // 0.8 * 2 = 1.60
    expect(result).toContain('stroke-width="1.60"');
    // 0.5 * 2 = 1.00
    expect(result).toContain('stroke-width="1.00"');
  });

  it('scales stroke-width by 0.5x', () => {
    const result = adjustStrokeWidths(testSvg, 0.5);
    // 1.2 * 0.5 = 0.60
    expect(result).toContain('stroke-width="0.60"');
    // 0.8 * 0.5 = 0.40
    expect(result).toContain('stroke-width="0.40"');
    // 0.5 * 0.5 = 0.25
    expect(result).toContain('stroke-width="0.25"');
  });

  it('scales stroke-width by 1x (no change in value)', () => {
    const result = adjustStrokeWidths(testSvg, 1.0);
    expect(result).toContain('stroke-width="1.20"');
    expect(result).toContain('stroke-width="0.80"');
    expect(result).toContain('stroke-width="0.50"');
  });
});

// ---------------------------------------------------------------------------
// 4. setDashPattern
// ---------------------------------------------------------------------------

describe('setDashPattern', () => {
  it('adds stroke-dasharray to all path elements', () => {
    const result = setDashPattern(testSvg, '6,4');
    // All 3 paths should have the dasharray
    const matches = result.match(/stroke-dasharray="6,4"/g);
    expect(matches).toHaveLength(3);
  });

  it('removes stroke-dasharray with empty string', () => {
    // First add a dash pattern, then remove it
    const dashed = setDashPattern(testSvg, '6,4');
    expect(dashed).toContain('stroke-dasharray="6,4"');

    const undashed = setDashPattern(dashed, '');
    expect(undashed).not.toContain('stroke-dasharray');
  });

  it('removes stroke-dasharray with null', () => {
    const dashed = setDashPattern(testSvg, '6,4');
    const undashed = setDashPattern(dashed, null);
    expect(undashed).not.toContain('stroke-dasharray');
  });

  it('updates existing stroke-dasharray', () => {
    const dashed = setDashPattern(testSvg, '6,4');
    const updated = setDashPattern(dashed, '10,5,2,5');
    expect(updated).not.toContain('stroke-dasharray="6,4"');
    const matches = updated.match(/stroke-dasharray="10,5,2,5"/g);
    expect(matches).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 5. setLinecap
// ---------------------------------------------------------------------------

describe('setLinecap', () => {
  it('sets stroke-linecap to butt and stroke-linejoin to miter', () => {
    const result = setLinecap(testSvg, 'butt', 'miter');
    const capMatches = result.match(/stroke-linecap="butt"/g);
    expect(capMatches).toHaveLength(3);
    // The first two paths had stroke-linejoin="round", the third did not
    const joinMatches = result.match(/stroke-linejoin="miter"/g);
    expect(joinMatches).toHaveLength(3);
  });

  it('sets stroke-linecap to square and stroke-linejoin to bevel', () => {
    const result = setLinecap(testSvg, 'square', 'bevel');
    const capMatches = result.match(/stroke-linecap="square"/g);
    expect(capMatches).toHaveLength(3);
    const joinMatches = result.match(/stroke-linejoin="bevel"/g);
    expect(joinMatches).toHaveLength(3);
  });

  it('sets stroke-linecap to round and stroke-linejoin to round', () => {
    const result = setLinecap(testSvg, 'round', 'round');
    const capMatches = result.match(/stroke-linecap="round"/g);
    expect(capMatches).toHaveLength(3);
    const joinMatches = result.match(/stroke-linejoin="round"/g);
    expect(joinMatches).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 6. setGroupOpacities
// ---------------------------------------------------------------------------

describe('setGroupOpacities', () => {
  it('sets opacity on specific groups by class name', () => {
    const result = setGroupOpacities(testSvg, {
      edges: 80,
      contours: 60,
      hatching: 40,
    });
    expect(result).toContain('class="edges"');
    expect(result).toMatch(/class="edges"[^>]*opacity="0.80"/);
    // contours had opacity="0.5" which should be replaced
    expect(result).toMatch(/class="contours"[^>]*opacity="0.60"/);
    // hatching had opacity="0.35" which should be replaced
    expect(result).toMatch(/class="hatching"[^>]*opacity="0.40"/);
  });

  it('sets opacity to fully opaque (100)', () => {
    const result = setGroupOpacities(testSvg, { edges: 100 });
    expect(result).toMatch(/class="edges"[^>]*opacity="1.00"/);
  });

  it('sets opacity to fully transparent (0)', () => {
    const result = setGroupOpacities(testSvg, { hatching: 0 });
    expect(result).toMatch(/class="hatching"[^>]*opacity="0.00"/);
  });

  it('only modifies specified groups', () => {
    const result = setGroupOpacities(testSvg, { edges: 75 });
    // contours and hatching should remain unchanged
    expect(result).toContain('opacity="0.5"');
    expect(result).toContain('opacity="0.35"');
  });
});

// ---------------------------------------------------------------------------
// 7. injectFilterDefs
// ---------------------------------------------------------------------------

describe('injectFilterDefs', () => {
  it('injects defs into SVG without existing defs', () => {
    const defsMarkup = '<defs><filter id="blur"><feGaussianBlur stdDeviation="2"/></filter></defs>';
    const result = injectFilterDefs(testSvg, defsMarkup);
    expect(result).toContain(defsMarkup);
    // Should appear after the opening <svg> tag
    const svgTagEnd = result.indexOf('>');
    const defsPos = result.indexOf('<defs>');
    expect(defsPos).toBeGreaterThan(svgTagEnd);
  });

  it('replaces existing defs block', () => {
    const oldDefs = '<defs><filter id="old"><feGaussianBlur stdDeviation="1"/></filter></defs>';
    const newDefs = '<defs><filter id="new"><feGaussianBlur stdDeviation="5"/></filter></defs>';

    // First inject old defs
    const withOldDefs = injectFilterDefs(testSvg, oldDefs);
    expect(withOldDefs).toContain('id="old"');

    // Then replace with new defs
    const result = injectFilterDefs(withOldDefs, newDefs);
    expect(result).toContain('id="new"');
    expect(result).not.toContain('id="old"');

    // There should be exactly one <defs> block
    const defsCount = (result.match(/<defs>/g) || []).length;
    expect(defsCount).toBe(1);
  });

  it('places defs right after the opening <svg> tag', () => {
    const defsMarkup = '<defs><filter id="test"/></defs>';
    const result = injectFilterDefs(testSvg, defsMarkup);
    // The defs should come before the first <g
    const defsPos = result.indexOf('<defs>');
    const firstGPos = result.indexOf('<g');
    expect(defsPos).toBeLessThan(firstGPos);
  });
});

// ---------------------------------------------------------------------------
// 8. applyGroupFilter
// ---------------------------------------------------------------------------

describe('applyGroupFilter', () => {
  it('applies filter to the edges group', () => {
    const result = applyGroupFilter(testSvg, 'glow');
    expect(result).toMatch(/class="edges"[^>]*filter="url\(#filter-glow\)"/);
  });

  it('does not apply filter to contours or hatching groups', () => {
    const result = applyGroupFilter(testSvg, 'glow');
    // contours and hatching groups should not have a filter attribute
    expect(result).not.toMatch(/class="contours"[^>]*filter=/);
    expect(result).not.toMatch(/class="hatching"[^>]*filter=/);
  });

  it('removes filter from all groups when filterName is null', () => {
    // First apply a filter
    const filtered = applyGroupFilter(testSvg, 'glow');
    expect(filtered).toContain('filter="url(#filter-glow)"');

    // Then remove it
    const result = applyGroupFilter(filtered, null);
    expect(result).not.toContain('filter=');
  });

  it('removes filter from all groups when filterName is empty string', () => {
    const filtered = applyGroupFilter(testSvg, 'glow');
    const result = applyGroupFilter(filtered, '');
    expect(result).not.toContain('filter=');
  });

  it('updates existing filter on edges group', () => {
    const filtered = applyGroupFilter(testSvg, 'glow');
    const result = applyGroupFilter(filtered, 'blur');
    expect(result).toContain('filter="url(#filter-blur)"');
    expect(result).not.toContain('filter="url(#filter-glow)"');
  });
});
