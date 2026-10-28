#!/usr/bin/env python3
"""Spielt die Suche der Seite für jede Ortschaft durch und zählt die Ergebnisse je Kanton.

direkt     = genau eine Kirchgemeinde
vorschlag  = geteilte Gemeinde, wahrscheinliche Kirchgemeinde über PLZ/Ortschaft/übriges Gebiet
strasse    = geteilte Gemeinde ohne Vorschlag, aber mit Grenzen für die Strassensuche
wählen     = geteilte Gemeinde ohne Vorschlag und ohne Grenzen
fehlt      = Gemeinde ohne Kirchgemeinde
ohne_str   = Treffer ohne Strasse in der Postadresse (Person muss ergänzen)

Usage: python3 -I tools/check-coverage.py [--list KT]
"""
import json, os, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load = lambda p: json.load(open(os.path.join(ROOT, p), encoding="utf-8"))

def main():
    show = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--list" else None
    orte = load("data/orte.json")
    kantone = load("data/kantone.json")
    regs = {kt: load(f"data/kg/{kt}.json") for kt, c in kantone.items() if c.get("register")}
    stats = collections.defaultdict(collections.Counter)
    for plz, ort, bfs, share, _ in orte["orte"]:
        name, kt = orte["gemeinden"][str(bfs)]
        reg = regs.get(kt)
        if not reg:
            continue
        ids = reg["gemeinden"].get(str(bfs), [])
        if not ids:
            res, kg = "fehlt", None
        elif len(ids) == 1:
            res, kg = "direkt", ids[0]
        else:
            sp = reg["split"].get(str(bfs), {})
            kg = sp.get("plz", {}).get(plz) or sp.get("ort", {}).get(ort) or sp.get("default")
            res = "vorschlag" if kg else ("strasse" if sp.get("geo") else "wählen")
        stats[kt][res] += 1
        if kg:
            k = reg["kg"][kg]
            if k.get("t") == "praesidium" or k.get("ns"):
                stats[kt]["ohne_str"] += 1
        if show == kt and res in ("wählen", "fehlt", "strasse"):
            print(f"  {res:8} {plz} {ort} ({name})")
    cols = ["direkt", "vorschlag", "strasse", "wählen", "fehlt", "ohne_str"]
    print("KT  " + " ".join(f"{c:>9}" for c in cols))
    for kt in sorted(stats):
        print(f"{kt}  " + " ".join(f"{stats[kt][c]:>9}" for c in cols))

if __name__ == "__main__":
    main()
