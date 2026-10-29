#!/usr/bin/env bash
# Deploy von teilaustritt.ch (statisch, nginx auf movena-host).
# Deployt nur den gepushten Stand von origin/main. Vorher Backup des Webroots auf dem Server.
#
#   tools/deploy.sh            Dry-Run (zeigt, was sich ändert)
#   tools/deploy.sh --apply    Backup und deployen. Ist der Webroot nicht beschreibbar (gehört root),
#                              wird der Stand nach ~/teilaustritt-release hochgeladen und der
#                              sudo-Befehl zum Übernehmen ausgegeben.
#   tools/deploy.sh --verify   Live-Prüfung
#
# HOST und ROOT lassen sich überschreiben; ROOT leer = aus dem nginx-vHost lesen.
set -euo pipefail

HOST="${HOST:-alexadmin@78.46.219.23}"
ROOT="${ROOT:-}"
MODE="${1:-dry}"
SITE="https://www.teilaustritt.ch"
STAGE="teilaustritt-release"

cd "$(dirname "$0")/.."

verify() {
  echo "Prüfe live …"
  local page; page="$(curl -fsS "$SITE/" || true)"
  if [[ "$page" == *"assets/js/app.js"* ]]; then echo "  index.html: neue Version"; else echo "  index.html: noch alte Version"; fi
  for p in fr/ it/ en/ kanton/ kanton/luzern/ fr/canton/ robots.txt sitemap.xml llms.txt assets/img/og-de.png data/orte.json data/kantone.json data/kg/ZH.json data/geo/261.json data/steuer.json assets/js/app.js assets/vendor/jspdf-2.5.1.umd.min.js; do
    printf '  %-40s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$SITE/$p")"
  done
  # Header aus ops/alt-setup.sh (Sicherheit, Komprimierung, Weiterleitung auf www)
  local h; h="$(curl -sI "$SITE/")"
  for k in strict-transport-security content-security-policy x-content-type-options; do
    printf '  %-40s %s\n' "$k" "$(grep -qi "^$k:" <<<"$h" && echo ja || echo fehlt)"
  done
  printf '  %-40s %s\n' "gzip data/orte.json" "$(curl -s -o /dev/null -H 'Accept-Encoding: gzip' -w '%{size_download} Bytes' "$SITE/data/orte.json")"
  printf '  %-40s %s\n' "teilaustritt.ch → www" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' https://teilaustritt.ch/)"
}
[[ "$MODE" == "--verify" ]] && { verify; exit 0; }

# HTTPS-Remote ohne gespeicherte Zugangsdaten: einmalig die Anmeldung von gh verwenden
git fetch -q origin 2>/dev/null || git -c credential.helper= -c credential.helper='!gh auth git-credential' fetch -q origin
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

WRITABLE=1
ssh -o BatchMode=yes "$HOST" "test -w '$ROOT' && test -w '$ROOT/index.html'" || WRITABLE=0

if [[ "$MODE" != "--apply" ]]; then
  if (( WRITABLE )); then
    rsync -n -rlptv --checksum index.html robots.txt sitemap.xml llms.txt 31105e0730db108a66218034416dcf61.txt kanton fr it en assets "$HOST:$ROOT/"
    rsync -n -rlptv --checksum --delete data/ "$HOST:$ROOT/data/"
  else
    echo "Webroot gehört nicht $(echo "$HOST" | cut -d@ -f1): --apply lädt nach ~/$STAGE hoch und gibt den sudo-Befehl aus."
  fi
  echo "Dry-Run. Mit --apply deployen."
  exit 0
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
# Die Dateien im Webroot sind lesbar, das Backup braucht kein sudo
ssh -o BatchMode=yes "$HOST" "tar -czf ~/teilaustritt-backup-$TS.tar.gz -C '$ROOT' ."
echo "Backup: $HOST:~/teilaustritt-backup-$TS.tar.gz"

if (( WRITABLE )); then
  rsync -rlpt --checksum index.html robots.txt sitemap.xml llms.txt 31105e0730db108a66218034416dcf61.txt kanton fr it en assets "$HOST:$ROOT/"
  rsync -rlpt --checksum --delete data/ "$HOST:$ROOT/data/"
  verify
else
  ssh -o BatchMode=yes "$HOST" "mkdir -p ~/$STAGE"
  rsync -rlpt --checksum --delete index.html robots.txt sitemap.xml llms.txt 31105e0730db108a66218034416dcf61.txt kanton fr it en assets data "$HOST:$STAGE/"
  echo
  echo "Hochgeladen nach $HOST:~/$STAGE. Zum Übernehmen (fragt nach dem sudo-Passwort):"
  echo
  echo "  ssh -t $HOST 'sudo rsync -rlpt --chown=www-data:www-data ~/$STAGE/index.html ~/$STAGE/robots.txt ~/$STAGE/sitemap.xml ~/$STAGE/llms.txt ~/$STAGE/31105e0730db108a66218034416dcf61.txt ~/$STAGE/kanton ~/$STAGE/fr ~/$STAGE/it ~/$STAGE/en ~/$STAGE/assets \"$ROOT/\" && sudo rsync -rlpt --delete --chown=www-data:www-data ~/$STAGE/data/ \"$ROOT/data/\"'"
  echo
  echo "Danach: tools/deploy.sh --verify"
fi
echo "Rückweg: ssh -t $HOST 'sudo tar -xzf ~/teilaustritt-backup-$TS.tar.gz -C \"$ROOT\"'"
