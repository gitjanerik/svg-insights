import { ref, watch, onScopeDispose } from 'vue'
import { buildRouteProfile, sampleElevationsFromDem } from '../lib/routeElevation.js'
import { fetchDEM } from '../lib/demFetcher.js'
import { utm32BboxFromWgs84 } from '../lib/utm.js'

// Høydeprofil-tilstand for Ruteplanleggeren (v12.1.14). Ferske BRouter-ruter
// har høyde i geometrien ([lon, lat, ele]) → profil beregnes synkront uten
// nettverk. Lagrede ruter (DP-forenklet uten høyde) faller tilbake til
// Kartverket WCS DTM langs polylinjen — grov oppløsning holder for en profil,
// og syntetisk DEM avvises (falske høyder er verre enn ingen).

const DEM_MAX_DIM_PX = 400
const DEM_PAD_M = 250

function bboxOfPoints(points) {
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity
  for (const [lon, lat] of points) {
    if (lat < south) south = lat
    if (lat > north) north = lat
    if (lon < west) west = lon
    if (lon > east) east = lon
  }
  const padLat = DEM_PAD_M / 111111
  const padLon = padLat / Math.cos(((south + north) / 2) * Math.PI / 180)
  return { south: south - padLat, west: west - padLon, north: north + padLat, east: east + padLon }
}

function utmContains(outer, inner) {
  return outer.minE <= inner.minE && outer.minN <= inner.minN &&
         outer.maxE >= inner.maxE && outer.maxN >= inner.maxN
}

export function useRouteElevation(route) {
  const profile = ref(null)
  const state = ref('idle')     // 'idle' | 'loading' | 'ready' | 'unavailable'
  const source = ref(null)      // 'rute' (BRouter-geometri) | 'dem' | null
  let abort = null
  // Én-slots DEM-cache: bytte mellom forslag/ruter i samme område skal ikke
  // hente terrenget på nytt.
  let demCache = null           // { utmBbox, dem }

  async function refresh(r) {
    abort?.abort()
    abort = null
    if (!r?.points || r.points.length < 2) {
      profile.value = null; state.value = 'idle'; source.value = null
      return
    }
    const segments = r.segments ?? null
    const own = buildRouteProfile(r.points, { segments })
    if (own) {
      profile.value = own; state.value = 'ready'; source.value = 'rute'
      return
    }
    const ac = new AbortController()
    abort = ac
    profile.value = null; state.value = 'loading'; source.value = null
    try {
      const bbox = bboxOfPoints(r.points)
      const utmBbox = utm32BboxFromWgs84(bbox)
      let entry = demCache && utmContains(demCache.utmBbox, utmBbox) ? demCache : null
      if (!entry) {
        const spanM = Math.max(utmBbox.maxE - utmBbox.minE, utmBbox.maxN - utmBbox.minN)
        const resolutionM = Math.min(150, Math.max(20, Math.ceil(spanM / DEM_MAX_DIM_PX / 10) * 10))
        const dem = await fetchDEM(bbox, utmBbox, { resolutionM, useReal: true, signal: ac.signal })
        if (ac.signal.aborted) return
        if (String(dem.source ?? '').includes('synthetic')) {
          throw new Error('kun syntetisk DEM tilgjengelig — viser ikke falske høyder')
        }
        entry = { utmBbox, dem }
        demCache = entry
      }
      const withEle = sampleElevationsFromDem(r.points, entry.dem, entry.utmBbox)
      const prof = buildRouteProfile(withEle, { segments })
      if (ac.signal.aborted) return
      if (!prof) throw new Error('for få gyldige høyder langs ruta')
      profile.value = prof; state.value = 'ready'; source.value = 'dem'
    } catch (e) {
      if (ac.signal.aborted) return
      console.warn('[Ruteplanlegger] høydeprofil utilgjengelig:', e?.message ?? e)
      profile.value = null; state.value = 'unavailable'; source.value = null
    }
  }

  watch(route, (r) => { void refresh(r) }, { immediate: true })
  onScopeDispose(() => abort?.abort())

  return { profile, state, source }
}
