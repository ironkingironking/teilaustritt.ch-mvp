# teilaustritt.ch – Formular-Generator mit Kirchgemeinde-Suche

Statische Seite ohne Build-Step und ohne externe Abhängigkeiten zur Laufzeit. Die Person gibt
PLZ oder Ort ein, die Seite zeigt die zuständige römisch-katholische Kirchgemeinde mit
Postadresse und erstellt das Austrittsschreiben als PDF, Word-Datei oder Ausdruck.

## Struktur

```
index.html                    Seite Deutsch (Inhalt, Fragen, Quellen, Impressum, Datenschutz)
fr/ it/ en/index.html         Übersetzte Seiten, gleiche Struktur und IDs; der deutsche Text ist massgebend
assets/js/i18n.js             Oberflächentexte (de/fr/it/en), Brieftexte (de/fr/it), Kantonsnamen
assets/css/site.css           Styles inkl. Druckansicht (nur der Brief)
assets/js/app.js              Ortssuche, Kirchgemeinde-Zuordnung, Brief, PDF/Word
assets/vendor/                jsPDF 2.5.1 und docx 8.5.0 (MIT), selbst gehostet, erst beim Klick geladen
data/orte.json                PLZ/Ortschaft → Gemeinde (BFS-Nr.), aus dem amtlichen Ortschaftenverzeichnis
data/kantone.json             Kantonsebene: Körperschaft, Austrittsregeln, Verzeichnis-Link
data/kg/<KT>.json             Kirchgemeinden je Kanton (Postadresse, Quelle, Gemeinden)
data/geo/<bfs>.json           Grenzen der Kirchgemeinden in geteilten Gemeinden (WGS84)
data-src/kirchgemeinden/      Recherchierte Quelldaten je Kanton mit Quellen-URLs, Notizen und offenen Punkten (issues)
data-src/estv-kirchensteuern.json  Kirchensteuer je Kanton (SSK/ESTV, Stand 2022, mit neueren kantonalen Abweichungen)
data-src/geo/                 Kirchgemeinde-Grenzen (Stadt Zürich, Kanton St. Gallen) für die Strassensuche
tools/build-orte.py           erzeugt data/orte.json
tools/build-geo.py            bereitet eine Grenzen-Quelle (GeoJSON) für data-src/geo/ auf
tools/build-registry.py       erzeugt data/kantone.json, data/kg/, data/geo/ aus data-src/
tools/check-coverage.py       spielt die Suche für jede Ortschaft durch und zählt die Ergebnisse
```

`css/style.css`, `js/generator.js` und `v 0.1` stammen aus früheren Versionen und werden nicht
mehr verwendet.

## Sprachen

Die Seitensprache kommt aus `<html lang>`. Die Briefsprache ist davon getrennt: Standard ist die
Amtssprache der gewählten Ortschaft (Ortschaftenverzeichnis), umschaltbar auf DE/FR/IT. Texte aus
den Daten gibt es als `feld_fr`, `feld_it`, `feld_en` (z. B. `tipp_fr`, `summary_it`,
`public_hinweis_en`); fehlt eine Übersetzung, zeigt die Seite den deutschen Text. Bei Änderungen an
`app.js` oder `i18n.js` die Version `?v=…` in allen vier Seiten und im Import in `app.js` erhöhen.

## Empfängeradresse

`build-registry.py` kürzt die Postadresse auf Name, Strasse/Postfach und PLZ Ort. Funktionszeilen
(Kirchenrat, Kirchenpflege, Sekretariat, Conseil …) und «c/o Pfarrei …» fallen weg; ein c/o an eine
externe Stelle (z. B. Treuhandfirma) bleibt. Die vollständige Adresse steht weiter in `data-src/`.

## Ablauf der Suche

1. PLZ/Ort wird lokal in `data/orte.json` gesucht. Liegt eine Ortschaft in mehreren Gemeinden,
   kann die Person die Gemeinde wählen.
2. Gemeinde (BFS-Nr.) → `data/kg/<KT>.json` → Kirchgemeinde.
3. Hat eine Gemeinde mehrere Kirchgemeinden, entscheidet zuerst die Ortschaft (`ortsteile`), dann
   optional die Strasse: Die Adresse geht an geo.admin.ch, der Punkt wird in `data/geo/<bfs>.json`
   gesucht. Sonst wählt die Person aus der Liste.
4. Ohne Daten zeigt die Seite das Verzeichnis der Landeskirche und lässt den Empfänger eintragen.

## Daten aktualisieren

```bash
# Ortschaftenverzeichnis (swisstopo), ZIP entpacken:
# https://data.geo.admin.ch/ch.swisstopo-vd.ortschaftenverzeichnis_plz/ortschaftenverzeichnis_plz/ortschaftenverzeichnis_plz_2056.csv.zip
python3 -I tools/build-orte.py AMTOVZ_CSV_LV95.csv 2026-09-30

# Kirchgemeinden: data-src/kirchgemeinden/<KT>.json bearbeiten, dann
python3 -I tools/build-registry.py
```

Jeder Eintrag in `data-src/kirchgemeinden/` braucht eine Quellen-URL und eine `confidence`
(`high`, `medium`, `low`). Bei `medium` und `low` zeigt die Seite «Bitte Adresse vor dem Versand
prüfen». Die Hinweise leitet sie aus `address_type` ab. `note` und `issues` sind Recherchenotizen
und erscheinen nicht auf der Seite. Einen Text für die Besucher setzt man mit `public_note`
(Kirchgemeinde) bzw. `public_how` (geteilte Gemeinde). Nach Gemeindefusionen zuerst
`build-orte.py`, dann die BFS-Nummern in `data-src/` nachführen.

Geteilte Gemeinden: `ortsteile` darf beschreibend sein («Hellbühl (6016)», «übriges Gebiet»).
`build-registry.py` macht daraus Regeln nach PLZ, amtlicher Ortschaft und «übrigem Gebiet». Die
Seite schlägt so die wahrscheinliche Kirchgemeinde vor und lässt eine andere wählen.

```bash
# Grenzen neu aufbereiten (Quelle: WFS der Stadt Zürich bzw. des Kantons St. Gallen)
python3 -I tools/build-geo.py zh-stadt zh.geojson bezeichnung EPSG:4326 ZH 0.00002
python3 -I tools/build-geo.py sg-kath sg.geojson kath._Kirchgemeinde EPSG:2056 SG,AR,AI,TG 5
python3 -I tools/build-registry.py && python3 -I tools/check-coverage.py
```

## Lokale Vorschau

```bash
python3 -m http.server 8765
# http://127.0.0.1:8765/
```

`index.html` direkt als Datei öffnen geht nicht, weil die Seite ihre Daten per `fetch` lädt.

---

© 2025–2026 • teilaustritt.ch • Verein Vera Fides • MIT-Lizenz
