// IndexedDB-wrapper for lagring av brukerens egne turkart.
// En "MapEntry" = { id, navn, bbox, svg, opprettet }
// id = stable hash av "{lat}_{lon}_{halfKm}_{timestamp}"
//
// v12.0.17: eget lett 'meta'-store ved siden av 'maps'. listMaps() leste
// tidligere ALLE records med getAll() og deserialiserte hver multi-MB
// SVG-streng bare for å strippe den i JS — hjemskjermen betalte full pris
// for alle kartene. 'meta' holder kun projeksjonen (uten svg/dem/annotations/
// tracks) og er derivert/gjenoppbyggbart: 'maps' forblir source of truth,
// og listMaps() backfiller lazy hvis meta mangler entries (første last etter
// oppgradering).

const DB_NAME = 'svg-insights-maps'
const STORE = 'maps'
const META_STORE = 'meta'
const GRAVEL_STORE = 'gravelRoutes'   // Ruteplanleggerens lagrede grusruter (v3)
const VERSION = 3

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
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(GRAVEL_STORE)) {
        const gs = db.createObjectStore(GRAVEL_STORE, { keyPath: 'id' })
        gs.createIndex('opprettet', 'opprettet')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(mode = 'readonly', stores = STORE) {
  return open().then(db => db.transaction(stores, mode))
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

/**
 * Lett liste-projeksjon av en full MapEntry: alt UNNTATT de tunge/voksende
 * feltene (svg, dem, annotations, tracks, trackStyle). `sizeBytes` beregnes
 * her (svg-lengde ≈ byte for ASCII, lett underestimat ved æ/ø/å — godt nok
 * for visning).
 */
export function projectMetaEntry(entry) {
  const { svg, dem, annotations, tracks, trackStyle, ...rest } = entry
  return {
    ...rest,
    hasDem: !!dem,
    sizeBytes: (svg?.length ?? 0) + (dem?.buffer?.byteLength ?? 0),
  }
}

export async function saveMap(entry) {
  const t = await tx('readwrite', [STORE, META_STORE])
  t.objectStore(STORE).put(entry)
  t.objectStore(META_STORE).put(projectMetaEntry(entry))
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
  return entry
}

export async function loadMap(id) {
  const t = await tx()
  const result = await asPromise(t.objectStore(STORE).get(id))
  return result ?? null
}

/**
 * Liste alle kart med metadata, men UTEN svg- og dem-feltene. Leses fra det
 * lette 'meta'-storet; hvis det mangler entries (første last etter DB-
 * oppgradering, eller en avbrutt skriving) backfilles det fra 'maps' én gang.
 * Sortert nyeste først.
 */
export async function listMaps() {
  const t = await tx('readonly', [STORE, META_STORE])
  const [metaCount, mapsCount] = await Promise.all([
    asPromise(t.objectStore(META_STORE).count()),
    asPromise(t.objectStore(STORE).count()),
  ])
  if (metaCount >= mapsCount) {
    const metas = await asPromise(t.objectStore(META_STORE).getAll())
    return metas.sort((a, b) => b.opprettet - a.opprettet)
  }
  // Backfill: engangs full lesing (samme kost som gammel listMaps hadde hver gang)
  const all = await asPromise(t.objectStore(STORE).getAll())
  const projected = all.map(projectMetaEntry)
  const wt = await tx('readwrite', META_STORE)
  const ws = wt.objectStore(META_STORE)
  for (const p of projected) ws.put(p)
  return projected.sort((a, b) => b.opprettet - a.opprettet)
}

export async function deleteMap(id) {
  const t = await tx('readwrite', [STORE, META_STORE])
  t.objectStore(STORE).delete(id)
  t.objectStore(META_STORE).delete(id)
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export async function clearAll() {
  const t = await tx('readwrite', [STORE, META_STORE])
  t.objectStore(STORE).clear()
  t.objectStore(META_STORE).clear()
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

// ---------- Ruteplanleggerens lagrede grusruter (gravelRoutes, v3) ----------
// Record: { id, navn, opprettet, waypoints: [{lat,lon,name}], points:
// [[lon,lat,ele]…] (DP-forenklet), segments|null, lengthM, gravelShare|null,
// profileVersion }. Små records (typisk < 100 kB) → ingen meta-projeksjon,
// listGravelRoutes leser alt.

export function generateGravelRouteId() {
  return 'grus_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export async function saveGravelRoute(route) {
  const t = await tx('readwrite', GRAVEL_STORE)
  t.objectStore(GRAVEL_STORE).put(route)
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
  return route
}

export async function listGravelRoutes() {
  const t = await tx('readonly', GRAVEL_STORE)
  const all = await asPromise(t.objectStore(GRAVEL_STORE).getAll())
  return all.sort((a, b) => b.opprettet - a.opprettet)
}

export async function loadGravelRoute(id) {
  const t = await tx('readonly', GRAVEL_STORE)
  return (await asPromise(t.objectStore(GRAVEL_STORE).get(id))) ?? null
}

// Delvis oppdatering av en lagret rute (v12.1.26 — stjernemerking). Leser og
// skriver i SAMME readwrite-transaksjon så to raske patch-kall ikke kan
// overskrive hverandre.
export async function updateGravelRoute(id, patch) {
  const t = await tx('readwrite', GRAVEL_STORE)
  const store = t.objectStore(GRAVEL_STORE)
  const rec = await asPromise(store.get(id))
  if (!rec) return null
  const next = { ...rec, ...patch }
  store.put(next)
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
  return next
}

export async function deleteGravelRoute(id) {
  const t = await tx('readwrite', GRAVEL_STORE)
  t.objectStore(GRAVEL_STORE).delete(id)
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}
