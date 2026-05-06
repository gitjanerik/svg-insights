import { describe, it, expect } from 'vitest'
import { rgbaToLuminance } from './videoFrameCapture.js'

describe('rgbaToLuminance', () => {
  it('konverterer rent svart til 0', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255])
    const luma = rgbaToLuminance(rgba, 1, 1)
    expect(luma[0]).toBe(0)
  })

  it('konverterer rent hvitt til 1', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255])
    const luma = rgbaToLuminance(rgba, 1, 1)
    expect(luma[0]).toBeCloseTo(1, 5)
  })

  it('bruker Rec. 709-vekter (grønn dominerer)', () => {
    const red = rgbaToLuminance(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1)
    const green = rgbaToLuminance(new Uint8ClampedArray([0, 255, 0, 255]), 1, 1)
    const blue = rgbaToLuminance(new Uint8ClampedArray([0, 0, 255, 255]), 1, 1)
    expect(green[0]).toBeGreaterThan(red[0])
    expect(red[0]).toBeGreaterThan(blue[0])
    expect(green[0]).toBeCloseTo(0.7152, 4)
    expect(red[0]).toBeCloseTo(0.2126, 4)
    expect(blue[0]).toBeCloseTo(0.0722, 4)
  })

  it('returnerer Float32Array med riktig størrelse', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4) // 4x4-bilde
    const luma = rgbaToLuminance(rgba, 4, 4)
    expect(luma).toBeInstanceOf(Float32Array)
    expect(luma.length).toBe(16)
  })
})
