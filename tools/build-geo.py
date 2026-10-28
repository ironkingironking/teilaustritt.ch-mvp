#!/usr/bin/env python3
"""Kirchgemeinde-Grenzen für die Strassensuche aufbereiten.

Liest eine GeoJSON-Quelle, ordnet jedes Polygon über seinen Namen einer Kirchgemeinde-ID aus
data-src/kirchgemeinden/ zu, vereinfacht die Geometrie und schreibt data-src/geo/<name>.geojson
mit properties.kg und crs ("EPSG:2056" oder "EPSG:4326").

Usage: python3 -I tools/build-geo.py <name> <quelle.geojson> <attribut> <crs> <KT,KT,...> [tolerance] [name=id ...]
  z. B. python3 -I tools/build-geo.py zh-stadt zh.geojson bezeichnung EPSG:4326 ZH 0.00002
        python3 -I tools/build-geo.py sg-kath sg.geojson kath._Kirchgemeinde EPSG:2056 SG,AR,AI,TG 2
"""
import json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def norm(s):
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if not unicodedata.combining(c)).replace("ß", "ss")
    s = re.sub(r"\bst\.?\s*", "st ", s).replace("sankt ", "st ")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

def simplify(points, tol):
    """Douglas-Peucker für einen Ring."""
    if len(points) < 5:
        return points
    def dist(p, a, b):
        (x, y), (x1, y1), (x2, y2) = p, a, b
        dx, dy = x2 - x1, y2 - y1
        if dx == dy == 0:
            return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
        t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        return ((x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2) ** 0.5
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0, None
        for k in range(i + 1, j):
            d = dist(points[k], points[i], points[j])
            if d > best:
                best, idx = d, k
        if idx is not None and best > tol:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    out = [p for p, k in zip(points, keep) if k]
    return out if len(out) >= 4 else points

def round_ring(ring, crs):
    nd = 1 if crs == "EPSG:2056" else 6
    return [[round(x, nd), round(y, nd)] for x, y in ring]

def main():
    args = [a for a in sys.argv[1:] if a != "--skip-unmatched"]
    skip = len(args) != len(sys.argv) - 1
    name, src, attr, crs, cantons = args[:5]
    tol = float(args[5]) if len(args) > 5 and "=" not in args[5] else 0
    manual = dict(a.split("=", 1) for a in args[5:] if "=" in a)
    kgs = {}
    for kt in cantons.split(","):
        path = os.path.join(ROOT, "data-src", "kirchgemeinden", f"{kt}.json")
        if not os.path.exists(path):
            print(f"{kt}: noch keine Daten, übersprungen")
            continue
        data = json.load(open(path, encoding="utf-8"))
        for k in data["kirchgemeinden"]:
            kgs.setdefault(k["id"], k["name"])
    geo = json.load(open(src, encoding="utf-8"))
    features, problems = [], []
    for f in geo["features"]:
        label = f["properties"].get(attr)
        if label in manual:
            kg = manual[label]
        else:
            n = norm(label)
            hits = [i for i, kname in kgs.items()
                    if re.search(rf"(^| ){re.escape(n)}( |$)", norm(kname)) or norm(i.split("-", 1)[1].replace("-", " ")) == n]
            # bei mehreren Treffern den kürzesten Namen nehmen, wenn er eindeutig ist
            if len(hits) > 1:
                exact = [i for i in hits if norm(i.split("-", 1)[1].replace("-", " ")).endswith(n)]
                hits = exact if len(exact) == 1 else hits
            if len(hits) != 1:
                problems.append(f"{label!r}: {hits or 'kein Treffer'}")
                continue
            kg = hits[0]
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        polys = [[round_ring(simplify(r, tol), crs) if tol else round_ring(r, crs) for r in poly] for poly in polys]
        features.append({"type": "Feature", "properties": {"kg": kg, "name": label},
                         "geometry": {"type": "MultiPolygon", "coordinates": polys}})
    if problems:
        print("Nicht zugeordnet:\n  " + "\n  ".join(problems))
        if not skip:
            print("Mit name=id nachtragen oder --skip-unmatched.")
            sys.exit(1)
    out = os.path.join(ROOT, "data-src", "geo", f"{name}.geojson")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "crs": crs, "features": features}, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(features)} Polygone -> {out} ({os.path.getsize(out)} Bytes)")

if __name__ == "__main__":
    main()
