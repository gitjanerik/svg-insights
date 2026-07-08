# Reprodusering

```bash
# 1. Hent OSM-data (skriver osm.json, ~9 MB, ikke sjekket inn)
curl -sS -A "svg-insights-map/1.0" --data-urlencode "data@overpass.ql" \
  https://overpass-api.de/api/interpreter -o osm.json

# 2. Bygg kartdata + nærhetsanalyse → mapdata.json
node build_mapdata.mjs

# 3. Render sepia-kart → ../kjekstadmarka-tur.svg
node render.mjs
```

`lib.mjs` inneholder felles graf-/rutinglogikk (Dijkstra på OSM-stinettet).
`mapdata.json` er committet slik at kartet kan re-rendres uten å hente OSM på nytt.
