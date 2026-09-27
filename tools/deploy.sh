#!/usr/bin/env bash
# Deploy der Web-App und der Cloud Functions - ein Befehl, auf einem Rechner
# mit `firebase login`.
#
#   tools/deploy.sh
#
# 1. prüft, dass das Secret ODDS_API_KEY existiert, und fragt es sonst ab
#    (verdeckte Eingabe, landet nur im Secret Manager)
# 2. legt functions/venv an, falls es fehlt, und lässt die Python-Tests laufen
# 3. baut das Frontend (Version, PR und Commit landen im Footer)
# 4. deployt Hosting und Functions
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

command -v firebase >/dev/null || { echo "firebase CLI fehlt: npm i -g firebase-tools"; exit 1; }
firebase projects:list >/dev/null 2>&1 || { echo "Nicht angemeldet: firebase login"; exit 1; }

if [ -n "$(git status --porcelain)" ]; then
  echo "Achtung: nicht committete Änderungen - der Footer zeigt dann einen Commit, der sie nicht enthält."
  read -r -p "Trotzdem deployen? [j/N] " ok
  [ "$ok" = "j" ] || exit 1
fi

if ! firebase functions:secrets:access ODDS_API_KEY >/dev/null 2>&1; then
  echo "Secret ODDS_API_KEY fehlt - bitte jetzt den Key von the-odds-api.com eingeben:"
  firebase functions:secrets:set ODDS_API_KEY
fi

[ -f functions/.env ] || { echo "functions/.env fehlt - aus functions/.env.example anlegen (FSA_ALLOWED_ORIGINS, FSA_SNAPSHOT_USERS)."; exit 1; }
[ -f frontend/.env.local ] || [ -n "${NEXT_PUBLIC_API_URL:-}" ] || {
  echo "NEXT_PUBLIC_API_URL fehlt - in frontend/.env.local setzen, sonst zeigt der Build auf localhost."; exit 1; }

if [ ! -d functions/venv ]; then
  python3 -m venv functions/venv
  functions/venv/bin/pip install -q -r functions/requirements.txt
fi
functions/venv/bin/python -m unittest discover -s functions/tests

npm ci --prefix frontend
npm run build --prefix frontend

firebase deploy

VERSION=$(node -p "require('./frontend/package.json').version")
echo "Deployt: v$VERSION ($(git rev-parse --short HEAD))"
