// Squash & stretch-animasjon for Stedsmerke-annotering.
//
// To moduser:
//   - Map (kontinuerlig loop, 5s syklus): kart åpnet/gjenåpnet, pin-ene
//     spretter én gang pr 5s med tilfeldig pre-roll så de ikke synker takt.
//   - Hit (one-shot, 1.1s): i CurveInvaders trigges animasjonen NÅR ballen
//     treffer bumperen, ikke kontinuerlig. Caller bruker :key på bp.hits
//     for å tvinge Vue til å re-mounte SMIL-tagene ved hvert treff.
//
// Begge bruker de samme 7 nøkkelposisjonene (rest → anticipate → launch →
// apex → impact → rebound → rest). Map-modus appender en 8. duplikert
// hvile-frame ved keyTime=1 for å holde stille gjennom 3.9s idle-fase.
//
// Tegnes som nestede <g>-er: ytterste plasserer pin-tip-en i hvile-
// posisjon, midtre animerer translate Y (sprett), innerste animerer scale
// (squash & stretch). SMIL `animateTransform` støtter KUN translate/scale/
// rotate/skewX/skewY — IKKE matrix.

const ACTION_FRAMES = [
  { sx: 1.00, sy: 1.00, ty:  0.00 },  // rest
  { sx: 1.10, sy: 0.90, ty:  0.10 },  // anticipate (squat)
  { sx: 0.92, sy: 1.10, ty: -0.40 },  // launch (stretch)
  { sx: 0.96, sy: 1.06, ty: -1.20 },  // apex (peak)
  { sx: 1.20, sy: 0.80, ty:  0.00 },  // impact (squash)
  { sx: 0.98, sy: 1.03, ty: -0.15 },  // rebound
  { sx: 1.00, sy: 1.00, ty:  0.00 },  // settle = rest
]

const SHADOW_X = [1.00, 1.12, 0.78, 0.42, 1.28, 0.92, 1.00]
const SHADOW_OP = [0.55, 0.58, 0.40, 0.18, 0.62, 0.50, 0.55]

const fmt = (n) => Number(n.toFixed(4)).toString()

// ─── Map mode: continuous 5s loop ────────────────────────────────────────
// Action takes first 22% (= 1.1s), så hold-rest fra 22%–100% (= 3.9s idle).
const MAP_FRAMES   = [...ACTION_FRAMES, { sx: 1, sy: 1, ty: 0 }]
const MAP_SHADOW_X = [...SHADOW_X, 1.00]
const MAP_SHADOW_OP = [...SHADOW_OP, 0.55]

export const STEDSMERKE_KEY_TIMES = '0; 0.02; 0.06; 0.12; 0.18; 0.21; 0.22; 1'
export const STEDSMERKE_DUR = '5s'

export const PIN_SCALE_VALUES =
  MAP_FRAMES.map(f => `${fmt(f.sx)} ${fmt(f.sy)}`).join('; ')

export function pinTranslateValues(s) {
  return MAP_FRAMES.map(f => `0 ${fmt(f.ty * s)}`).join('; ')
}

export const SHADOW_SCALE_VALUES =
  MAP_SHADOW_X.map(f => `${fmt(f)} 1`).join('; ')

export const STEDSMERKE_SHADOW_OPACITY = MAP_SHADOW_OP.join('; ')

// ─── Hit mode: 1.1s one-shot ─────────────────────────────────────────────
// Action mapped over hele dur (0..1). Brukes med repeatCount="1" og
// fill="freeze" — pin holder seg på siste keyframe (= rest) etter slutt.
export const STEDSMERKE_HIT_KEY_TIMES =
  '0; 0.0909; 0.2727; 0.5455; 0.8182; 0.9545; 1'
export const STEDSMERKE_HIT_DUR = '1.1s'

export const PIN_SCALE_VALUES_HIT =
  ACTION_FRAMES.map(f => `${fmt(f.sx)} ${fmt(f.sy)}`).join('; ')

export function pinTranslateValuesHit(s) {
  return ACTION_FRAMES.map(f => `0 ${fmt(f.ty * s)}`).join('; ')
}

export const SHADOW_SCALE_VALUES_HIT =
  SHADOW_X.map(f => `${fmt(f)} 1`).join('; ')

export const STEDSMERKE_SHADOW_OPACITY_HIT = SHADOW_OP.join('; ')

// Random pre-roll så flere kart-markører ikke spretter i takt. Brukes kun
// av map-modus (hit-modus er allerede asynkron via treff).
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
