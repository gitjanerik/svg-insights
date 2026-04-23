#!/bin/bash
set -e

# Bygg appen
cd /home/claude/svg-insights/app
npx vite build

# Lagre dist til midlertidig plassering (unngå hash-kollisjon med gammel /tmp)
TMPDIR=$(mktemp -d)
cp -r dist/. "$TMPDIR/"

# Deploy til gh-pages
cd /home/claude/svg-insights
git checkout gh-pages

# Fjern gamle assets og kopier friske filer
rm -rf assets
cp -r "$TMPDIR/." .
rm -rf "$TMPDIR"

git add -A
git commit -m "${1:-deploy}"
git push origin gh-pages

git checkout master
