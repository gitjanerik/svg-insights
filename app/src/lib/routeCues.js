// Sti-kryss-varsler («hold til venstre ved Abbortjern») for en rute.
//
// Ideen: en rute svinger ofte i et VEIKRYSS der man må ta et valg. Vi går
// gjennom rutens punkter, finner der den svinger merkbart OG punktet faller på
// et faktisk kryss (node med grad ≥ 3 i rutenett-grafen), og fester nærmeste
// navngitte holdepunkt (vann/topp/kryss-navn) fra kartet. Retningen (venstre/
// høyre) regnes fra svingvinkelen.
//
// Ren funksjon: `junctionAt` og `namedPoints` injiseres, så algoritmen kan
// enhetstestes uten graf eller SVG. Anker-navnene er en heuristikk (nærmeste
// navnede punkt innen `nearM`) — ikke en garanti for at krysset heter det.
//
// Koordinater i SVG-meter, y-ned. Kompass: opp (−y) = nord = 0°, høyre (+x) = 90°.

function bearingDeg(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  return (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360
}

// Signert sving (−180,180]: positiv = med klokka = høyre (i y-ned skjermrom).
function turnDeg(inB, outB) {
  let d = outB - inB
  while (d <= -180) d += 360
  while (d > 180) d -= 360
  return d
}

function cumulative(route) {
  const out = [0]
  for (let i = 1; i < route.length; i++) {
    out.push(out[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]))
  }
  return out
}

function nearestNamed(p, namedPoints, nearM) {
  let best = null, bestD = nearM
  for (const np of namedPoints ?? []) {
    const d = Math.hypot(np.x - p[0], np.y - p[1])
    if (d < bestD) { bestD = d; best = np.name }
  }
  return best
}

export function formatDistanceM(m) {
  if (m < 950) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`
}

/**
 * Generer veibeskrivelse-varsler for en rute.
 * @param {Array<[number,number]>} route  SVG-meter
 * @param {{
 *   junctionAt?:(p:[number,number])=>boolean,
 *   namedPoints?:Array<{x:number,y:number,name:string}>,
 *   minTurnDeg?:number, nearM?:number, mergeM?:number,
 * }} [opts]
 * @returns {Array<{atM:number, side:'venstre'|'høyre', turnDeg:number, bearingDeg:number, near:string|null, text:string}>}
 */
export function routeCues(route, opts = {}) {
  const {
    junctionAt = () => true, namedPoints = [],
    minTurnDeg = 30, nearM = 140, mergeM = 60,
  } = opts
  if (!Array.isArray(route) || route.length < 3) return []
  const cum = cumulative(route)
  const cues = []

  for (let i = 1; i + 1 < route.length; i++) {
    const inB = bearingDeg(route[i - 1], route[i])
    const outB = bearingDeg(route[i], route[i + 1])
    const t = turnDeg(inB, outB)
    if (Math.abs(t) < minTurnDeg) continue
    if (!junctionAt(route[i])) continue

    const atM = cum[i]
    // Slå sammen med forrige varsel hvis de er tett på hverandre (unngå spam
    // i en sving-serie som egentlig er ett valg).
    const prev = cues[cues.length - 1]
    if (prev && atM - prev.atM < mergeM) {
      if (Math.abs(t) > Math.abs(prev.turnDeg)) Object.assign(prev, buildCue(atM, t, outB, route[i], namedPoints, nearM))
      continue
    }
    cues.push(buildCue(atM, t, outB, route[i], namedPoints, nearM))
  }
  return cues
}

function buildCue(atM, t, outB, p, namedPoints, nearM) {
  const side = t > 0 ? 'høyre' : 'venstre'
  const near = nearestNamed(p, namedPoints, nearM)
  const text = `Etter ${formatDistanceM(atM)}: ta til ${side}${near ? ` ved ${near}` : ''}`
  return { atM: Math.round(atM), side, turnDeg: Math.round(t), bearingDeg: Math.round(outB), near: near ?? null, text }
}

// Trekk ut navngitte punkter fra en kart-SVG (DOM-fri regex). Heuristikk: hvert
// <text> med x/y-attributter og en tekst som ligner et stedsnavn (ikke rene
// tall/enheter). Posisjonene er tekstens x/y i SVG-meter (transformer på
// foreldre-grupper ignoreres — grovt, men godt nok som kryss-anker).
export function extractNamedPointsFromSvg(svgText) {
  if (typeof svgText !== 'string') return []
  const out = []
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g
  let m
  while ((m = re.exec(svgText))) {
    const attrs = m[1]
    const raw = m[2].replace(/<[^>]*>/g, '').trim()
    const name = decodeEntities(raw)
    if (name.length < 3) continue
    if (/^[\d\s.,]+(m|km|moh|°)?$/i.test(name)) continue   // rene tall/høyder
    const x = parseFloat((attrs.match(/\bx="(-?[\d.]+)"/) || [])[1])
    const y = parseFloat((attrs.match(/\by="(-?[\d.]+)"/) || [])[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out.push({ x, y, name })
  }
  return out
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}
