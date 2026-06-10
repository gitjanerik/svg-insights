// Bygg den norske rødliste-bundelen → app/public/data/redlist-no.json.
//
// KILDE: tools/redlist-2021.csv — Artsdatabankens offisielle eksport av Norsk
// rødliste for arter 2021 (autoritativ, alle artsgrupper). Gjeldende utgave:
// rødlista revideres hvert 6. år, så 2021 er ikke utdatert.
//
// Runtime (redListNo.js) snitter bundelen mot GBIF-backbone speciesKeys som
// occurrence-faceten returnerer. Artsdatabanken bruker egne taxon-id-er, så det
// eneste vi trenger GBIF til er å oversette artsnavn → backbone speciesKey
// (/species/match). Det skjer her ved bygg (CI), ikke ved klikk.
//
// Resultat: { gbif-backbone-speciesKey: "CR"|"EN"|"VU"|"NT" }.
//
// OPPDATERING TIL NESTE UTGAVE (f.eks. 2027): erstatt tools/redlist-2021.csv med
// den nye Artsdatabanken-eksporten (samme kolonner) — workflowen bygger om
// bundelen automatisk. tools/fetch_redlist_2021.py dokumenterer API-veien hvis
// man heller vil hente direkte fra Artsdatabanken.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const GBIF = process.env.GBIF_API_URL ?? 'https://api.gbif.org/v1'
const KEEP = new Set(['CR', 'EN', 'VU', 'NT']) // truet + nær truet (ikke RE/DD/LC)
const SEVERITY = { CR: 4, EN: 3, VU: 2, NT: 1 }
const CONCURRENCY = 10

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = process.env.REDLIST_CSV ?? resolve(__dirname, '../../tools/redlist-2021.csv')
const OUT = resolve(__dirname, '../public/data/redlist-no.json')

// Minimal RFC4180-CSV-parser (håndterer "..."-felt med komma/linjeskift/"").
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* hopp */ }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

// «VU°» (nedgradert pga naboland-effekt) → «VU». Sluttkategorien er den samme.
const normCat = (c) => String(c || '').replace(/°/g, '').trim().toUpperCase()

async function matchSpeciesKey(name) {
  const url = `${GBIF}/species/match?strict=false&name=${encodeURIComponent(name)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`GBIF match ${res.status}`)
  const m = await res.json()
  if (!m || m.matchType === 'NONE') return null
  const key = Number(m.speciesKey ?? m.usageKey)
  return Number.isFinite(key) ? key : null
}

async function mapLimit(items, limit, fn) {
  let i = 0
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++
      try { await fn(items[idx]) } catch { /* hopp over enkeltfeil */ }
    }
  }))
}

function build() {
  const rows = parseCsv(readFileSync(SRC, 'utf-8'))
  const header = rows[0].map((h) => h.trim())
  const col = (name) => header.indexOf(name)
  const ci = { name: col('scientificName'), cat: col('redListCategory'), area: col('assessmentArea') }
  if (ci.name < 0 || ci.cat < 0) throw new Error(`Mangler kolonner i ${SRC} (header: ${header})`)

  // Unike artsnavn (Norge) med høyeste rødliste-kategori.
  const nameToCat = new Map()
  for (const r of rows.slice(1)) {
    if (ci.area >= 0 && r[ci.area] !== 'Norge') continue
    const cat = normCat(r[ci.cat])
    if (!KEEP.has(cat)) continue
    const name = (r[ci.name] || '').trim()
    if (!name) continue
    const prev = nameToCat.get(name)
    if (!prev || SEVERITY[cat] > SEVERITY[prev]) nameToCat.set(name, cat)
  }
  console.log(`Rødlistede arter (Norge, CR/EN/VU/NT) i kilden: ${nameToCat.size}`)
  return nameToCat
}

async function main() {
  const nameToCat = build()
  const names = [...nameToCat.keys()]
  const lookup = {}
  let matched = 0, nomatch = 0
  const setKey = (key, cat) => {
    const prev = lookup[key]
    if (!prev || SEVERITY[cat] > SEVERITY[prev]) lookup[key] = cat
  }
  await mapLimit(names, CONCURRENCY, async (name) => {
    const key = await matchSpeciesKey(name)
    if (key == null) { nomatch++; return }
    matched++
    setKey(key, nameToCat.get(name))
  })

  const byCat = { CR: 0, EN: 0, VU: 0, NT: 0 }
  for (const c of Object.values(lookup)) byCat[c]++
  console.log(`GBIF-match: ${matched} treff, ${nomatch} uten treff.`)
  console.log(`Unike GBIF-nøkler i bundelen: ${Object.keys(lookup).length}`)
  console.log(`  CR ${byCat.CR}  EN ${byCat.EN}  VU ${byCat.VU}  NT ${byCat.NT}`)

  if (Object.keys(lookup).length === 0) {
    throw new Error('Ingen arter matchet — avbryter (ikke skriv tom bundle).')
  }

  const sorted = {}
  for (const k of Object.keys(lookup).sort((a, b) => Number(a) - Number(b))) sorted[k] = lookup[k]
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(sorted))
  console.log(`Skrev ${OUT} (${(JSON.stringify(sorted).length / 1024).toFixed(1)} KB).`)
}

main().catch((e) => { console.error(e); process.exit(1) })
