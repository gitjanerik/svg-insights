// Bygg den norske rødliste-bundelen fra GBIF → app/public/data/redlist-no.json.
//
// Kjøres i CI (full nett-tilgang), ikke i klient/sandkasse. Resultatet er et
// flatt oppslag { gbif-backbone-speciesKey: "CR"|"EN"|"VU"|"NT" } som runtime
// (redListNo.js) snitter mot artene GBIF returnerer for et verneområde-polygon.
//
// Hvorfor GBIF og ikke GBIFs globale IUCN-filter: den norske rødlista er en egen
// nasjonal ekspert-vurdering, publisert som en GBIF-checklist. Hver name-usage i
// checklisten har `nubKey` = GBIF-backbone speciesKey (samme nøkkel som
// occurrence-faceten bruker) + threat status fra den NORSKE vurderingen.
//
// Datasett: settes via env REDLIST_DATASET_KEY, ellers oppdages nyeste «Norwegian
// Red List»-checklist automatisk (logges). Fallback: 2015-utgaven (bekreftet).

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const GBIF = process.env.GBIF_API_URL ?? 'https://api.gbif.org/v1'
const FALLBACK_2015 = '4f1047ac-a19d-41a8-98eb-d968b2548b53'
const KEEP = { CRITICALLY_ENDANGERED: 'CR', ENDANGERED: 'EN', VULNERABLE: 'VU', NEAR_THREATENED: 'NT' }
const SEVERITY = { CR: 4, EN: 3, VU: 2, NT: 1 }

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../public/data/redlist-no.json')

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`GBIF ${res.status} for ${url}`)
  return res.json()
}

// Finn nyeste «Norwegian Red List»-checklist. Logger alle kandidater.
async function discoverDatasetKey() {
  if (process.env.REDLIST_DATASET_KEY) {
    console.log(`Bruker REDLIST_DATASET_KEY=${process.env.REDLIST_DATASET_KEY}`)
    return process.env.REDLIST_DATASET_KEY
  }
  try {
    const data = await getJson(`${GBIF}/dataset/search?q=Norwegian%20Red%20List&type=CHECKLIST&limit=30`)
    const cand = (data?.results ?? [])
      .filter((d) => /red ?list/i.test(d.title ?? ''))
      .map((d) => ({ key: d.key, title: d.title, created: d.created ?? '' }))
    console.log('Rødliste-checklist-kandidater:')
    for (const c of cand) console.log(`  ${c.key}  ${c.created?.slice(0, 10) ?? ''}  ${c.title}`)
    const y2021 = cand.find((c) => /2021/.test(c.title))
    const picked = y2021 ?? cand.sort((a, b) => String(b.created).localeCompare(String(a.created)))[0]
    if (picked) { console.log(`Valgt: ${picked.key} — ${picked.title}`); return picked.key }
  } catch (e) {
    console.warn(`Datasett-søk feilet: ${e.message}`)
  }
  console.log(`Faller tilbake til 2015-utgaven: ${FALLBACK_2015}`)
  return FALLBACK_2015
}

function categoryOf(statuses) {
  if (!Array.isArray(statuses)) return null
  for (const s of statuses) if (KEEP[s]) return KEEP[s]
  return null
}

// Concurrency-begrenset map for distributions-fallback.
async function mapLimit(items, limit, fn) {
  const out = []
  let i = 0
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx]).catch(() => null)
    }
  })
  await Promise.all(workers)
  return out
}

async function build() {
  const datasetKey = await discoverDatasetKey()
  const lookup = {}
  const setCat = (nubKey, cat) => {
    if (!Number.isFinite(nubKey) || !cat) return
    const prev = lookup[nubKey]
    if (!prev || SEVERITY[cat] > SEVERITY[prev]) lookup[nubKey] = cat
  }

  let offset = 0
  let total = 0
  const noInline = [] // { usageKey, nubKey } uten inline threatStatus
  while (true) {
    const page = await getJson(`${GBIF}/species?datasetKey=${datasetKey}&limit=1000&offset=${offset}`)
    const results = page?.results ?? []
    for (const u of results) {
      total++
      const rank = u.rank
      if (rank !== 'SPECIES' && rank !== 'SUBSPECIES') continue
      const nubKey = Number(u.nubKey)
      if (!Number.isFinite(nubKey)) continue
      const cat = categoryOf(u.threatStatuses)
      if (cat) setCat(nubKey, cat)
      else noInline.push({ usageKey: u.key, nubKey })
    }
    if (page?.endOfRecords) break
    offset += 1000
  }
  console.log(`Name-usages: ${total}. Inline-kategorier funnet: ${Object.keys(lookup).length}.`)

  // Fallback: hvis inline-dekningen er lav, hent threat status fra distributions.
  if (Object.keys(lookup).length < 100 && noInline.length) {
    console.log(`Lav inline-dekning → henter distributions for ${noInline.length} arter …`)
    await mapLimit(noInline, 8, async ({ usageKey, nubKey }) => {
      const dist = await getJson(`${GBIF}/species/${usageKey}/distributions`)
      const cat = categoryOf((dist?.results ?? []).map((d) => d.threatStatus))
      if (cat) setCat(nubKey, cat)
    })
  }

  const byCat = { CR: 0, EN: 0, VU: 0, NT: 0 }
  for (const c of Object.values(lookup)) byCat[c]++
  console.log(`Rødlistede arter (med GBIF-nøkkel): ${Object.keys(lookup).length}`)
  console.log(`  CR ${byCat.CR}  EN ${byCat.EN}  VU ${byCat.VU}  NT ${byCat.NT}`)

  if (Object.keys(lookup).length === 0) {
    throw new Error('Ingen rødlistede arter funnet — avbryter (ikke skriv tom bundle).')
  }

  // Sortér nøklene for stabil diff.
  const sorted = {}
  for (const k of Object.keys(lookup).sort((a, b) => Number(a) - Number(b))) sorted[k] = lookup[k]
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(sorted))
  console.log(`Skrev ${OUT} (${(JSON.stringify(sorted).length / 1024).toFixed(1)} KB).`)
}

build().catch((e) => { console.error(e); process.exit(1) })
