// Delings-tokens for grusruter (v12.1.26 — «Del mine ruter»). Én rute = ett
// `r`-query-param med verdien `alat|alon|blat|blon|proposalId|navn`, og en
// delings-URL kan bære inntil MAX_SHARE_ROUTES slike params. Pipe er valgt
// som skilletegn fordi komma er vanlig i navn («Punkt 59.2, 9.3»); pipe i
// navn erstattes med «/» ved bygging. Mottaker-parsing er tolerant: ugyldige
// tokens gir null og filtreres bort.
//
// Maks 5 pr lenke (v12.1.27, var 10): mottaker-banneret skal være kompakt,
// og rutene beregnes uansett én og én hos mottakeren.

export const MAX_SHARE_ROUTES = 5
export const SHARE_NAME_MAX = 60

/** Lagret rute-record → token, eller null når waypoints mangler. */
export function routeShareToken(rec) {
  const a = rec?.waypoints?.[0]
  const b = rec?.waypoints?.at(-1)
  if (!a || !b || ![a.lat, a.lon, b.lat, b.lon].every(Number.isFinite)) return null
  const navn = String(rec.navn ?? '').replace(/\|/g, '/').trim().slice(0, SHARE_NAME_MAX)
  return [
    a.lat.toFixed(6), a.lon.toFixed(6),
    b.lat.toFixed(6), b.lon.toFixed(6),
    rec.proposalId ?? '', navn,
  ].join('|')
}

/** Token → invite-rute { a, b, navn, proposalId }, eller null ved ugyldig. */
export function parseRouteToken(raw) {
  const parts = String(raw ?? '').split('|')
  const [alat, alon, blat, blon] = parts.slice(0, 4).map(parseFloat)
  if (![alat, alon, blat, blon].every(Number.isFinite)) return null
  const navn = parts[5] ? String(parts[5]).trim().slice(0, SHARE_NAME_MAX) : null
  return {
    a: { lat: alat, lon: alon, name: 'Delt start' },
    b: { lat: blat, lon: blon, name: 'Delt mål' },
    proposalId: parts[4] ? String(parts[4]) : null,
    navn: navn || null,
  }
}
