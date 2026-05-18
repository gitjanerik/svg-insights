// Squash & stretch-animasjon for Stedsmerke-annotering (codename: geocache).
// Én syklus pr 5s. Tilfeldig pre-roll-offset (negativ begin) per instans så
// flere stedsmerker på samme kart ikke spretter i takt.
//
// Keyframes (timing-fraksjon av 5s-syklusen, transform relativt til hvile):
//   0.00 — hvile
//   0.02 — antesipering (squat ned)
//   0.06 — utskytning (strekk opp)
//   0.12 — apex (toppunkt, lett strekk)
//   0.18 — landing (squash)
//   0.21 — rebound (lite tilbakesprett)
//   0.22 — hvile
//   1.00 — holder hvile resten av syklusen
//
// Tegnes som nestede <g>-er: ytterste plasserer pin-tip-en i rest-posisjon,
// midtre animerer translate Y (sprett), innerste animerer scale (squash &
// stretch). SMIL `animateTransform` støtter KUN translate/scale/rotate/
// skewX/skewY — IKKE matrix (en tidlig versjon av denne fila prøvde matrix
// og endte med pin-er som forsvant ut av viewBox).

export const STEDSMERKE_KEY_TIMES = '0; 0.02; 0.06; 0.12; 0.18; 0.21; 0.22; 1'
export const STEDSMERKE_DUR = '5s'

// ty er som fraksjon av s (pin head-radius), sx/sy er rene faktorer.
const PIN_FRAMES = [
  { sx: 1.00, sy: 1.00, ty:  0.00 },
  { sx: 1.10, sy: 0.90, ty:  0.10 },
  { sx: 0.92, sy: 1.10, ty: -0.40 },
  { sx: 0.96, sy: 1.06, ty: -1.20 },
  { sx: 1.20, sy: 0.80, ty:  0.00 },
  { sx: 0.98, sy: 1.03, ty: -0.15 },
  { sx: 1.00, sy: 1.00, ty:  0.00 },
  { sx: 1.00, sy: 1.00, ty:  0.00 },
]

const SHADOW_X_FACTORS = [1.00, 1.12, 0.78, 0.42, 1.28, 0.92, 1.00, 1.00]
const SHADOW_OPACITY_VALUES = [0.55, 0.58, 0.40, 0.18, 0.62, 0.50, 0.55, 0.55]

const fmt = (n) => Number(n.toFixed(4)).toString()

// Translate-values for pin-ens mid-g (ty-koordinatet skalert med s).
export function pinTranslateValues(s) {
  return PIN_FRAMES.map(f => `0 ${fmt(f.ty * s)}`).join('; ')
}

// Scale-values for pin-ens inner-g (uavhengig av s — kun rene faktorer).
export const PIN_SCALE_VALUES =
  PIN_FRAMES.map(f => `${fmt(f.sx)} ${fmt(f.sy)}`).join('; ')

// Skygge-scale: kun horisontal faktor animerer, vertikal holdes på 1.
// Selve skygge-størrelsen styres av outer-g sin statiske scale-transform.
export const SHADOW_SCALE_VALUES =
  SHADOW_X_FACTORS.map(f => `${fmt(f)} 1`).join('; ')

export const STEDSMERKE_SHADOW_OPACITY = SHADOW_OPACITY_VALUES.join('; ')

// Random pre-roll så flere markører ikke spretter i takt. Negativ begin =
// animasjonen er allerede i gang ved page-load, i en tilfeldig fase.
export function randomBegin() {
  return `-${(Math.random() * 5).toFixed(2)}s`
}

// Pin-path med tip i (0,0), hode-radius = s, hode-senter (0, -1.85s).
// Total høyde = 2.85s, bredde = 2s.
export function pinPath(s) {
  const r = s
  const hy = -1.85 * s
  const cx = 0.29 * s
  const cy1 = -0.58 * s
  const cy2 = -1.17 * s
  return `M 0 0 C ${fmt(-cx)} ${fmt(cy1)}, ${fmt(-r)} ${fmt(cy2)}, ${fmt(-r)} ${fmt(hy)} A ${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(r)} ${fmt(hy)} C ${fmt(r)} ${fmt(cy2)}, ${fmt(cx)} ${fmt(cy1)}, 0 0 Z`
}
