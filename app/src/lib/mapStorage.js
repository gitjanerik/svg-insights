// IndexedDB-wrapper for lagring av brukerens egne turkart.
// En "MapEntry" = { id, navn, bbox, svg, opprettet }
// id = stable hash av "{lat}_{lon}_{halfKm}_{timestamp}"

const DB_NAME = 'svg-insights-maps'
const STORE = 'maps'
const VERSION = 1

let dbPromise = null

function open() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('opprettet', 'opprettet')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(mode = 'readonly') {
  return open().then(db => db.transaction(STORE, mode).objectStore(STORE))
}

function asPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function generateMapId() {
  return 'kart_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export async function saveMap(entry) {
  const store = await tx('readwrite')
  await asPromise(store.put(entry))
  return entry
}

export async function loadMap(id) {
  const store = await tx()
  const result = await asPromise(store.get(id))
  return result ?? null
}

/**
 * Liste alle kart med metadata, men UTEN svg- og dem-feltene (kan være store —
 * dem er ~160 KB ArrayBuffer per kart).
 * Sortert nyeste først.
 */
export async function listMaps() {
  const store = await tx()
  const all = await asPromise(store.getAll())
  return all
    .map(({ svg, dem, ...rest }) => ({ ...rest, hasDem: !!dem }))
    .sort((a, b) => b.opprettet - a.opprettet)
}

export async function deleteMap(id) {
  const store = await tx('readwrite')
  await asPromise(store.delete(id))
}

export async function clearAll() {
  const store = await tx('readwrite')
  await asPromise(store.clear())
}
