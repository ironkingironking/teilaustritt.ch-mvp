#!/usr/bin/env bash
# Deploy von teilaustritt.ch (statisch, nginx auf movena-host).
# Deployt nur den gepushten Stand von origin/main. Vorher Backup des Webroots auf dem Server.
#
#   tools/deploy.sh            Dry-Run (zeigt, was sich ändert)
#   tools/deploy.sh --apply    deployen
#
# HOST und ROOT lassen sich überschreiben; ROOT leer = aus dem nginx-vHost lesen.
set -euo pipefail

HOST="${HOST:-alexadmin@78.46.219.23}"
ROOT="${ROOT:-}"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

cd "$(dirname "$0")/.."

git fetch -q origin
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Abbruch: Arbeitsbaum hat uncommittete Änderungen." >&2; exit 1
fi
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "Abbruch: HEAD ist nicht origin/main. Erst pushen bzw. main auschecken." >&2; exit 1
fi

if [[ -z "$ROOT" ]]; then
  ROOT="$(ssh -o BatchMode=yes "$HOST" \
    "grep -hA40 -E 'server_name[^;]*teilaustritt' /etc/nginx/sites-enabled/* | grep -m1 -oP '^\s*root\s+\K[^;]+'")"
fi
[[ -n "$ROOT" ]] || { echo "Abbruch: Webroot nicht gefunden. ROOT=/pfad setzen." >&2; exit 1; }
echo "Ziel: $HOST:$ROOT  (Stand $(git rev-parse --short HEAD))"

if ! ssh -o BatchMode=yes "$HOST" "test -w '$ROOT' && test -w '$ROOT/index.html'"; then
  echo "Abbruch: $ROOT ist für $(echo "$HOST" | cut -d@ -f1) nicht beschreibbar." >&2
  echo "Einmalig: ssh -t $HOST 'sudo chown -R \$USER \"$ROOT\"'" >&2
  exit 1
fi

if (( APPLY == 0 )); then
  rsync -n -rlptv --checksum index.html assets "$HOST:$ROOT/"
  rsync -n -rlptv --checksum --delete data/ "$HOST:$ROOT/data/"
  echo "Dry-Run. Mit --apply deployen."
  exit 0
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
ssh -o BatchMode=yes "$HOST" "tar -czf ~/teilaustritt-backup-$TS.tar.gz -C '$ROOT' ."
rsync -rlpt --checksum index.html assets "$HOST:$ROOT/"
rsync -rlpt --checksum --delete data/ "$HOST:$ROOT/data/"

echo "Prüfe live …"
curl -fsS https://www.teilaustritt.ch/ | grep -q 'assets/js/app.js' && echo "  index.html: neue Version"
for p in data/orte.json data/kantone.json data/kg/ZH.json assets/js/app.js assets/vendor/jspdf-2.5.1.umd.min.js; do
  printf '  %-40s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://www.teilaustritt.ch/$p")"
done
echo "Backup: $HOST:~/teilaustritt-backup-$TS.tar.gz"
echo "Rückweg: ssh $HOST 'tar -xzf ~/teilaustritt-backup-$TS.tar.gz -C \"$ROOT\"'"
