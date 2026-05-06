// Henter ut frames fra en MediaStream og konverterer til luminans-bilder.
// Vi bruker Float32Array for luminans (Rec. 709) slik at downstream-algoritmer
// (Harris, Lucas-Kanade) kan jobbe direkte uten ekstra konvertering.

export function createFrameGrabber(videoEl, { width = 320, height = 240 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  function grab(timestamp) {
    ctx.drawImage(videoEl, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)
    const luma = rgbaToLuminance(imageData.data, width, height)
    return { timestamp, width, height, luma }
  }

  return { grab, width, height }
}

export function rgbaToLuminance(rgba, width, height) {
  const out = new Float32Array(width * height)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    // Rec. 709 luminance, normalisert til 0..1
    out[j] = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255
  }
  return out
}

// Spiller av et opptak: kaller onFrame med jevne mellomrom over duration ms,
// returnerer Promise som resolver med array av frames.
export function recordFrames({ grabber, durationMs = 3000, fps = 15, onProgress }) {
  return new Promise((resolve) => {
    const frames = []
    const intervalMs = 1000 / fps
    const start = performance.now()
    let raf = null

    function tick() {
      const now = performance.now()
      const elapsed = now - start
      const expected = Math.floor(elapsed / intervalMs)

      if (expected > frames.length && elapsed < durationMs) {
        const t = now - start
        frames.push(grabber.grab(t))
        if (onProgress) onProgress(elapsed / durationMs, frames.length)
      }

      if (elapsed < durationMs) {
        raf = requestAnimationFrame(tick)
      } else {
        resolve(frames)
      }
    }

    raf = requestAnimationFrame(tick)
  })
}
