import { describe, it, expect } from 'vitest'
import { generateHumanWireframe, generateCharacterSheet } from './humanWireframe.js'

describe('generateHumanWireframe', () => {
  it('returns a valid SVG string', () => {
    const result = generateHumanWireframe()
    expect(result.svg).toContain('<svg')
    expect(result.svg).toContain('</svg>')
    expect(result.svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('generates a non-zero number of paths', () => {
    const result = generateHumanWireframe()
    expect(result.pathCount).toBeGreaterThan(50)
  })

  it('contains body wireframe group', () => {
    const result = generateHumanWireframe()
    expect(result.svg).toContain('class="wireframe-body"')
  })

  it('contains face wireframe group with paths when showFace is true', () => {
    const result = generateHumanWireframe({ showFace: true })
    expect(result.svg).toContain('class="wireframe-face"')
    // Face group should have path elements (eyes, nose, mouth, etc.)
    const faceSection = result.svg.split('wireframe-face')[1]
    expect(faceSection).toContain('<path d="M')
  })

  it('face group is empty when showFace is false', () => {
    const result = generateHumanWireframe({ showFace: false })
    const faceSection = result.svg.split('wireframe-face">')
    // After the face group opening, the next thing should be the closing tags (no paths)
    expect(faceSection[1]).toMatch(/^\s*\n\s*<\/g>/)
  })

  it('respects custom stroke color', () => {
    const result = generateHumanWireframe({ stroke: '#ff0000' })
    expect(result.svg).toContain('stroke="#ff0000"')
  })

  it('respects custom stroke width', () => {
    const result = generateHumanWireframe({ strokeWidth: 2.5 })
    expect(result.svg).toContain('stroke-width="2.5"')
  })

  it('produces different output for different rotations', () => {
    const front = generateHumanWireframe({ rotationY: 0 })
    const side = generateHumanWireframe({ rotationY: Math.PI / 2 })
    expect(front.svg).not.toEqual(side.svg)
  })

  it('uses viewBox centered at origin', () => {
    const result = generateHumanWireframe({ width: 400, height: 600 })
    expect(result.svg).toContain('viewBox="-200 -300 400 600"')
  })

  it('contains all body segments (torso, limbs, head)', () => {
    const result = generateHumanWireframe()
    // Should have many paths for: torso, hip, neck, head, 2 arms, 2 hands, 2 legs, 2 feet
    // Each segment generates rings + vertical lines
    expect(result.pathCount).toBeGreaterThan(100)
  })

  it('all path d attributes contain valid coordinates', () => {
    const result = generateHumanWireframe()
    const pathMatches = result.svg.match(/d="([^"]+)"/g)
    expect(pathMatches).not.toBeNull()
    for (const match of pathMatches) {
      // Every path should start with M and contain numbers
      expect(match).toMatch(/d="M-?\d/)
      // Should not contain NaN or Infinity
      expect(match).not.toContain('NaN')
      expect(match).not.toContain('Infinity')
    }
  })
})

describe('generateCharacterSheet', () => {
  it('returns valid SVG with three views', () => {
    const result = generateCharacterSheet()
    expect(result.svg).toContain('<svg')
    expect(result.svg).toContain('</svg>')
    // Should contain 3 translated groups (one per view)
    const transforms = result.svg.match(/transform="translate\(/g)
    expect(transforms.length).toBe(3)
  })

  it('has more paths than a single view', () => {
    const single = generateHumanWireframe()
    const sheet = generateCharacterSheet()
    expect(sheet.pathCount).toBeGreaterThan(single.pathCount * 2)
  })

  it('respects custom stroke color', () => {
    const result = generateCharacterSheet({ stroke: '#00ff00' })
    expect(result.svg).toContain('stroke="#00ff00"')
  })
})
