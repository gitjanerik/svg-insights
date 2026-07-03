// BRouter-klient for Ruteplanleggeren: profil-opplasting + ruteberegning mot
// den offentlige brouter.de-serveren (samme API som bikerouter.de bruker fra
// nettleser — CORS er åpent).
//
// Fair use: donasjonsdrevet tjeneste — ett kall per brukerhandling, ingen
// polling. Attribusjon vises i UI-et («Ruting: BRouter (brouter.de)»).
//
// MERK (sandkasse): brouter.de er ikke nåbar fra CI-/utviklingssandkassen
// (proxy-blokkert), så parseren er skrevet mot dokumentert responsformat med
// syntetisk fixture (brouterFixture.json) — live-verifisering gjøres fra
// klient/mobil.

export const BROUTER_BASE = 'https://brouter.de/brouter'
// Bumpes når grusprofil.brf endres → invaliderer cachet profileid så neste
// rutekall laster opp ny profil.
export const PROFILE_VERSION = 1
export const BROUTER_TIMEOUT_MS = 20000
const PROFILE_CACHE_KEY = 'grus-brouter-profile'

export class ProfileExpiredError extends Error {
  constructor(msg) { super(msg); this.name = 'ProfileExpiredError' }
}

// POST profilteksten → {profileid: "custom_…"}.
export async function uploadProfile(profileText, { fetchFn = fetch } = {}) {
  const res = await fetchFn(`${BROUTER_BASE}/profile`, { method: 'POST', body: profileText })
  if (!res.ok) throw new Error(`BRouter profil-opplasting feilet (${res.status})`)
  const data = await res.json()
  if (!data?.profileid) throw new Error(`BRouter profil-opplasting ga uventet svar: ${JSON.stringify(data).slice(0, 120)}`)
  return data.profileid
}

// Hent (evt. cachet) profileid. Cache i sessionStorage overlever navigering
// men ikke ny fane — profileid-er på serveren er uansett kortlevde, så en
// re-opplasting ved ny økt er riktig oppførsel. `key` skiller flere profiler
// (grus-maks / balansert) i samme cache-navnerom.
export async function ensureProfileId(loadProfileText, { fetchFn = fetch, storage, key = 'grus' } = {}) {
  const store = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null)
  const cacheKey = `${PROFILE_CACHE_KEY}:${key}`
  try {
    const cached = JSON.parse(store?.getItem(cacheKey) ?? 'null')
    if (cached?.id && cached.v === PROFILE_VERSION) return cached.id
  } catch { /* korrupt cache — last opp på nytt */ }
  const text = await loadProfileText()
  const id = await uploadProfile(text, { fetchFn })
  try { store?.setItem(cacheKey, JSON.stringify({ id, v: PROFILE_VERSION, t: 0 })) } catch { /* noop */ }
  return id
}

export function clearProfileCache(storage, key = 'grus') {
  const store = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null)
  try { store?.removeItem(`${PROFILE_CACHE_KEY}:${key}`) } catch { /* noop */ }
}

// Luftlinje-avstand (haversine) i meter — «Luftlinje»-flisa i rute-resultatet.
export function haversineM(a, b) {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLon = (b.lon - a.lon) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Hent rute. waypoints = [{lat, lon}, …] (A, evt. via-punkter, B).
 * MERK: BRouter vil ha LON FØRST i lonlats-parameteret.
 * Kaster ProfileExpiredError ved 4xx med profil-relatert feiltekst, slik at
 * kalleren kan re-laste profilen og prøve én gang til.
 */
export async function fetchRoute(waypoints, profileId, { fetchFn = fetch, signal } = {}) {
  const lonlats = waypoints.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join('|')
  const url = `${BROUTER_BASE}?lonlats=${encodeURIComponent(lonlats)}&profile=${encodeURIComponent(profileId)}&alternativeidx=0&format=geojson`
  const res = await fetchFn(url, { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status >= 400 && res.status < 500 && /profile/i.test(text)) {
      throw new ProfileExpiredError(`BRouter avviste profilen (${res.status}): ${text.slice(0, 160)}`)
    }
    throw new Error(`BRouter-feil ${res.status}: ${text.slice(0, 160)}`)
  }
  return res.json()
}

// Grus-familien slik BRouter/OSM-tags rapporterer den i WayTags.
const GRAVELISH = new Set(['gravel', 'compacted', 'fine_gravel', 'unpaved', 'ground', 'dirt', 'pebblestone', 'sand', 'grass'])
const PAVEDISH = new Set(['asphalt', 'paved', 'concrete', 'paving_stones', 'sett', 'cobblestone', 'metal', 'wood'])

// 'highway=track surface=gravel …' → 'gravel' | 'paved' | 'unknown'
export function classifyWayTags(wayTagsString) {
  const tags = {}
  for (const kv of String(wayTagsString ?? '').split(/\s+/)) {
    const i = kv.indexOf('=')
    if (i > 0) tags[kv.slice(0, i)] = kv.slice(i + 1)
  }
  if (tags.surface) {
    if (GRAVELISH.has(tags.surface)) return 'gravel'
    if (PAVEDISH.has(tags.surface)) return 'paved'
    return 'unknown'
  }
  // Track uten surface = antatt grus (samme stance som gravelOverlay).
  if (tags.highway === 'track') return 'gravel'
  return 'unknown'
}

/**
 * Parse BRouter-geojson → {points, lengthM, segments|null, gravelShare|null, gravelM}.
 *
 * Responsformat (dokumentert/bikerouter-kjent, fixture-testet — verifiseres
 * live fra klient): features[0] er en LineString med
 *   properties['track-length'] = total lengde i meter (streng)
 *   properties.messages = [headerRad, …dataRader] der hver dataRad beskriver
 *     way-seksjonen FREM TIL punktet (Longitude/Latitude i MIKROGRADER,
 *     Distance i meter, WayTags som mellomrom-separert key=value-streng).
 *
 * Defensivt: mangler messages, eller < 80 % av distansen lar seg mappe mot
 * linjegeometrien → segments:null / gravelShare:null (UI viser uniform farge
 * og skjuler grusandelen).
 */
export function parseRoute(geojson) {
  const feat = geojson?.features?.[0]
  const coords = feat?.geometry?.coordinates
  if (!Array.isArray(coords) || coords.length < 2) {
    throw new Error('BRouter-svaret mangler rutegeometri')
  }
  const points = coords.map((c) => [c[0], c[1], c[2]])
  const lengthM = Number(feat.properties?.['track-length']) || 0
  const totalTimeS = Number(feat.properties?.['total-time']) || null

  const messages = feat.properties?.messages
  if (!Array.isArray(messages) || messages.length < 2) {
    return { points, lengthM, totalTimeS, segments: null, gravelShare: null, gravelM: null }
  }

  const header = messages[0].map((h) => String(h).toLowerCase())
  const iLon = header.indexOf('longitude')
  const iLat = header.indexOf('latitude')
  const iDist = header.indexOf('distance')
  const iTags = header.indexOf('waytags')
  if (iLon < 0 || iLat < 0 || iDist < 0 || iTags < 0) {
    return { points, lengthM, totalTimeS, segments: null, gravelShare: null, gravelM: null }
  }

  // Indeksér linjepunktene på avrundet lon/lat for nærmeste-punkt-match.
  const key = (lon, lat) => `${lon.toFixed(5)},${lat.toFixed(5)}`
  const idxByKey = new Map()
  points.forEach(([lon, lat], i) => { if (!idxByKey.has(key(lon, lat))) idxByKey.set(key(lon, lat), i) })

  const segments = []
  let prevIdx = 0
  let matchedM = 0
  let gravelM = 0
  let totalMsgM = 0
  for (let r = 1; r < messages.length; r++) {
    const row = messages[r]
    const lon = Number(row[iLon]) / 1e6
    const lat = Number(row[iLat]) / 1e6
    const distM = Number(row[iDist]) || 0
    const cls = classifyWayTags(row[iTags])
    totalMsgM += distM
    const toIdx = idxByKey.get(key(lon, lat))
    if (toIdx != null && toIdx >= prevIdx) {
      segments.push({ fromIdx: prevIdx, toIdx, distM, surface: cls, gravel: cls === 'gravel' })
      prevIdx = toIdx
      matchedM += distM
    }
    if (cls === 'gravel') gravelM += distM
  }

  const denom = totalMsgM || lengthM
  if (!denom || matchedM / denom < 0.8) {
    // Geometri-mappingen er upålitelig — behold andelen kun hvis distansene
    // i det minste summerer fornuftig mot totalen, ellers alt null.
    const shareOk = denom > 0 && Math.abs(denom - lengthM) / Math.max(lengthM, 1) < 0.05
    return {
      points, lengthM, totalTimeS,
      segments: null,
      gravelShare: shareOk ? gravelM / denom : null,
      gravelM: shareOk ? gravelM : null,
    }
  }
  return { points, lengthM, totalTimeS, segments, gravelShare: gravelM / denom, gravelM }
}
