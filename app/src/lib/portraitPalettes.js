// Kuraterte fargepaletter for det digitale selvbildet.
//
// Inspirert av Simpsons-karakterer + Warhols pop-art-printer. Knall flater,
// sorte konturer, ingen forsøk på realisme — vi har gitt opp foto-realisme
// til fordel for genuin SVG-stil.
//
// Hver palett spesifiserer:
//   - skin:     hovedfarge for hudet
//   - hair:     hårfarge (brukt hvis hår detektert)
//   - beard:    skjeggfarge (brukt hvis skjegg detektert)
//   - eyeWhite: hvitøye
//   - pupil:    pupill
//   - mouth:    leppe-farge
//   - glasses:  brille-ramme
//   - outline:  hovedkontur-farge
//   - bg:       bakgrunn

export const PALETTES = [
  {
    name: 'Klassisk',
    skin: '#FED90F',
    hair: '#1A4F8A',
    beard: '#5B3A29',
    eyeWhite: '#FFFFFF',
    pupil: '#000000',
    mouth: '#A23131',
    glasses: '#000000',
    outline: '#000000',
    bg: '#FF6B9D',
  },
  {
    name: 'Homer',
    skin: '#FED90F',
    hair: '#3D2817',
    beard: '#3D2817',
    eyeWhite: '#FFFFFF',
    pupil: '#000000',
    mouth: '#6B3030',
    glasses: '#000000',
    outline: '#000000',
    bg: '#5DB8FF',
  },
  {
    name: 'Lisa',
    skin: '#FED90F',
    hair: '#FFA000',
    beard: '#E89000',
    eyeWhite: '#FFFFFF',
    pupil: '#000000',
    mouth: '#C04040',
    glasses: '#000000',
    outline: '#000000',
    bg: '#A78BFA',
  },
  {
    name: 'Marge',
    skin: '#FED90F',
    hair: '#3D5DD8',
    beard: '#3D5DD8',
    eyeWhite: '#FFFFFF',
    pupil: '#000000',
    mouth: '#A23131',
    glasses: '#000000',
    outline: '#000000',
    bg: '#FFD400',
  },
  {
    name: 'Krusty',
    skin: '#FED90F',
    hair: '#5DAA52',
    beard: '#3D7A32',
    eyeWhite: '#FFFFFF',
    pupil: '#000000',
    mouth: '#FF4500',
    glasses: '#000000',
    outline: '#000000',
    bg: '#FFE066',
  },
  {
    name: 'Marilyn',
    skin: '#FFD3A3',
    hair: '#FFE066',
    beard: '#A87044',
    eyeWhite: '#FFFFFF',
    pupil: '#000000',
    mouth: '#FF1744',
    glasses: '#000000',
    outline: '#000000',
    bg: '#FF6B9D',
  },
  {
    name: 'Pop',
    skin: '#FFC107',
    hair: '#E91E63',
    beard: '#9C27B0',
    eyeWhite: '#FFFFFF',
    pupil: '#000000',
    mouth: '#3F51B5',
    glasses: '#000000',
    outline: '#000000',
    bg: '#00BCD4',
  },
  {
    name: 'Mint',
    skin: '#7FE5C4',
    hair: '#FF6B9D',
    beard: '#FF8C42',
    eyeWhite: '#FFFFFF',
    pupil: '#000000',
    mouth: '#FFD400',
    glasses: '#000000',
    outline: '#0F2027',
    bg: '#1A1A2E',
  },
  {
    name: 'Banan',
    skin: '#FED90F',
    hair: '#1976D2',
    beard: '#1976D2',
    eyeWhite: '#FFFFFF',
    pupil: '#000000',
    mouth: '#D32F2F',
    glasses: '#FFD400',
    outline: '#FFD400',
    bg: '#212121',
  },
  {
    name: 'Neon',
    skin: '#FF4081',
    hair: '#00E5FF',
    beard: '#76FF03',
    eyeWhite: '#FFFFFF',
    pupil: '#000000',
    mouth: '#FFEA00',
    glasses: '#FFEA00',
    outline: '#000000',
    bg: '#3D5AFE',
  },
]

// Returnerer en tilfeldig palett som ikke er den nåværende
export function pickRandomPalette(currentName = null) {
  const candidates = currentName
    ? PALETTES.filter(p => p.name !== currentName)
    : PALETTES
  return candidates[Math.floor(Math.random() * candidates.length)]
}

// Default-palett (Klassisk Simpsons)
export function defaultPalette() {
  return PALETTES[0]
}

// HSL-konvertering brukt til å avlede skygger fra hovedfargen
export function hexToHsl(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let H = 0, S = 0
  const L = (max + min) / 2

  if (max !== min) {
    const d = max - min
    S = L > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) H = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) H = (b - r) / d + 2
    else H = (r - g) / d + 4
    H /= 6
  }
  return { h: H * 360, s: S * 100, l: L * 100 }
}

export function hslToHex(h, s, l) {
  s = Math.max(0, Math.min(100, s)) / 100
  l = Math.max(0, Math.min(100, l)) / 100
  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const r = Math.round(f(0) * 255)
  const g = Math.round(f(8) * 255)
  const b = Math.round(f(4) * 255)
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
}

// Skygger en hex-farge basert på brightness (0..1).
// 0 = mørk skygge, 0.5 = base, 1 = lyst høylys.
export function shadeColor(hex, brightness) {
  const { h, s, l } = hexToHsl(hex)
  // Map brightness til lyshets-spenn rundt original
  const targetL = Math.max(15, Math.min(92, l * (0.45 + brightness * 0.85)))
  // Litt redusert metning på mørke partier
  const targetS = brightness < 0.4 ? s * (0.7 + brightness * 0.7) : s
  return hslToHex(h, targetS, targetL)
}
