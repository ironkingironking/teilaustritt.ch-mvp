#!/usr/bin/env python3
"""ArcGIS-JSON (FeatureServer-Abfrage mit f=json) als GeoJSON ausgeben.

Usage: python3 -I tools/esrijson-to-geojson.py <quelle.json> <attribut> > out.geojson
  z. B. maps.fr.ch OpenData/Paroisses_catholiques (Kanton Freiburg), Attribut PAROISSE
Aussenringe sind im Uhrzeigersinn, Löcher im Gegenuhrzeigersinn; jedes Loch kommt zu dem
Aussenring, der seinen ersten Punkt enthält. Koordinaten bleiben im Bezugssystem der Quelle.
"""
import json, sys

def area(ring):
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1])) / 2

def inside(pt, ring):
    x, y, c = pt[0], pt[1], False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c

def main():
    src, attr = sys.argv[1:3]
    data = json.load(open(src, encoding="utf-8"))
    wkid = data.get("spatialReference", {}).get("latestWkid") or data.get("spatialReference", {}).get("wkid")
    feats = []
    for f in data["features"]:
        rings = [[p[:2] for p in r] for r in f["geometry"]["rings"]]
        outers = [[r] for r in rings if area(r) < 0]
        for hole in (r for r in rings if area(r) >= 0):
            owner = next((o for o in outers if inside(hole[0], o[0])), None)
            if owner:
                owner.append(hole)
        feats.append({"type": "Feature", "properties": {attr: f["attributes"][attr]},
                      "geometry": {"type": "MultiPolygon", "coordinates": outers}})
    json.dump({"type": "FeatureCollection", "crs": f"EPSG:{wkid}", "features": feats}, sys.stdout, ensure_ascii=False)

if __name__ == "__main__":
    main()
