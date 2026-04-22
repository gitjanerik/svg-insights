# Font Quality Tests

Automated headless tests that render every glyph (97 per font) using the same
canvas-based pipeline as the app, then analyze each result for geometric
problems like self-intersections, inter-contour crossings, and anchor
explosions.

## Run

```bash
cd app
npm install
npm run test:fonts
```

This produces:
- `app/tests/font-quality/report.html` — visual grid with red borders on problem glyphs
- `app/tests/font-quality/report.json` — machine-readable metrics

## Metrics

- **self-intersections** — polyline-flattened Bézier crosses itself (bubble/amoeba bug)
- **inter-contour crosses** — outer and inner contour cross (e.g. "C" that becomes figure-8)
- **anchor explosion** — more than 40 anchors for a single glyph
- **handle overshoot** — Bézier control points extend more than 2× beyond the chord

## Iterating on the algorithm

Both the app and the test share `app/src/lib/curveFit.js` and
`app/src/lib/canvasGlyphRenderer.js`. Edit those, rerun `npm run test:fonts`,
open the HTML report — no deploy needed to validate curve quality.
