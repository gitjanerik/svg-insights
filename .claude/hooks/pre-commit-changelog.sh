#!/bin/bash
set -euo pipefail

# SVG Insights — PreToolUse-vakt for CHANGELOG-disiplin.
#
# Konvensjon (CLAUDE.md «Versjonshåndtering»): hver versjons-bump skal følges av
# en ny post øverst i CHANGELOG.md. Denne hooken blokkerer en `git commit` der
# app/src/version.js er STAGET (= versjon bumpet) uten at CHANGELOG.md også er
# staget i samme commit, så det ikke glemmes.
#
# Bevisst staged-only: agenten her bruker alltid `git add -A && git commit`, så
# det stagede settet er nøyaktig det som committes. `git commit -a` (uten
# forhånds-staging) fanges ikke — dette er et sikkerhetsnett, ikke en lås.

cd "${CLAUDE_PROJECT_DIR:-.}"

# PreToolUse-payload kommer som JSON på stdin. Hent ut Bash-kommandoen.
payload="$(cat)"
cmd="$(printf '%s' "$payload" | python3 -c 'import sys, json
try:
    print(json.load(sys.stdin).get("tool_input", {}).get("command", ""))
except Exception:
    print("")' 2>/dev/null || true)"

# Bare relevant for git commit.
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

staged="$(git diff --cached --name-only 2>/dev/null || true)"

bumped=0; changelog=0
printf '%s\n' "$staged" | grep -qx 'app/src/version.js' && bumped=1 || bumped=0
printf '%s\n' "$staged" | grep -qx 'CHANGELOG.md' && changelog=1 || changelog=0

if [ "$bumped" = "1" ] && [ "$changelog" = "0" ]; then
  {
    echo "BLOKKERT: app/src/version.js er bumpet, men CHANGELOG.md er ikke med i denne committen."
    echo ""
    echo "Konvensjon (CLAUDE.md): hver versjons-bump skal ha en ny post øverst i CHANGELOG.md."
    echo "Format:  ## <YYYY-MM-DD> — v<versjon>: <kort tittel>  +  ett forklarende avsnitt  +  ---"
    echo ""
    echo "Legg til posten, kjør «git add CHANGELOG.md», og commit på nytt."
  } >&2
  exit 2
fi

exit 0
