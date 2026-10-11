#!/usr/bin/env bash
# Prüft FSA_ALLOWED_ORIGINS, bevor es in die Functions geht.
#
#   tools/check_origins.sh "https://<projekt>.web.app,https://<projekt>.firebaseapp.com"
#
# Ein Tippfehler dort sperrt die App aus ihrer eigenen API aus, und zwar
# leise: Der Browser vergleicht die Origin Zeichen für Zeichen, die Function
# antwortet weiter mit 204, nur der Button meldet "Netzwerkfehler". So ging
# es mit "ttps://" statt "https://". Erlaubt ist "*" oder eine Komma-Liste
# aus https://host[:port] - kleingeschrieben, ohne Pfad und ohne Schrägstrich
# am Ende, genau so, wie der Browser die Origin schickt. Leer ist erlaubt
# (die API fällt dann auf "*" zurück).
set -euo pipefail

value="${1-}"
bad=()
IFS=',' read -ra entries <<< "$value"
for entry in "${entries[@]}"; do
  origin="$(printf '%s' "$entry" | tr -d '[:space:]')"
  [ -z "$origin" ] || [ "$origin" = "*" ] && continue
  [[ "$origin" =~ ^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]+)?$ ]] || bad+=("$origin")
done

if [ ${#bad[@]} -gt 0 ]; then
  echo "FSA_ALLOWED_ORIGINS enthält ungültige Origins: ${bad[*]}"
  echo "Erwartet: https://host ohne Pfad und ohne / am Ende, kleingeschrieben, Komma-getrennt."
  exit 1
fi
echo "FSA_ALLOWED_ORIGINS ok"
