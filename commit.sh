#!/bin/bash
set -e
cd ~/svg-insights
git add -A
git commit -m "${1:-update}"
git push origin master
