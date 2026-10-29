#!/usr/bin/env bash
# Einmalig als root auf ALT (78.46.219.23):
#   sudo bash ~/teilaustritt-ops/alt-setup.sh            # einrichten
#   sudo bash ~/teilaustritt-ops/alt-setup.sh --rollback # letzten Stand wiederherstellen
#
# 1. teilaustritt.ch: Sicherheits-Header, Komprimierung für JSON/JS/CSS, Caching (Assets 30 Tage,
#    Seiten und Daten immer neu prüfen), teilaustritt.ch → www.teilaustritt.ch.
# 2. verafides.ch: Sicherheits-Header (ohne CSP) und Komprimierung.
# 3. Webroot /var/www/teilaustritt.ch gehört alexadmin (Gruppe www-data): tools/deploy.sh --apply
#    schreibt danach direkt, ohne sudo-rsync.
# Vorher Backup nach /etc/nginx/backup-teilaustritt-<Zeit>/; scheitert «nginx -t», wird es zurückgespielt.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Bitte mit sudo ausführen." >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
AV=/etc/nginx/sites-available
TA=$AV/teilaustritt.ch
VF=$AV/verafides
WEB=/var/www/teilaustritt.ch

if [[ "${1:-}" == "--rollback" ]]; then
  last="$(ls -d /etc/nginx/backup-teilaustritt-* 2>/dev/null | sort | tail -1)"
  [[ -n "$last" ]] || { echo "Kein Backup gefunden." >&2; exit 1; }
  cp -a "$last/teilaustritt.ch" "$TA"; cp -a "$last/verafides" "$VF"
  rm -f /etc/nginx/snippets/teilaustritt-headers.conf /etc/nginx/snippets/verafides-headers.conf
  chown root:root "$WEB"; chown -R www-data:www-data "$WEB"/*
  nginx -t && systemctl reload nginx
  echo "Zurückgesetzt auf $last."
  exit 0
fi

BK=/etc/nginx/backup-teilaustritt-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BK"
cp -a "$TA" "$VF" "$BK/"
echo "Backup: $BK"

install -m 644 "$HERE/nginx/teilaustritt-headers.conf" /etc/nginx/snippets/teilaustritt-headers.conf
install -m 644 "$HERE/nginx/verafides-headers.conf" /etc/nginx/snippets/verafides-headers.conf

python3 - "$TA" "$VF" <<'PY'
import sys, re
ta, vf = sys.argv[1], sys.argv[2]
s = open(ta).read()
if "teilaustritt-headers.conf" not in s:
    head, sep, tail = s.partition("    index index.html;\n")
    assert sep, "teilaustritt.ch: «index index.html;» nicht gefunden"
    add = ("\n    # Eine Adresse: teilaustritt.ch → www.teilaustritt.ch\n"
           "    if ($host = teilaustritt.ch) {\n        return 301 https://www.teilaustritt.ch$request_uri;\n    }\n\n"
           "    include /etc/nginx/snippets/teilaustritt-headers.conf;\n")
    old = "    location / {\n        try_files $uri $uri/ =404;\n    }\n"
    assert old in tail, "teilaustritt.ch: «location /» nicht wie erwartet"
    new = ("    # Assets sind über ?v=… versioniert\n    location /assets/ {\n        expires 30d;\n        try_files $uri =404;\n    }\n\n"
           "    # Daten und Seiten immer neu prüfen (ETag)\n    location /data/ {\n        expires -1;\n        try_files $uri =404;\n    }\n\n"
           "    location / {\n        expires -1;\n        try_files $uri $uri/ =404;\n    }\n")
    s = head + sep + add + tail.replace(old, new, 1)
    open(ta, "w").write(s)
    print("teilaustritt.ch angepasst")
v = open(vf).read()
if "verafides-headers.conf" not in v:
    v2 = v.replace("    index index.html;\n", "    index index.html;\n\n    include /etc/nginx/snippets/verafides-headers.conf;\n", 1)
    assert v2 != v, "verafides: «index index.html;» nicht gefunden"
    open(vf, "w").write(v2)
    print("verafides angepasst")
PY

if ! nginx -t; then
  echo "nginx -t fehlgeschlagen, stelle das Backup wieder her." >&2
  cp -a "$BK/teilaustritt.ch" "$TA"; cp -a "$BK/verafides" "$VF"
  rm -f /etc/nginx/snippets/teilaustritt-headers.conf /etc/nginx/snippets/verafides-headers.conf
  nginx -t && systemctl reload nginx
  exit 1
fi
systemctl reload nginx
echo "Nginx neu geladen."

# Deploy ohne sudo: Webroot gehört alexadmin, Nginx liest über die Gruppe www-data bzw. «andere»
chown -R alexadmin:www-data "$WEB"
chmod -R u=rwX,g=rX,o=rX "$WEB"
echo "Webroot $WEB gehört jetzt alexadmin:www-data."
echo "Prüfen: curl -sI https://www.teilaustritt.ch/ ; curl -sI https://teilaustritt.ch/ ; curl -sI https://verafides.ch/"
