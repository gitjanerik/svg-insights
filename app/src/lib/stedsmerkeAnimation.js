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
// SMIL `animateTransform type="matrix"` brukes for å kombinere skala+translate
// i én animasjon — additive på to nestet g-er er upresist i Safari.

export const STEDSMERKE_KEY_TIMES = '0; 0.02; 0.06; 0.12; 0.18; 0.21; 0.22; 1'
export const STEDSMERKE_DUR = '5s'

// (sx, sy, ty) der ty er translate-Y som fraksjon av s (pin head-radius).
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

// Skygge: kun horisontal skala animerer, vertikal holdes fast (flat skygge).
const SHADOW_X_FACTORS = [1.00, 1.12, 0.78, 0.42, 1.28, 0.92, 1.00, 1.00]
const SHADOW_OPACITY_VALUES = [0.55, 0.58, 0.40, 0.18, 0.62, 0.50, 0.55, 0.55]

const fmt = (n) => Number(n.toFixed(4)).toString()

export function buildPinMatrixValues(s, px, py) {
  return PIN_FRAMES
    .map(f => `${fmt(f.sx)} 0 0 ${fmt(f.sy)} ${fmt(px)} ${fmt(py + f.ty * s)}`)
    .join('; ')
}

export function buildShadowMatrixValues(rx, ry, px, py) {
  return SHADOW_X_FACTORS
    .map(f => `${fmt(rx * f)} 0 0 ${fmt(ry)} ${fmt(px)} ${fmt(py)}`)
    .join('; ')
}

export const STEDSMERKE_SHADOW_OPACITY = SHADOW_OPACITY_VALUES.join('; ')

export function randomBegin() {
  return `-${(Math.random() * 5).toFixed(2)}s`
}

// Pin-path med tip i (0,0), hode-radius = s, hode-senter (0, -1.85s).
// Total høyde = 2.85s, bredde = 2s. Matcher klassisk map-marker-proporsjon.
export function pinPath(s) {
  const r = s
  const hy = -1.85 * s
  const cx = 0.29 * s
  const cy1 = -0.58 * s
  const cy2 = -1.17 * s
  return `M 0 0 C ${fmt(-cx)} ${fmt(cy1)}, ${fmt(-r)} ${fmt(cy2)}, ${fmt(-r)} ${fmt(hy)} A ${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(r)} ${fmt(hy)} C ${fmt(r)} ${fmt(cy2)}, ${fmt(cx)} ${fmt(cy1)}, 0 0 Z`
}
