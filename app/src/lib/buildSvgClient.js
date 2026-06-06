// buildSvgClient.js — kjør buildSvg i en Web Worker når mulig, ellers synkront.
//
// I nettleseren spawnes en dedikert worker pr kall så det tunge buildSvg-passet
// ikke fryser UI-en (viktig for at kartet du panner på holder seg responsivt
// mens et nytt kart bygges i bakgrunnen — spekulativ prefetch). Workeren
// termineres når byggingen er ferdig eller blir avbrutt; terminering = umiddelbar
// stopp av CPU-arbeidet.
//
// I Node/CI/test (ingen Worker) faller vi tilbake til synkron buildSvg, så
// scripts/build-vardasen-svg.js og enhetstester er uberørt.
import { buildSvg } from './mapBuilder.js'

export function buildSvgClient(elements, bbox, options = {}, { signal } = {}) {
  if (typeof Worker === 'undefined') {
    // Node / fallback: kjør synkront.
    if (signal?.aborted) return Promise.reject(new DOMException('Avbrutt', 'AbortError'))
    try {
      return Promise.resolve(buildSvg(elements, bbox, options))
    } catch (e) {
      return Promise.reject(e)
    }
  }

  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(new URL('./mapSvg.worker.js', import.meta.url), { type: 'module' })
    } catch {
      // Klarte ikke å lage worker (gammel nettleser / CSP) → synkron fallback.
      try { resolve(buildSvg(elements, bbox, options)) } catch (e) { reject(e) }
      return
    }

    const onAbort = () => {
      cleanup()
      reject(new DOMException('Avbrutt', 'AbortError'))
    }
    function cleanup() {
      try { worker.terminate() } catch { /* noop */ }
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    if (signal) {
      if (signal.aborted) { cleanup(); reject(new DOMException('Avbrutt', 'AbortError')); return }
      signal.addEventListener('abort', onAbort)
    }

    worker.onmessage = (e) => {
      cleanup()
      if (e.data?.ok) resolve({ svg: e.data.svg, counts: e.data.counts, timings: e.data.timings })
      else reject(new Error(e.data?.error ?? 'buildSvg-worker feilet'))
    }
    worker.onerror = (e) => {
      cleanup()
      reject(new Error(e.message ?? 'buildSvg-worker-feil'))
    }

    // elements (kan være noen MB) + dem (Float32Array) struktur-klones til
    // workeren. Vi transfererer IKKE dem-bufferet, fordi buildMapFromCenter
    // bruker dem etterpå (packDem/findHighestPoint) — detach ville ødelagt det.
    worker.postMessage({ elements, bbox, options })
  })
}
