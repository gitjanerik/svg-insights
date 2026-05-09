#!/bin/bash
set -euo pipefail

# SVG Insights — sesjons-oppstart-hook
#
# 1. Synkroniserer lokal master med origin/master (trygt fra hvilken som
#    helst branch — rører ikke working tree eller HEAD).
# 2. Installerer npm-avhengigheter i app/ når sesjonen kjører i en fersk
#    web-sandkasse (ikke nødvendig lokalt der dependencies allerede ligger).

cd "${CLAUDE_PROJECT_DIR:-.}"

if git rev-parse --git-dir > /dev/null 2>&1; then
  echo "→ git fetch origin"
  if git fetch origin --quiet 2>&1; then
    if git show-ref --verify --quiet refs/remotes/origin/master; then
      git branch -f master origin/master > /dev/null 2>&1 || true
      echo "→ lokal master = origin/master ($(git rev-parse --short origin/master))"
    fi
  else
    echo "  advarsel: git fetch feilet (offline?) — fortsetter"
  fi
fi

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && [ -f "app/package.json" ]; then
  echo "→ npm install (app/)"
  (cd app && npm install --no-audit --no-fund --prefer-offline)
fi

echo "→ sesjons-oppstart ferdig"
