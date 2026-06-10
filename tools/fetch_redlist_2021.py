#!/usr/bin/env python3
"""
Last ned hele Norsk rødliste for arter 2021 (alle artsgrupper) fra
Artsdatabanken og eksportér til CSV.

Kilde-portal:   https://lister.artsdatabanken.no/rodlisteforarter/2021/
API-dok:        https://api.artsdatabanken.no/swagger/
Taksonomi:      https://nortaxa.artsdatabanken.no/swagger/

------------------------------------------------------------------------------
VIKTIG — finn det reelle API-endepunktet (ett minutt i nettleseren)
------------------------------------------------------------------------------
Rødliste-API-et bak 2021-portalen er ikke offentlig dokumentert med et stabilt,
verifiserbart endepunkt (og kunne ikke verifiseres fra byggemiljøet her).
Rekonstruer det slik:

  1. Åpne  https://lister.artsdatabanken.no/rodlisteforarter/2021/
  2. DevTools (F12) → fanen «Network» → filter «Fetch/XHR».
  3. Søk på en art, eller bla i resultatlista, slik at nye kall trigges.
  4. Finn XHR-kallet som returnerer JSON med arter + kategori (CR/EN/VU/…).
  5. Høyreklikk → «Copy» → «Copy URL» (eller «Copy as cURL»).
  6. Kjør:   python tools/fetch_redlist_2021.py --url "<den kopierte URL-en>"

Scriptet paginerer selv, mapper feltene fleksibelt, og skriver CSV. Stemmer ikke
felt-navnene, kjør med --dump-fields for å se råfeltene i første post og juster
FIELD_CANDIDATES nederst (eller send meg utskriften, så låser jeg dem).

Kjøring:
  python tools/fetch_redlist_2021.py --url "<API-URL>" [--out redlist_2021.csv]
  python tools/fetch_redlist_2021.py --url "<API-URL>" --dump-fields
  REDLIST_API_URL="<API-URL>" python tools/fetch_redlist_2021.py

Krav: Python 3.9+ og `requests` (pip install requests).
------------------------------------------------------------------------------
"""

import argparse
import csv
import json
import os
import sys
import time
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

import requests

# Kategorier vi tar med (alle, per oppgaven).
ALL_CATEGORIES = {"RE", "CR", "EN", "VU", "NT", "DD", "LC", "NA", "NE"}

# Fleksibel felt-mapping: CSV-kolonne → kandidat-feltnavn i API-responsen
# (sjekkes case-insensitivt; nøstede oppslag som "a.b" støttes).
FIELD_CANDIDATES = {
    "scientificName": ["scientificName", "vitenskapeligNavn", "vitenskapelignavn",
                        "navn", "taxonScientificName", "validScientificName", "name"],
    "vernacularName": ["vernacularName", "populaernavn", "populrnavn", "popularName",
                        "norwegianName", "preferredPopularName", "norskNavn"],
    "taxonId":        ["taxonId", "taksonId", "scientificNameId", "scientificNameID",
                        "taxonID", "id", "assessmentId", "vurderingId"],
    "redListCategory": ["redListCategory", "kategori", "category", "rodlistekategori",
                        "categoryCode", "kategori.kode", "category.code", "kode"],
    "assessmentYear": ["assessmentYear", "vurderingsaar", "aar", "year", "revisjon",
                        "assessmentPeriod"],
    "speciesGroup":   ["speciesGroup", "artsgruppe", "gruppe", "organismGroup",
                        "vurderingsomraade", "expertGroup", "ekspertgruppe"],
}
CSV_COLUMNS = list(FIELD_CANDIDATES.keys())

# Kandidat-nøkler for resultat-lista og totalantall i et paginert svar.
RESULT_KEYS = ["results", "Results", "data", "items", "Items", "content",
               "hits", "records", "value", "list"]
TOTAL_KEYS = ["total", "Total", "totalCount", "TotalCount", "count", "Count",
              "totalHits", "totalElements", "numberOfResults"]


def get_ci(record, dotted):
    """Hent et (mulig nøstet, case-insensitivt) felt fra en dict."""
    cur = record
    for part in dotted.split("."):
        if not isinstance(cur, dict):
            return None
        match = next((k for k in cur if k.lower() == part.lower()), None)
        if match is None:
            return None
        cur = cur[match]
    return cur


def extract(record):
    row = {}
    for col, candidates in FIELD_CANDIDATES.items():
        val = None
        for cand in candidates:
            val = get_ci(record, cand)
            if val not in (None, ""):
                break
        # Kategori kan være et objekt {kode/value/name}.
        if isinstance(val, dict):
            val = (get_ci(val, "code") or get_ci(val, "kode")
                   or get_ci(val, "value") or get_ci(val, "name"))
        row[col] = val
    if not row.get("assessmentYear"):
        row["assessmentYear"] = 2021
    return row


def find_results(payload):
    """Returner (results_list, total_or_None) fra et JSON-svar."""
    if isinstance(payload, list):
        return payload, None
    if isinstance(payload, dict):
        for k in RESULT_KEYS:
            if isinstance(payload.get(k), list):
                total = next((payload.get(tk) for tk in TOTAL_KEYS
                              if isinstance(payload.get(tk), int)), None)
                return payload[k], total
    return [], None


def set_query(url, **params):
    parts = urlparse(url)
    q = {k: v[0] for k, v in parse_qs(parts.query).items()}
    q.update({k: str(v) for k, v in params.items()})
    return urlunparse(parts._replace(query=urlencode(q)))


def detect_page_params(url):
    """Gjett paginerings-stil ut fra eksisterende query-parametre."""
    q = {k.lower(): k for k in parse_qs(urlparse(url).query)}
    if "skip" in q or "take" in q:
        return ("Skip", "Take")
    if "offset" in q or "limit" in q:
        return ("offset", "limit")
    return ("page", "pageSize")  # default


def fetch_all(url, page_size=200, max_pages=1000, delay=0.3, session=None):
    session = session or requests.Session()
    session.headers.update({"Accept": "application/json",
                            "User-Agent": "svg-insights-redlist/1.0"})
    skip_key, take_key = detect_page_params(url)
    offset_style = skip_key in ("Skip", "offset")
    rows, seen_total, page = [], None, 0
    while page < max_pages:
        if offset_style:
            page_url = set_query(url, **{skip_key: page * page_size, take_key: page_size})
        else:
            page_url = set_query(url, **{skip_key: page + 1, take_key: page_size})
        resp = _get_with_retry(session, page_url)
        results, total = find_results(resp.json())
        if total is not None:
            seen_total = total
        if not results:
            break
        rows.extend(results)
        sys.stderr.write(f"  side {page + 1}: +{len(results)} (sum {len(rows)}"
                         + (f"/{seen_total}" if seen_total else "") + ")\n")
        if seen_total and len(rows) >= seen_total:
            break
        if len(results) < page_size:
            break
        page += 1
        time.sleep(delay)
    return rows


def _get_with_retry(session, url, tries=4):
    last = None
    for i in range(tries):
        try:
            r = session.get(url, timeout=60)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            last = e
            time.sleep(2 ** i)
    raise SystemExit(f"Kallet feilet etter {tries} forsøk: {url}\n{last}")


def main():
    ap = argparse.ArgumentParser(description="Last ned Norsk rødliste 2021 → CSV")
    ap.add_argument("--url", default=os.environ.get("REDLIST_API_URL"),
                    help="API-URL fra portalens Network-fane (se header). "
                         "Eller sett REDLIST_API_URL.")
    ap.add_argument("--out", default="redlist_2021.csv")
    ap.add_argument("--page-size", type=int, default=200)
    ap.add_argument("--dump-fields", action="store_true",
                    help="Skriv ut råfeltene i første post og avslutt.")
    args = ap.parse_args()

    if not args.url:
        ap.error("Mangler --url (eller REDLIST_API_URL). Se header for hvordan "
                 "du finner endepunktet i nettleserens Network-fane.")

    sys.stderr.write(f"Henter fra: {args.url}\n")
    records = fetch_all(args.url, page_size=args.page_size)
    if not records:
        raise SystemExit("Ingen poster returnert — sjekk at URL-en er riktig "
                         "(se header for DevTools-oppskriften).")

    if args.dump_fields:
        print(json.dumps(records[0], ensure_ascii=False, indent=2))
        sys.stderr.write(f"\n{len(records)} poster totalt. Felt over → juster "
                         "FIELD_CANDIDATES ved behov.\n")
        return

    rows = [extract(r) for r in records]
    kept = [r for r in rows if str(r.get("redListCategory") or "").upper() in ALL_CATEGORIES
            or not r.get("redListCategory")]
    # Behold alle (alle kategorier inkluderes); ovenstående filter dropper kun
    # poster med en ukjent/ikke-kategori-verdi i kategori-feltet.
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        w.writeheader()
        w.writerows(kept)

    # Liten oppsummering pr kategori.
    by_cat = {}
    for r in kept:
        c = str(r.get("redListCategory") or "?").upper()
        by_cat[c] = by_cat.get(c, 0) + 1
    sys.stderr.write(f"\nSkrev {len(kept)} arter → {args.out}\n")
    sys.stderr.write("Pr kategori: " + ", ".join(f"{k} {v}" for k, v in sorted(by_cat.items())) + "\n")


if __name__ == "__main__":
    main()
