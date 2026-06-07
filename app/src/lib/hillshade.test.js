import { describe, it, expect } from 'vitest'
import { shadeToToneRGBA } from './hillshade.js'

// v9.3.39: relieffet blendes nå via bakt alfa (normal kompositt) i stedet for
// mix-blend-mode. shadeToToneRGBA må være PIKSELIDENTISK med de gamle blend-
// modusene — ellers endrer relieffet utseende. Testene låser ekvivalensen.

const mkShade = (grays) => {
  const rgba = new Uint8ClampedArray(grays.length * 4)
  grays.forEach((g, i) => {
    rgba[i * 4] = g; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = g; rgba[i * 4 + 3] = 255
  })
  return { cols: grays.length, rows: 1, rgba }
}

describe('shadeToToneRGBA — blend bakt inn i alfa', () => {
  it('multiply: svart overlegg, alfa = 255 − skygge', () => {
    const out = shadeToToneRGBA(mkShade([0, 128, 255]), 'multiply')
    // px0 (mørk skygge) → helt svart, full dekning
    expect([out[0], out[1], out[2], out[3]]).toEqual([0, 0, 0, 255])
    // px1 (midt) → svart, halv alfa
    expect([out[4], out[5], out[6], out[7]]).toEqual([0, 0, 0, 127])
    // px2 (lyst = ingen skygge) → gjennomsiktig
    expect([out[8], out[9], out[10], out[11]]).toEqual([0, 0, 0, 0])
  })

  it('screen: hvitt overlegg, alfa = skygge', () => {
    const out = shadeToToneRGBA(mkShade([0, 128, 255]), 'screen')
    expect([out[0], out[1], out[2], out[3]]).toEqual([255, 255, 255, 0])
    expect([out[4], out[5], out[6], out[7]]).toEqual([255, 255, 255, 128])
    expect([out[8], out[9], out[10], out[11]]).toEqual([255, 255, 255, 255])
  })

  it('feather: kant-alfa tones til 0, senter uberørt (3×3-flis-relieff)', () => {
    // 9×9 fullt mørk skygge (g=0 ⇒ multiply-alfa=255 overalt uten feather).
    const n = 9
    const shade = { cols: n, rows: n, rgba: new Uint8ClampedArray(n * n * 4) }
    for (let i = 0; i < n * n; i++) { shade.rgba[i * 4 + 3] = 255 }
    const plain = shadeToToneRGBA(shade, 'multiply')
    const feathered = shadeToToneRGBA(shade, 'multiply', { feather: 0.2 })
    const at = (buf, r, c) => buf[(r * n + c) * 4 + 3]
    // Uten feather: full dekning overalt
    expect(at(plain, 0, 0)).toBe(255)
    expect(at(plain, 4, 4)).toBe(255)
    // Med feather: hjørnet (kant) → 0, senteret beholder full alfa
    expect(at(feathered, 0, 0)).toBe(0)
    expect(at(feathered, 4, 4)).toBe(255)
    // Monotont stigende innover fra kanten langs diagonalen
    expect(at(feathered, 1, 1)).toBeLessThan(at(feathered, 2, 2))
  })

  it('feather=0 er identisk med ingen feather (bakoverkompat)', () => {
    const shade = mkShade([0, 64, 128, 192, 255])
    const a = shadeToToneRGBA(shade, 'screen')
    const b = shadeToToneRGBA(shade, 'screen', { feather: 0 })
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('alfa-kompositt er matematisk lik mix-blend-mode for alle skygge/base-par', () => {
    const grays = [0, 32, 64, 128, 200, 255]
    const bases = [0, 50, 128, 220, 255]
    const mul = shadeToToneRGBA(mkShade(grays), 'multiply')
    const scr = shadeToToneRGBA(mkShade(grays), 'screen')
    grays.forEach((g, i) => {
      for (const base of bases) {
        // multiply: base × (skygge/255)
        const aM = mul[i * 4 + 3] / 255
        const overBlack = base * (1 - aM) + 0 * aM
        expect(Math.round(overBlack)).toBe(Math.round(base * (g / 255)))
        // screen: 1 − (1−base)(1−skygge/255)
        const aS = scr[i * 4 + 3] / 255
        const overWhite = base * (1 - aS) + 255 * aS
        const screenRef = 255 * (1 - (1 - base / 255) * (1 - g / 255))
        expect(Math.round(overWhite)).toBe(Math.round(screenRef))
      }
    })
  })
})
