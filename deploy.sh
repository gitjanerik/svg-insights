#!/bin/bash
set -e

# Bygg appen
cd ~/svg-insights/app
npm run build

# Kopier dist til gh-pages
cd ~/svg-insights
git checkout gh-pages
cp -r app/dist/* .
git add -A
git commit -m "${1:-deploy}"
git push origin gh-pages

# Tilbake til master
git checkout master
