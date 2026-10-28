#!/usr/bin/env python3
"""Eine Polygon-Tabelle aus einem GeoPackage als GeoJSON ausgeben (ohne GDAL).

Usage: python3 -I tools/gpkg-to-geojson.py <datei.gpkg> <tabelle> <attribut> > out.geojson
  z. B. ADMKG.gpkg (Kanton Bern, Kirchgemeinden) geodb.admkg_roemkath_vw kgname
Koordinaten bleiben im Bezugssystem der Tabelle (beim Kanton Bern LV95, EPSG:2056).
"""
import json, math, sqlite3, struct, sys

def arc(p0, p1, p2, steps=12):
    """Kreisbogen durch drei Punkte in Teilstrecken zerlegen (ohne Endpunkt)."""
    (ax, ay), (bx, by), (cx, cy) = p0, p1, p2
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-9:
        return [p0, p1]
    ux = ((ax**2 + ay**2) * (by - cy) + (bx**2 + by**2) * (cy - ay) + (cx**2 + cy**2) * (ay - by)) / d
    uy = ((ax**2 + ay**2) * (cx - bx) + (bx**2 + by**2) * (ax - cx) + (cx**2 + cy**2) * (bx - ax)) / d
    r = math.hypot(ax - ux, ay - uy)
    a0, a1, a2 = (math.atan2(y - uy, x - ux) for x, y in (p0, p1, p2))
    def ccw(a, b):
        return (b - a) % (2 * math.pi)
    sweep = ccw(a0, a2)
    if ccw(a0, a1) > sweep:  # Bogen läuft im Uhrzeigersinn
        sweep -= 2 * math.pi
    return [[ux + r * math.cos(a0 + sweep * i / steps), uy + r * math.sin(a0 + sweep * i / steps)] for i in range(steps)]

def read_wkb(buf, off=0):
    """WKB lesen. Gibt (Wert, Offset) zurück; Flächen als Liste von Polygonen, Kurven als Punktliste."""
    order = "<" if buf[off] == 1 else ">"
    gtype = struct.unpack_from(order + "I", buf, off + 1)[0]
    off += 5
    has_z = bool(gtype & 0x80000000) or 1000 <= (gtype & 0x0FFFFFFF) < 2000 or (gtype & 0x0FFFFFFF) >= 3000
    has_m = bool(gtype & 0x40000000) or 2000 <= (gtype & 0x0FFFFFFF) < 4000
    base = (gtype & 0x0FFFFFFF) % 1000
    dims = 2 + has_z + has_m
    def points(o):
        n = struct.unpack_from(order + "I", buf, o)[0]; o += 4
        pts = []
        for _ in range(n):
            xy = struct.unpack_from(order + "d" * dims, buf, o); o += 8 * dims
            pts.append([xy[0], xy[1]])
        return pts, o
    def count(o):
        return struct.unpack_from(order + "I", buf, o)[0], o + 4
    if base == 2:  # LineString
        return points(off)
    if base == 8:  # CircularString
        pts, off = points(off)
        out = []
        for i in range(0, len(pts) - 2, 2):
            out += arc(pts[i], pts[i + 1], pts[i + 2])
        return out + [pts[-1]], off
    if base == 9:  # CompoundCurve
        n, off = count(off)
        out = []
        for _ in range(n):
            seg, off = read_wkb(buf, off)
            out += seg if not out else seg[1:]
        return out, off
    if base == 3:  # Polygon
        n, off = count(off)
        rings = []
        for _ in range(n):
            r, off = points(off); rings.append(r)
        return [rings], off
    if base == 10:  # CurvePolygon
        n, off = count(off)
        rings = []
        for _ in range(n):
            r, off = read_wkb(buf, off); rings.append(r)
        return [rings], off
    if base in (6, 12):  # MultiPolygon, MultiSurface
        n, off = count(off)
        polys = []
        for _ in range(n):
            p, off = read_wkb(buf, off)
            polys += p
        return polys, off
    raise ValueError(f"Geometrietyp {gtype} nicht unterstützt")

def gpkg_geometry(blob):
    if blob[:2] != b"GP":
        raise ValueError("kein GeoPackage-Geometrieblob")
    flags = blob[3]
    env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(flags >> 1) & 0x07]
    polys, _ = read_wkb(blob, 8 + env)
    return polys

def main():
    path, table, attr = sys.argv[1:4]
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    srs = con.execute("select srs_id from gpkg_contents where table_name=?", (table,)).fetchone()[0]
    feats = []
    for geom, label in con.execute(f'select geometry, "{attr}" from "{table}"'):
        feats.append({"type": "Feature", "properties": {attr: label},
                      "geometry": {"type": "MultiPolygon", "coordinates": gpkg_geometry(geom)}})
    json.dump({"type": "FeatureCollection", "crs": f"EPSG:{srs}", "features": feats}, sys.stdout, ensure_ascii=False)

if __name__ == "__main__":
    main()
