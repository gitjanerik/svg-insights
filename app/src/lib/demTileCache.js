// demTileCache.js — flis-basert DEM-cache for å gjenbruke høydedata mellom
// overlappende kart (auto-kart forskyver senteret ~37,5 %, så påfølgende kart
// overlapper ~62 %).
//
// STATUS: AV som default (se DEM_TILE_CACHE_ENABLED i createMapFlow.js). Slås
// på etter verifisering av kontur-justering på ekte enhet, siden sandkassen
// ikke har WCS-tilgang. De rene funksjonene (snap/dekning/montering/slicing)
// er enhetstestet i demTileCache.test.js.
//
// DESIGN:
//  - Fliser ligger på et globalt UTM32-rutenett (TILE_M, multiplum av res), så
//    celler fra ulike kart flukter EKSAKT. Kart-bbox snappes til res-rutenettet
//    i createMapFlow (utvider ≤ 1 celle) så ingen resampling trengs — ren kopi.
//  - For å unngå request-eksplosjon (100 fliser = 100 WCS-kall) henter vi IKKE
//    pr flis. I stedet finner vi bounding-box-en av de MANGLENDE flisene og
//    henter den som ÉN WCS-forespørsel (≤ 1 nettverkskall pr kart-bygg, akkurat
//    som før for kalde kart), skjærer den i fliser og cacher dem.
//  - Robust fallback: feiler noe (syntetisk DEM, montering), faller vi tilbake
//    til én full fetchDEM for den snappede extent-en → aldri verre enn før.
//
// DEM-objekt: { data:Float32Array, cols, rows, transform:{originX:0,originY:0,
//   pixelWidth,pixelHeight}, noData, resolution }. transform.originX/Y = 0 →
//   lokalt meter-rom; rad 0 = NORD-kanten (GeoTIFF top-left).

import { fetchDEM } from './demFetcher.js'

export const TILE_M = 1000      // flis-størrelse (meter) — multiplum av 5/10/20
const DB_NAME = 'svg-insights-dem-tiles'
const STORE = 'tiles'
const MAX_TILES = 1000          // LRU-tak ( rydd eldste når overskredet )
const NO_DATA = -9999

// ── Rene geometri-funksjoner (enhetstestet) ──────────────────────────────

// Snap utmBbox UT til res-rutenettet (minE/minN ned, maxE/maxN opp). Resultat-
// kantene blir multipla av res, så kart-grid og flis-grid flukter eksakt.
export function snapUtmBboxToGrid(utmBbox, res) {
  return {
    minE: Math.floor(utmBbox.minE / res) * res,
    minN: Math.floor(utmBbox.minN / res) * res,
    maxE: Math.ceil(utmBbox.maxE / res) * res,
    maxN: Math.ceil(utmBbox.maxN / res) * res,
  }
}

// Fliser som dekker en (snappet) bbox. Hver flis: {col,row,minE,minN,maxE,maxN}.
export function tilesCovering(bbox, tileM = TILE_M) {
  const c0 = Math.floor(bbox.minE / tileM)
  const c1 = Math.floor((bbox.maxE - 1e-6) / tileM)
  const r0 = Math.floor(bbox.minN / tileM)
  const r1 = Math.floor((bbox.maxN - 1e-6) / tileM)
  const list = []
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      list.push({
        col: c, row: r,
        minE: c * tileM, minN: r * tileM,
        maxE: (c + 1) * tileM, maxN: (r + 1) * tileM,
      })
    }
  }
  return list
}

// Bounding-box (flis-justert) av en liste fliser.
export function boundingBoxOfTiles(tiles) {
  let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity
  for (const t of tiles) {
    if (t.minE < minE) minE = t.minE
    if (t.minN < minN) minN = t.minN
    if (t.maxE > maxE) maxE = t.maxE
    if (t.maxN > maxN) maxN = t.maxN
  }
  return { minE, minN, maxE, maxN }
}

// Kopier celler fra en kilde-grid inn i en mål-grid. Begge i res-justert rom,
// rad 0 = nord. Eksakt heltall-offset (ingen resampling).
// grid: { minE, maxN, res, cols, rows, data }
export function copyGridInto(target, src) {
  const res = target.res
  for (let sr = 0; sr < src.rows; sr++) {
    const worldN = src.maxN - (sr + 0.5) * res
    const tr = Math.round((target.maxN - worldN) / res - 0.5)
    if (tr < 0 || tr >= target.rows) continue
    for (let sc = 0; sc < src.cols; sc++) {
      const worldE = src.minE + (sc + 0.5) * res
      const tc = Math.round((worldE - target.minE) / res - 0.5)
      if (tc < 0 || tc >= target.cols) continue
      target.data[tr * target.cols + tc] = src.data[sr * src.cols + sc]
    }
  }
}

// Monter en DEM (lokalt origin, snappet extent) fra et sett kilde-grids.
export function assembleDem(sources, snapped, res, noData = NO_DATA) {
  const cols = Math.round((snapped.maxE - snapped.minE) / res)
  const rows = Math.round((snapped.maxN - snapped.minN) / res)
  const data = new Float32Array(cols * rows).fill(noData)
  const target = { minE: snapped.minE, maxN: snapped.maxN, res, cols, rows, data }
  for (const src of sources) copyGridInto(target, src)
  return {
    data, cols, rows,
    transform: { originX: 0, originY: 0, pixelWidth: res, pixelHeight: res },
    noData,
    resolution: res,
  }
}

// Skjær en hentet region (flis-justert bbox) i fliser for caching.
export function sliceIntoTiles(region, mb, res, tileM = TILE_M) {
  const tcols = Math.round(tileM / res)
  const out = []
  for (const t of tilesCovering(mb, tileM)) {
    const data = new Float32Array(tcols * tcols).fill(NO_DATA)
    copyGridInto(
      { minE: t.minE, maxN: t.maxN, res, cols: tcols, rows: tcols, data },
      { minE: mb.minE, maxN: mb.maxN, res, cols: region.cols, rows: region.rows, data: region.data },
    )
    out.push({ res, col: t.col, row: t.row, minE: t.minE, minN: t.minN, cols: tcols, rows: tcols, data })
  }
  return out
}

// ── IndexedDB-flis-store ──────────────────────────────────────────────────

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('ingen indexedDB')); return }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('ts', 'ts')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const tileKey = (res, col, row) => `${res}/${col}/${row}`

async function readTiles(res, tiles) {
  const found = new Map()
  let db
  try { db = await openDb() } catch { return found }
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    let pending = tiles.length
    if (!pending) { resolve(); return }
    for (const t of tiles) {
      const r = store.get(tileKey(res, t.col, t.row))
      r.onsuccess = () => {
        const v = r.result
        const tcols = Math.round(TILE_M / res)
        if (v && v.cols === tcols && v.rows === tcols && v.buf) {
          found.set(tileKey(res, t.col, t.row), {
            minE: v.minE, minN: v.minN, maxN: v.minN + tcols * res,
            res, cols: v.cols, rows: v.rows, data: new Float32Array(v.buf),
          })
        }
        if (--pending === 0) resolve()
      }
      r.onerror = () => { if (--pending === 0) resolve() }
    }
    tx.onerror = () => resolve()
  })
  db.close()
  return found
}

async function writeTiles(tilesWithData) {
  let db
  try { db = await openDb() } catch { return }
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const now = Date.now()
    for (const t of tilesWithData) {
      store.put({
        key: tileKey(t.res, t.col, t.row),
        res: t.res, col: t.col, row: t.row,
        minE: t.minE, minN: t.minN, cols: t.cols, rows: t.rows,
        buf: t.data.buffer, ts: now,
      })
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  await evictIfNeeded(db).catch(() => {})
  db.close()
}

async function evictIfNeeded(db) {
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const countReq = store.count()
    countReq.onsuccess = () => {
      const over = countReq.result - MAX_TILES
      if (over <= 0) { resolve(); return }
      let removed = 0
      const cur = store.index('ts').openCursor()   // eldste først
      cur.onsuccess = () => {
        const c = cur.result
        if (!c || removed >= over) { resolve(); return }
        c.delete()
        removed++
        c.continue()
      }
      cur.onerror = () => resolve()
    }
    countReq.onerror = () => resolve()
  })
}

// ── Orkestrering ──────────────────────────────────────────────────────────

/**
 * Hent DEM for en ALLEREDE SNAPPET utmBbox via flis-cachen. Henter kun den
 * manglende regionen (≤ 1 WCS-kall), cacher nye fliser, monterer eksakt.
 * Faller alltid tilbake til én full fetchDEM ved feil (aldri verre enn før).
 */
export async function fetchDEMWithCache(snappedUtmBbox, { resolutionM, signal } = {}) {
  const res = resolutionM
  try {
    const tiles = tilesCovering(snappedUtmBbox, TILE_M)
    const cached = await readTiles(res, tiles)
    const sources = []
    const missing = []
    for (const t of tiles) {
      const hit = cached.get(tileKey(res, t.col, t.row))
      if (hit) sources.push(hit)
      else missing.push(t)
    }
    if (missing.length) {
      const mb = boundingBoxOfTiles(missing)
      const region = await fetchDEM(null, mb, { resolutionM: res, useReal: true, signal })
      if (!region || (region.source && region.source.startsWith('synthetic'))) {
        throw new Error('region ble syntetisk')
      }
      const expectedCols = Math.round((mb.maxE - mb.minE) / res)
      const expectedRows = Math.round((mb.maxN - mb.minN) / res)
      if (region.cols !== expectedCols || region.rows !== expectedRows) {
        throw new Error(`region-dims ${region.cols}×${region.rows} ≠ ${expectedCols}×${expectedRows}`)
      }
      sources.push({ minE: mb.minE, maxN: mb.maxN, res, cols: region.cols, rows: region.rows, data: region.data })
      // Cache nye fliser i bakgrunnen — ikke blokker resultatet.
      writeTiles(sliceIntoTiles(region, mb, res, TILE_M)).catch(() => {})
    }
    const dem = assembleDem(sources, snappedUtmBbox, res)
    return { ...dem, source: missing.length ? 'WCS (flis-cache)' : 'flis-cache' }
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn(`[DEM-cache] fallback til full fetch: ${e?.message ?? e}`)
    return fetchDEM(null, snappedUtmBbox, { resolutionM: res, useReal: true, signal })
  }
}
