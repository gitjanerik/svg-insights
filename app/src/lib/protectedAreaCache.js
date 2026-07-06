// Klient-side cache for verneområde-oppslag (Naturbase / GBIF / Wikipedia).
//
// ChatGPT-spec'en foreslo Redis; i en statisk PWA er IndexedDB + en
// in-memory session-map den naturlige analogen. Eksterne API-er kalles kun ved
// cache-miss; gjentatte oppslag på samme område er momentane.
//
// TTL etter spec: verne-metadata 30 dager, arter 24 t, Wikipedia 7 dager.

const DB_NAME = 'svg-insights-cache'
const STORE = 'entries'
const DB_VERSION = 1

export const TTL = {
  vern: 30 * 24 * 60 * 60 * 1000,
  naturtype: 30 * 24 * 60 * 60 * 1000,
  species: 24 * 60 * 60 * 1000,
  wiki: 7 * 24 * 60 * 60 * 1000,
  kulturminne: 30 * 24 * 60 * 60 * 1000,
}

// Session-minne foran IndexedDB — unngår en async DB-tur når punktet allerede
// er sett denne økten.
const mem = new Map()

let dbPromise = null
function open() {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') {
    dbPromise = Promise.resolve(null)
    return dbPromise
  }
  dbPromise = new Promise((resolve) => {
    let req
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null) // cache er valgfri — degrader stille
  })
  return dbPromise
}

function asPromise(req) {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(undefined)
  })
}

/**
 * Hent en cachet verdi, eller null hvis fraværende/utløpt.
 * @param {string} key
 * @returns {Promise<any | null>}
 */
export async function cacheGet(key) {
  const now = Date.now()
  const hit = mem.get(key)
  if (hit) {
    if (hit.expires > now) return hit.data
    mem.delete(key)
  }
  const db = await open()
  if (!db) return null
  try {
    const store = db.transaction(STORE, 'readonly').objectStore(STORE)
    const row = await asPromise(store.get(key))
    if (row && row.expires > now) {
      mem.set(key, row)
      return row.data
    }
  } catch {
    /* degrader stille */
  }
  return null
}

/**
 * Lagre en verdi med TTL. `data === null/undefined` lagres ikke (vi cacher ikke
 * «ingen treff» — neste oppslag skal kunne prøve på nytt).
 * @param {string} key
 * @param {any} data
 * @param {number} ttlMs
 */
export async function cacheSet(key, data, ttlMs) {
  if (data == null) return
  const row = { key, data, expires: Date.now() + ttlMs }
  mem.set(key, row)
  const db = await open()
  if (!db) return
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    store.put(row)
  } catch {
    /* degrader stille */
  }
}

/** Nøkkel for verne-oppslag på et grid (~100 m) så nære klikk treffer samme. */
export function pointKey(lat, lon) {
  return `vern:pt:${lat.toFixed(3)},${lon.toFixed(3)}`
}

/** Nøkkel for naturtype-oppslag på samme ~100 m-grid. */
export function naturtypePointKey(lat, lon) {
  return `naturtype:pt:${lat.toFixed(3)},${lon.toFixed(3)}`
}

/** Nøkkel for nærmeste sted (geosearch + navne-søk + SNL) på ~100 m-grid.
 *  v3-navnerom: gamle treff mangler `source` og prøvde aldri SNL. */
export function placePointKey(lat, lon) {
  return `wikiplace3:pt:${lat.toFixed(3)},${lon.toFixed(3)}`
}

/** Nøkkel for kulturminne-bbox-henting (kvantisert til ~3 desimaler ≈ 100 m). */
export function kulturminneBboxKey(bbox) {
  const q = (v) => Number(v).toFixed(3)
  return `kulturminne:bbox:${q(bbox.south)},${q(bbox.west)},${q(bbox.north)},${q(bbox.east)}`
}

/** Nøkkel for kulturminne-detalj pr UUID (til detalj-skuffens lazy-henting). */
export function kulturminneIdKey(id) {
  return `kulturminne:id:${id}`
}
