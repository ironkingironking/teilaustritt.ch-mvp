#!/usr/bin/env python3
"""Grundlage für den Kirchensteuer-Schätzer: einmal beim Build aus dem Steuerrechner der ESTV.

Die Seite rechnet im Browser: einfache Kantonssteuer (je Kanton, interpoliert über ein Raster
steuerbarer Einkommen) × Faktor der Gemeinde (Kirchensteuer / einfache Kantonssteuer). So gehen
keine Eingaben an die ESTV, und es braucht je Gemeinde nur einen Aufruf.

Input:  data/orte.json, data/kantone.json
Cache:  data-src/steuer/estv-cache.json (Antworten der ESTV; erneute Läufe fragen nur Fehlendes ab)
Output: data/steuer.json

Usage: python3 -I tools/build-steuer.py [Steuerjahr]
"""
import json, os, sys, time, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://swisstaxcalculator.estv.admin.ch/delegate/ost-integration/v1/lg-proxy/operation/c3b67379_ESTV/"
YEAR = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
CACHE = os.path.join(ROOT, "data-src", "steuer", "estv-cache.json")
# Steuerbares Einkommen (Kantonssteuer) in CHF
GRID = [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000, 120000, 150000,
        200000, 250000, 300000, 400000, 500000, 750000, 1000000]
ROMAN_CATHOLIC, SINGLE, MARRIED = 2, 1, 2
# Hauptorte für das Raster der einfachen Steuer (BFS-Nr.)
CAPITALS = {"ZH": 261, "BE": 351, "LU": 1061, "UR": 1201, "SZ": 1372, "OW": 1407, "NW": 1509, "GL": 1632,
            "ZG": 1711, "FR": 2196, "SO": 2601, "BS": 2701, "BL": 2829, "SH": 2939, "AR": 3001, "AI": 3101,
            "SG": 3203, "GR": 3901, "AG": 4001, "TG": 4566, "TI": 5002, "VD": 5586, "VS": 6266, "NE": 6458,
            "GE": 6621, "JU": 6711}

lock = threading.Lock()

def load(path, default=None):
    try:
        return json.load(open(path, encoding="utf-8"))
    except FileNotFoundError:
        return default

def post(op, body, tries=4):
    data = json.dumps(body).encode()
    for i in range(tries):
        try:
            req = urllib.request.Request(API + op, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)["response"]
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))

def calc(loc, income, rel):
    body = {"SimKey": None, "TaxYear": YEAR, "TaxLocationID": loc, "Relationship": rel,
            "Confession1": ROMAN_CATHOLIC, "Children": [], "Confession2": ROMAN_CATHOLIC if rel == MARRIED else 0,
            "TaxableIncomeCanton": income, "TaxableIncomeFed": income, "TaxableFortune": 0}
    r = post("API_calculateSimpleTaxes", body)
    return {"simple": r["IncomeSimpleTaxCanton"], "church": r["IncomeTaxChurch"]}

def main():
    orte = load(os.path.join(ROOT, "data", "orte.json"))
    kantone = load(os.path.join(ROOT, "data", "kantone.json"))
    cache = load(CACHE, {})
    cache.setdefault(str(YEAR), {"loc": {}, "ratio": {}, "grid": {}})
    c = cache[str(YEAR)]
    gemeinden = orte["gemeinden"]
    # grösste PLZ je Gemeinde: dort ist die Gemeinde im Steuerrechner sicher auffindbar
    best = {}
    for plz, ort, bfs, share, *_ in orte["orte"]:
        if share > best.get(str(bfs), (None, -1))[1]:
            best[str(bfs)] = (plz, share)
    register = [kt for kt in CAPITALS if kantone.get(kt, {}).get("register")]
    wanted = [b for b, (name, kt) in gemeinden.items() if kt in register]

    def locate(bfs):
        if bfs in c["loc"]:
            return
        name = gemeinden[bfs][0]
        hit = None
        for search in (best[bfs][0], name):
            res = post("API_searchLocation", {"Search": str(search), "Language": 1, "TaxYear": YEAR}) or []
            hit = next((r["TaxLocationID"] for r in res if str(r.get("BfsID")) == bfs), None)
            if hit:
                break
        with lock:
            c["loc"][bfs] = hit

    def ratio(bfs):
        loc = c["loc"].get(bfs)
        if not loc or bfs in c["ratio"]:
            return
        r = calc(loc, 80000, SINGLE)
        with lock:
            c["ratio"][bfs] = round(r["church"] / r["simple"], 5) if r["simple"] else None

    def grid(kt):
        loc = c["loc"].get(str(CAPITALS[kt]))
        if not loc or kt in c["grid"]:
            return
        rows = {"s": [calc(loc, i, SINGLE)["simple"] for i in GRID], "m": [calc(loc, i, MARRIED)["simple"] for i in GRID]}
        with lock:
            c["grid"][kt] = rows

    def run(fn, items, label):
        done = 0
        with ThreadPoolExecutor(max_workers=4) as pool:
            for _ in pool.map(fn, items):
                done += 1
                if done % 200 == 0:
                    print(f"  {label}: {done}/{len(items)}", flush=True)
                    save(cache)
        save(cache)

    run(locate, wanted, "Orte")
    run(ratio, wanted, "Faktoren")
    run(grid, register, "Raster")

    out = {
        "jahr": YEAR,
        "quelle": "Steuerrechner der Eidgenössischen Steuerverwaltung (ESTV), Abfrage beim Build",
        "einkommen": GRID,
        "kantone": c["grid"],
        "gemeinden": {b: r for b, r in sorted(c["ratio"].items(), key=lambda kv: int(kv[0])) if r is not None},
    }
    # Kantonsmittel (Median der Gemeinden) für die Schätzung, solange kein Wohnort gewählt ist
    out["mittel"] = {}
    for kt in register:
        rs = sorted(r for b, r in out["gemeinden"].items() if gemeinden[b][1] == kt)
        if rs:
            out["mittel"][kt] = rs[len(rs) // 2]
    with open(os.path.join(ROOT, "data", "steuer.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    missing = [b for b in wanted if c["loc"].get(b) is None]
    print(f"{len(out['gemeinden'])} Gemeinden mit Faktor, {len(out['kantone'])} Kantone mit Raster; ohne Ort im Steuerrechner: {len(missing)}")
    if missing:
        print("  " + ", ".join(f"{gemeinden[b][0]} ({b})" for b in missing[:30]))

def save(cache):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with lock:
        tmp = CACHE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(cache, fh, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, CACHE)

if __name__ == "__main__":
    main()
