// Bygg den norske rødliste-bundelen fra GBIF → app/public/data/redlist-no.json.
//
// Kjøres i CI (full nett-tilgang), ikke i klient/sandkasse. Resultatet er et
// flatt oppslag { gbif-backbone-speciesKey: "CR"|"EN"|"VU"|"NT" } som runtime
// (redListNo.js) snitter mot artene GBIF returnerer for et verneområde-polygon.
//
// Hvorfor GBIF og ikke GBIFs globale IUCN-filter: den norske rødlista er en egen
// nasjonal ekspert-vurdering, publisert som GBIF-checklist. Hver name-usage har
// en backbone-nøkkel (`nubKey`, samme nøkkel som occurrence-faceten bruker) +
// threat status fra den NORSKE vurderingen.
//
// Datasett: env REDLIST_DATASET_KEY, ellers den KOMPLETTE norske rødlista 2015
// (alle artsgrupper). En komplett liste er viktigere for en «rødlistet?»-
// indikator enn en nyere, men delvis liste (GBIF har kun en planter-kun 2021-
// delmengde + den komplette 2015-lista). Kategorien er uendret 2015→2021 for de
// fleste arter. Bytt via env hvis en komplett 2021-checklist dukker opp.
//
// Threat status / backbone-nøkkel ligger ikke alltid inline i listings-svaret;
// da beriker vi pr art via detalj-endepunktet (/species/{key}).

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const GBIF = process.env.GBIF_API_URL ?? 'https://api.gbif.org/v1'
const DATASET = process.env.REDLIST_DATASET_KEY ?? '4f1047ac-a19d-41a8-98eb-d968b2548b53' // Norsk rødliste 2015 (komplett)
const KEEP = { CRITICALLY_ENDANGERED: 'CR', ENDANGERED: 'EN', VULNERABLE: 'VU', NEAR_THREATENED: 'NT' }
const SEVERITY = { CR: 4, EN: 3, VU: 2, NT: 1 }
const CONCURRENCY = 10

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../public/data/redlist-no.json')

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`GBIF ${res.status} for ${url}`)
  return res.json()
}

function categoryOf(statuses) {
  if (!Array.isArray(statuses)) return null
  for (const s of statuses) if (KEEP[s]) return KEEP[s]
  return null
}

async function mapLimit(items, limit, fn) {
  let i = 0
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++
      try { await fn(items[idx]) } catch { /* hopp over enkeltfeil */ }
    }
  })
  await Promise.all(workers)
}

async function build() {
  console.log(`Datasett: ${DATASET}`)
  const lookup = {}
  const setCat = (nubKey, cat) => {
    const k = Number(nubKey)
    if (!Number.isFinite(k) || !cat) return
    const prev = lookup[k]
    if (!prev || SEVERITY[cat] > SEVERITY[prev]) lookup[k] = cat
  }

  // 1) Paginér name-usages. Listings-svaret har `nubKey` (backbone-nøkkel) men
  //    verken `rank` eller `threatStatuses` — så vi samler hver AKSEPTERT usage
  //    med en nubKey og henter threat status pr art i steg 2.
  const candidates = []
  let offset = 0
  let total = 0
  let firstLogged = false
  while (true) {
    const page = await getJson(`${GBIF}/species?datasetKey=${DATASET}&limit=1000&offset=${offset}`)
    const results = page?.results ?? []
    if (!firstLogged && results[0]) {
      console.log('Eksempel-usage (felt):', Object.keys(results[0]).join(', '))
      firstLogged = true
    }
    for (const u of results) {
      total++
      const nubKey = Number(u.nubKey)
      if (!Number.isFinite(nubKey)) continue
      if (u.taxonomicStatus && u.taxonomicStatus !== 'ACCEPTED') continue
      candidates.push({ key: u.key, nubKey })
    }
    if (page?.endOfRecords) break
    offset += 1000
  }
  console.log(`Name-usages: ${total}. Aksepterte med nubKey: ${candidates.length}.`)

  // 2) Berik threat status pr art via detalj-endepunktet (threatStatuses),
  //    med distributions-extensionen som siste utvei. Logg formen på første art.
  let diag = false
  await mapLimit(candidates, CONCURRENCY, async ({ key, nubKey }) => {
    const u = await getJson(`${GBIF}/species/${key}`)
    let cat = categoryOf(u.threatStatuses)
    let distFirst = null
    if (!cat) {
      const dist = await getJson(`${GBIF}/species/${key}/distributions`).catch(() => null)
      distFirst = (dist?.results ?? [])[0] ?? null
      cat = categoryOf((dist?.results ?? []).map((d) => d.threatStatus))
    }
    if (!diag) {
      diag = true
      console.log('Detalj-felt:', Object.keys(u).join(', '))
      console.log('threatStatuses:', JSON.stringify(u.threatStatuses ?? null))
      console.log('distributions[0]:', JSON.stringify(distFirst).slice(0, 300))
    }
    if (cat) setCat(nubKey, cat)
  })

  const byCat = { CR: 0, EN: 0, VU: 0, NT: 0 }
  for (const c of Object.values(lookup)) byCat[c]++
  console.log(`Rødlistede arter (med GBIF-nøkkel): ${Object.keys(lookup).length}`)
  console.log(`  CR ${byCat.CR}  EN ${byCat.EN}  VU ${byCat.VU}  NT ${byCat.NT}`)

  if (Object.keys(lookup).length === 0) {
    throw new Error('Ingen rødlistede arter funnet — avbryter (ikke skriv tom bundle).')
  }

  const sorted = {}
  for (const k of Object.keys(lookup).sort((a, b) => Number(a) - Number(b))) sorted[k] = lookup[k]
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(sorted))
  console.log(`Skrev ${OUT} (${(JSON.stringify(sorted).length / 1024).toFixed(1)} KB).`)
}

build().catch((e) => { console.error(e); process.exit(1) })
