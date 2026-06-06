// mapSvg.worker.js — kjører buildSvg (DOM-fri) utenfor main-thread.
//
// buildSvg gjør tunge synkrone pass (stupkant-skeletonisering, marching-squares-
// konturer, polygon-clipping-unions) som ellers fryser UI-en i flere sekunder.
// Workeren spawnes pr bygging (se buildSvgClient.js) og termineres etterpå —
// terminering ved abort stopper CPU-arbeidet umiddelbart (gratis avbryt for
// spekulativ prefetch som bommet).
//
// buildSvg er ren string-bygging uten DOM-avhengighet (kjører også i Node i
// CI, scripts/build-vardasen-svg.js), så den kan løftes rett inn hit.
import { buildSvg } from './mapBuilder.js'

self.onmessage = (e) => {
  const { elements, bbox, options } = e.data ?? {}
  try {
    const { svg, counts, timings } = buildSvg(elements, bbox, options)
    self.postMessage({ ok: true, svg, counts, timings })
  } catch (err) {
    self.postMessage({ ok: false, error: err?.message ?? String(err) })
  }
}
