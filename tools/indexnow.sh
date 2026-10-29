#!/usr/bin/env bash
# Meldet alle URLs aus sitemap.xml an IndexNow (Bing, Yandex, Seznam, Naver …; die ChatGPT-Suche baut auf Bing auf).
# Nach einem Deploy mit neuen oder geänderten Seiten ausführen: tools/indexnow.sh
# Der Schlüssel ist öffentlich (liegt als 31105e0730db108a66218034416dcf61.txt im Webroot) und kein Geheimnis.
set -euo pipefail
cd "$(dirname "$0")/.."
KEY=31105e0730db108a66218034416dcf61
HOST=www.teilaustritt.ch
urls="$(grep -oP '(?<=<loc>)[^<]+' sitemap.xml | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')"
curl -fsS -o /dev/null -w "IndexNow: HTTP %{http_code} (200/202 = angenommen)\n" -X POST https://api.indexnow.org/indexnow \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"host\":\"$HOST\",\"key\":\"$KEY\",\"keyLocation\":\"https://$HOST/$KEY.txt\",\"urlList\":$urls}"
