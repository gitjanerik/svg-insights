// Flerspråklige stedsnavn i Nord-Norge: OSM lagrer ofte norsk, samisk og
// kvensk/finsk i ÉTT `name`-felt adskilt med mellomrom-omkranset bindestrek
// eller skråstrek, f.eks.:
//
//   "Bugøynes - Buođggák - Pykeijä"   (norsk - nordsamisk - kvensk)
//   "Svinøya - Spiidnesuolu"          (norsk - nordsamisk)
//   "Kåfjord / Gáivuotna / Kaivuono"  (skråstrek-variant)
//
// Det norske navnet er første ledd. `norwegianName` henter det ut så kartet
// kan vises rent (kun norsk) som default, med en bryter for fulle navn.
//
// Skilletegnet KREVER mellomrom på begge sider, slik at ekte bindestreksnavn
// ("Sør-Trøndelag", "Nord-Norge", "Vest-Agder") aldri splittes.

const MULTILANG_SEP = /\s+[-–—/]\s+/

export function norwegianName(full) {
  const s = String(full ?? '').trim()
  if (!s) return s
  const first = s.split(MULTILANG_SEP)[0].trim()
  return first || s
}

export function hasMultilangName(full) {
  return MULTILANG_SEP.test(String(full ?? ''))
}
