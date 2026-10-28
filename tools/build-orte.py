#!/usr/bin/env python3
"""Build data/orte.json from the official Swiss locality directory.

Source: swisstopo, Amtliches Ortschaftenverzeichnis mit PLZ und Gemeinde
https://data.geo.admin.ch/ch.swisstopo-vd.ortschaftenverzeichnis_plz/ortschaftenverzeichnis_plz/ortschaftenverzeichnis_plz_2056.csv.zip

Usage: python3 -I tools/build-orte.py <AMTOVZ_CSV_LV95.csv> <stand YYYY-MM-DD>
"""
import csv, json, sys, os

LANG = {"de": "d", "fr": "f", "it": "i", "rm": "r"}

def main():
    src, stand = sys.argv[1], sys.argv[2]
    gemeinden, orte = {}, []
    with open(src, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f, delimiter=";"):
            kt = r["Kantonskürzel"]
            if not kt:  # Liechtenstein
                continue
            bfs = int(r["BFS-Nr"])
            gemeinden[str(bfs)] = [r["Gemeindename"], kt]
            share = int(round(float(r["Adressenanteil"].replace("%", "").strip() or 0)))
            orte.append([r["PLZ4"], r["Ortschaftsname"], bfs, share, LANG.get(r["Sprache"], "")])
    # one entry per PLZ + Ortschaft + Gemeinde; the CSV repeats rows for Zusatzziffern
    seen, uniq = {}, []
    for o in orte:
        key = (o[0], o[1], o[2])
        if key in seen:
            seen[key][3] = min(100, seen[key][3] + o[3])
            continue
        seen[key] = o
        uniq.append(o)
    uniq.sort(key=lambda o: (o[0], o[1], -o[3]))
    out = {
        "stand": stand,
        "quelle": "swisstopo, Amtliches Ortschaftenverzeichnis mit PLZ und Gemeinde",
        "gemeinden": dict(sorted(gemeinden.items(), key=lambda kv: int(kv[0]))),
        "orte": uniq,
    }
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, "data", "orte.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(gemeinden)} Gemeinden, {len(uniq)} Ortschaften -> {path} ({os.path.getsize(path)} Bytes)")

if __name__ == "__main__":
    main()
