#!/usr/bin/env python3
"""Build the runtime register from the researched source files.

Input:  data-src/kirchgemeinden/<KT>.json         (full register with sources and open issues)
        data-src/kirchgemeinden/<KT>.canton.json  (cantons without a Kirchgemeinde register)
        data-src/geo/<bfs>.geojson                (optional: boundaries for split municipalities,
                                                   WGS84, every feature has properties.kg = id)
Output: data/kantone.json, data/kg/<KT>.json, data/geo/<bfs>.json

Usage: python3 -I tools/build-registry.py
"""
import json, os, glob, re, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src")
OUT = os.path.join(ROOT, "data")

CANTONS = {
    "ZH": "Zürich", "BE": "Bern", "LU": "Luzern", "UR": "Uri", "SZ": "Schwyz", "OW": "Obwalden",
    "NW": "Nidwalden", "GL": "Glarus", "ZG": "Zug", "FR": "Freiburg", "SO": "Solothurn",
    "BS": "Basel-Stadt", "BL": "Basel-Landschaft", "SH": "Schaffhausen", "AR": "Appenzell Ausserrhoden",
    "AI": "Appenzell Innerrhoden", "SG": "St. Gallen", "GR": "Graubünden", "AG": "Aargau",
    "TG": "Thurgau", "TI": "Tessin", "VD": "Waadt", "VS": "Wallis", "NE": "Neuenburg",
    "GE": "Genf", "JU": "Jura",
}

def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def dump(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

def norm(s):
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if not unicodedata.combining(c)).replace("ß", "ss")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

def plz_in(text):
    """PLZ in einem Ortsteil-Text, inkl. Bereichen wie «6003–6006»."""
    out = set()
    for a, b in re.findall(r"\b(\d{4})\s*[–-]\s*(\d{4})\b", text):
        out.update(str(p) for p in range(int(a), int(b) + 1))
    out.update(re.findall(r"\b(\d{4})\b", text))
    return out

def resolve_split(split, bfs, orte, gname):
    """Beschreibende Ortsteile in maschinenlesbare Regeln übersetzen.

    by_plz: PLZ der Gemeinde, die im Text ausdrücklich genannt ist
    by_ort: amtliche Ortschaft der Gemeinde, deren Name dem Ortsteil entspricht
    default: Kirchgemeinde für «übriges Gebiet» oder den Gemeindenamen selbst
    Mehrdeutige Treffer fallen weg; die Seite lässt dann wählen.
    """
    plzs = {o[0] for o in orte if o[2] == bfs}
    orts = {}
    for o in orte:
        if o[2] != bfs:
            continue
        orts[norm(o[1])] = o[1]
        # «Buchs LU», «Hasle b. Burgdorf», «Oberdorf NW» → auch ohne Zusatz auffindbar
        short = norm(re.sub(r"\s+(b\.|bei)\s.*$|\s+[A-Z]{2}$", "", o[1]))
        orts.setdefault(short, o[1])
    gkey = norm(re.sub(r"\s+[A-Z]{2}$|\s*\(.*\)$", "", gname))
    by_plz, by_ort, default, conflicts = {}, {}, None, set()
    def put(d, k, v):
        if k in d and d[k] != v:
            conflicts.add((id(d), k))
        d[k] = v
    for key, kg in (split.get("ortsteile") or {}).items():
        found = plz_in(key) & plzs
        for p in found:
            put(by_plz, p, kg)
        # Aufzählungen: «Willisau, Gettnau», «Kleinwangen und Lieli», «Willisau (inkl. Gettnau)»
        text = re.sub(r"[()]", ",", key)
        parts = [norm(re.sub(r"^\s*(inkl\.?|ehem\.?|ehemalige?)\s+", "", p)) for p in re.split(r",|/|;|\bund\b|\bsowie\b", text)]
        parts = [p for p in parts if p]
        for part in parts:
            if part in orts:
                put(by_ort, orts[part], kg)
        if "ubrig" in norm(key) or gkey in parts:
            default = kg if default in (None, kg) else False
    for d in (by_plz, by_ort):
        for k in [k for k in d if (id(d), k) in conflicts]:
            del d[k]
    return by_plz, by_ort, (default or None)

TECH = re.compile(r"Geodaten|Datensatz|Siedlungsverzeichnis|WFS|WMS|Polygon|Attribut|\bids?\b|Rasterstichprobe|GWR|Abgleich|abgeleitet|BFS|Gebäudeeingäng|Agent", re.I)
ABBR = ["z. B.", "u. a.", "St.", "Art.", "Abs.", "b.", "ca.", "Nr.", "bzw.", "inkl.", "ehem.", "evtl.", "Kath.", "röm.-kath.", "kath.", "Röm.-kath."]

def public_how(text):
    """Recherchenotiz in einen Text für Besucherinnen und Besucher verwandeln:
    Sätze mit Technikbegriffen und Quellen-Klammern (Steuerfusstabellen, Verzeichnisse) entfernen."""
    if not text:
        return ""
    t = text
    for a in ABBR:
        t = t.replace(a + " ", a.replace(" ", " ") + " ").replace(a, a.replace(" ", " "))
    t = re.sub(r"\s*\((?:[^()]*?(?:Steuerfuss|Steuereinheit|Verzeichnis|Grenzkarte|Ordnung Art|Siedlungsverzeichnis|laut |gemäss |vgl\.)[^()]*)\)", "", t)
    sentences = re.split(r"(?<=[.!?;])\s+(?=[A-ZÄÖÜ«])", t)
    keep = [s for s in sentences if not TECH.search(s) and not re.search(r"Steuerfuss(tabelle|verzeichnis)", s)]
    return " ".join(keep).replace(" ", " ").strip()

STREET = re.compile(r"\d|strasse|str\.|gasse|weg\b|platz|postfach|case postale|casella postale|rue\b|chemin|route|via\b|piazza|avenue|place\b|quai|rain\b|halde|matte?\b|pfarrhaus", re.I)

def has_street(postal):
    """Hat die Postadresse zwischen Name und PLZ/Ort eine Strasse oder ein Postfach?"""
    return any(STREET.search(line) for line in postal[1:-1])

PARISH_CO = re.compile(r"pfarr|pfarramt|pastoral|seelsorge|kath|paroiss|cure\b|parrocch|kirch|église|eglise|chiesa|secr|sekretariat|unité|unita", re.I)

def compact_postal(postal):
    """Empfänger für das Adressfeld: Name, Strasse/Postfach, PLZ Ort.

    Funktionszeilen (Kirchenrat, Kirchenpflege, Geschäftsstelle, Sekretariat, Conseil …) und
    «c/o Pfarrei …» fallen weg, weil sie das Adressfeld unnötig vergrössern. Ein c/o an eine externe
    Stelle (z. B. Treuhandfirma) bleibt, sonst kann die Post nicht zustellen.
    """
    middle = []
    for line in postal[1:-1]:
        if re.match(r"^c/o\b", line, re.I):
            rest = re.sub(r"^c/o\s*", "", line, flags=re.I)
            if re.search(r"\s\d+\s?[a-z]?$", rest) and STREET.search(rest) and len(rest.split()) <= 3:
                middle.append(rest)  # «c/o Postgasse 3» ist eine Strasse
            elif not PARISH_CO.search(line):
                middle.append(line)
        elif STREET.search(line):
            middle.append(line)
    return [postal[0], *middle, postal[-1]]

def canton_entry(kt, src, register):
    a = src.get("austritt", {})
    entry = {
        "name": CANTONS[kt],
        "register": register,
        "body": {k: src["body"].get(k) for k in ("name", "short", "website", "postal") if src["body"].get(k)},
        "austritt": {k: a.get(k) for k in ("recipient", "recipient_level", "form", "beglaubigung", "bistum_informiert", "public_hinweis",
                                           "public_hinweis_fr", "public_hinweis_it", "public_hinweis_en",
                                           "beglaubigung_note", "wirkung", "notes", "source", "brief") if a.get(k) not in (None, "")},
        "finder": src.get("finder"),
    }
    if not register:
        for key in ("summary", "summary_fr", "summary_it", "summary_en"):
            if src.get(key):
                entry[key] = src[key]
        entry["has_kirchensteuer"] = src.get("has_kirchensteuer")
    return entry

def main():
    kantone, stats = {}, []
    orte_data = load(os.path.join(OUT, "orte.json"))
    orte, gnames = orte_data["orte"], orte_data["gemeinden"]
    geo_sources = []
    for path in sorted(glob.glob(os.path.join(SRC, "geo", "*.geojson"))):
        g = load(path)
        geo_sources.append((g["crs"], g["features"]))
    for old in glob.glob(os.path.join(OUT, "geo", "*.json")):
        os.remove(old)
    for path in sorted(glob.glob(os.path.join(SRC, "kirchgemeinden", "*.json"))):
        name = os.path.basename(path)
        kt = name.split(".")[0]
        src = load(path)
        if name.endswith(".canton.json"):
            kantone[kt] = canton_entry(kt, src, register=False)
            continue
        kantone[kt] = canton_entry(kt, src, register=True)
        kg, gemeinden = {}, {}
        for k in src["kirchgemeinden"]:
            # Recherchenotizen (note) bleiben in data-src; die Seite zeigt nur public_note und
            # leitet ihre Hinweise sonst aus address_type und confidence ab
            note = k.get("public_note")
            # Kirchgemeinde eines anderen Kantons (z. B. sg-wil für Rickenbach TG): dort gelten dessen Regeln
            home = k["id"].split("-", 1)[0].upper()
            kg[k["id"]] = {key: val for key, val in {
                "n": k["name"], "p": compact_postal(k["postal"]), "t": k.get("address_type"), "e": k.get("email"),
                "w": k.get("website"), "s": k.get("source"), "c": k["confidence"], "note": note,
                "home": home if home != kt and home in CANTONS else None,
                "ns": True if not has_street(k["postal"]) else None,
                # Fusion mit Stichtag: alte Einträge gelten «bis», der Nachfolger «ab»; die Seite wählt nach Datum
                "ab": k.get("ab"), "bis": k.get("bis"), "nf": k.get("nachfolger"),
            }.items() if val not in (None, "", [])}
            for b in k.get("bfs", []) + k.get("partial_bfs", []):
                gemeinden.setdefault(str(b), []).append(k["id"])
        split = {}
        for s in src.get("split", []):
            b = str(s["bfs"])
            entry = {key: s.get(key) for key in ("finder",) if s.get(key)}
            how = s.get("public_how") or public_how(s.get("how"))
            if how:
                entry["how"] = how
            by_plz, by_ort, default = resolve_split(s, s["bfs"], orte, gnames[b][0])
            ids = set(gemeinden.get(b, []))
            for name, rule in (("plz", by_plz), ("ort", by_ort)):
                rule = dict(sorted((k, v) for k, v in rule.items() if v in ids))
                if rule:
                    entry[name] = rule
            if default in ids:
                entry["default"] = default
            # Grenzen: nur die Polygone der Kandidaten dieser Gemeinde, damit die Datei klein bleibt
            for crs, feats in geo_sources:
                mine = [f for f in feats if f["properties"]["kg"] in ids]
                if len({f["properties"]["kg"] for f in mine}) >= 2:
                    dump(os.path.join(OUT, "geo", f"{b}.json"), {"type": "FeatureCollection", "crs": crs, "features": mine})
                    entry["geo"] = f"data/geo/{b}.json"
                    if {f["properties"]["kg"] for f in mine} != ids:
                        entry["geo_partial"] = True
                    break
            split[b] = entry
        dump(os.path.join(OUT, "kg", f"{kt}.json"), {
            "canton": kt, "stand": src["stand"], "finder": src.get("finder"),
            "kg": kg, "gemeinden": dict(sorted(gemeinden.items(), key=lambda kv: int(kv[0]))), "split": split,
        })
        auto = sum(1 for e in split.values() if e.get("plz") or e.get("ort") or e.get("default") or e.get("geo"))
        stats.append(f"{kt}: {len(kg)} Kirchgemeinden, {len(gemeinden)} Gemeinden, {len(split)} geteilt ({auto} mit Regeln)")
    # Kirchensteuer-Angaben der ESTV für alle 26 Kantone; Kantone ohne Register bekommen register: null
    estv = load(os.path.join(SRC, "estv-kirchensteuern.json"))
    for kt, name in CANTONS.items():
        entry = kantone.setdefault(kt, {"name": name, "register": None})
        st = dict(estv["kantone"][kt])
        st.update(st.pop("aktuell", {}))  # neuere kantonale Regel geht der ESTV-Angabe von 2022 vor
        entry["steuer"] = st
    kantone["_steuerquelle"] = {"quelle": estv["quelle"], "url": estv["url"], "stand": estv["stand"]}
    dump(os.path.join(OUT, "kantone.json"), dict(sorted(kantone.items())))
    print("\n".join(stats))
    missing = sorted(set(CANTONS) - set(kantone))
    if missing:
        print("ohne Daten:", ", ".join(missing))

if __name__ == "__main__":
    main()
