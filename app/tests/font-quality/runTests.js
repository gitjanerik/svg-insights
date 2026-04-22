/**
 * runTests.js
 *
 * Generates every glyph in three fonts (serif, sans, handwriting),
 * analyzes each for quality problems, and produces an HTML report.
 *
 * Usage:
 *   cd app
 *   npm run test:fonts
 *
 * Opens ./report.html when finished.
 */

import { generateGlyph } from './glyphRenderer.js'
import { analyzeGlyph } from './qualityMetrics.js'
import { writeFileSync } from 'node:fs'
import { GlobalFonts } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'

const ALL_GLYPHS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ',
  ...'abcdefghijklmnopqrstuvwxyzæøå',
  ...'0123456789',
  ...'.,:;!?-()'
]

// System fonts that should exist on most Linux test environments
const CANDIDATE_FONTS = [
  // Prefer Google fonts if system has them installed
  { category: 'serif',       path: '/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf',     family: 'Lora' },
  { category: 'sans',        path: '/usr/share/fonts/truetype/google-fonts/Poppins-Regular.ttf',   family: 'Poppins' },
  // Fallbacks
  { category: 'serif-fb',    path: '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',             family: 'DejaVu Serif' },
  { category: 'sans-fb',     path: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',              family: 'DejaVu Sans' },
]

function registerAvailableFonts() {
  const registered = []
  const categoriesSeen = new Set()
  for (const f of CANDIDATE_FONTS) {
    const baseCategory = f.category.replace('-fb', '')
    if (categoriesSeen.has(baseCategory)) continue
    if (!existsSync(f.path)) continue
    try {
      GlobalFonts.registerFromPath(f.path, f.family)
      registered.push({ category: baseCategory, family: f.family })
      categoriesSeen.add(baseCategory)
      console.log(`  ✓ ${f.family} (${baseCategory})`)
    } catch (e) {
      console.log(`  ✗ ${f.family}: ${e.message}`)
    }
  }
  return registered
}

async function main() {
  console.log('Registering fonts…')
  const fonts = registerAvailableFonts()

  if (!fonts.length) {
    console.error('No test fonts found. Install Google Fonts: apt install fonts-lora fonts-poppins')
    process.exit(1)
  }

  console.log(`\nTesting ${fonts.length} fonts × ${ALL_GLYPHS.length} glyphs`)
  console.log('Reporting problems only (no output = clean):\n')

  const results = {}
  for (const { category, family } of fonts) {
    console.log(`== ${category} :: ${family} ==`)
    const fontResults = []
    for (const char of ALL_GLYPHS) {
      try {
        const r = generateGlyph(char, family)
        const analysis = analyzeGlyph(r)
        fontResults.push({ char, ...analysis, pathD: r?.pathD, contours: r?.contours })
        if (!analysis.ok) {
          console.log(`  ${char}: ${analysis.problems.join(', ')}`)
        }
      } catch (e) {
        fontResults.push({ char, ok: false, error: e.message })
        console.log(`  ${char}: ERROR ${e.message}`)
      }
    }
    results[family] = { category, results: fontResults }
  }

  writeFileSync(new URL('./report.html', import.meta.url), buildReport(results))
  writeFileSync(new URL('./report.json', import.meta.url), JSON.stringify(
    Object.fromEntries(Object.entries(results).map(([f, data]) => [f, {
      category: data.category,
      results: data.results.map(r => ({
        char: r.char,
        ok: r.ok,
        problems: r.problems,
        totalAnchors: r.totalAnchors,
        totalSelfIntersect: r.totalSelfIntersect,
        totalCross: r.totalCross,
        maxOvershoot: r.maxOvershoot,
        contourCount: r.contourCount,
      })),
    }])),
    null, 2))

  console.log('\n── SUMMARY ──')
  for (const [family, data] of Object.entries(results)) {
    const bad = data.results.filter(r => !r.ok)
    console.log(`${family}: ${bad.length}/${data.results.length} problematic`)
    const byProblem = {}
    for (const r of bad) {
      for (const p of (r.problems || [`error: ${r.error || 'unknown'}`])) {
        const key = p.replace(/\d+/g, 'N').replace(/[\d.]+x/, 'Nx')
        byProblem[key] = (byProblem[key] || 0) + 1
      }
    }
    for (const [p, c] of Object.entries(byProblem).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${c}× ${p}`)
    }
  }
  console.log(`\nReport:  app/tests/font-quality/report.html`)
  console.log(`JSON:    app/tests/font-quality/report.json`)
}

function buildReport(results) {
  const style = `
    body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #e5e5e5; margin: 0; padding: 20px; }
    h1 { color: #fff; }
    h2 { color: #a78bfa; border-bottom: 1px solid #333; padding-bottom: 8px; margin-top: 30px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
    .glyph { background: #12121a; border: 1px solid #222; border-radius: 6px; padding: 8px; position: relative; }
    .glyph.bad { border-color: #dc2626; background: #2a0e0e; }
    .glyph svg { width: 100%; height: 100px; background: #0a0a0f; border-radius: 4px; }
    .glyph .char { font-size: 24px; color: #fff; font-weight: 600; }
    .glyph .meta { font-size: 10px; color: #888; margin-top: 4px; line-height: 1.4; }
    .glyph .probs { font-size: 10px; color: #f87171; margin-top: 4px; }
    .summary { background: #12121a; padding: 12px; border-radius: 6px; margin: 10px 0; }
    .stat { display: inline-block; margin-right: 20px; font-size: 13px; }
    .stat strong { color: #fff; font-size: 16px; }
  `
  let html = `<!DOCTYPE html><html><head><title>Glyph Quality Report</title><style>${style}</style></head><body>`
  html += `<h1>Glyph Quality Report — v4.8.6 baseline</h1>`

  for (const [family, data] of Object.entries(results)) {
    const total = data.results.length
    const bad = data.results.filter(r => !r.ok).length
    html += `<h2>${family} <span style="color:#888;font-weight:normal">(${data.category})</span></h2>`
    html += `<div class="summary">
      <span class="stat">Total: <strong>${total}</strong></span>
      <span class="stat">Problematic: <strong style="color:${bad > 0 ? '#f87171' : '#4ade80'}">${bad}</strong></span>
    </div>`
    html += `<div class="grid">`
    for (const r of data.results) {
      const cls = r.ok ? '' : 'bad'
      const svgBody = r.pathD
        ? `<path d="${r.pathD}" fill="#a78bfa" fill-rule="evenodd"/>`
        : ''
      let minX = 0, minY = 0, maxX = 1000, maxY = 1000
      if (r.contours && r.contours.length) {
        minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity
        for (const c of r.contours) {
          for (const p of c.bezierPts) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
          }
        }
        const pad = 40
        minX -= pad; minY -= pad; maxX += pad; maxY += pad
      }
      html += `<div class="glyph ${cls}">
        <div class="char">${escapeHtml(r.char)}</div>
        <svg viewBox="${minX} ${-maxY} ${maxX - minX} ${maxY - minY}">
          <g transform="scale(1,-1)">${svgBody}</g>
        </svg>
        <div class="meta">anchors: ${r.totalAnchors || 0} · ctrs: ${r.contourCount || 0}</div>
        <div class="probs">${(r.problems || []).join('<br>')}</div>
      </div>`
    }
    html += `</div>`
  }
  html += `</body></html>`
  return html
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c]))
}

main().catch(e => { console.error(e); process.exit(1) })
