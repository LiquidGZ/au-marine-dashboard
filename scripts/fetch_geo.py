#!/usr/bin/env python3
"""
fetch_geo.py — download the map layers listed in the workbook's GeoSources sheet (site/data/geo_sources.json).

    python scripts/build_data.py      # first, so geo_sources.json reflects the workbook
    python scripts/fetch_geo.py       # writes site/data/geo/<out_name>

Layer types (GeoSources.type)
  static                 file already in site/data/geo (EEZ / 12 nm / 3 nm lines); nothing to download
  arcgis_featureserver   an ArcGIS FeatureServer or MapServer root URL. Every polygon / line layer in the
                         service is queried (where = GeoSources.where, default 1=1), paged, converted to
                         GeoJSON in WGS84, and written to one file with the layer name in properties._layer.
                         A URL ending in /<layer id> fetches that layer only.
  telegeography          submarine cables that land in Australia, plus landing points
                         (TeleGeography public API, display only)

Seeded layers
  Offshore wind areas: Geoscience Australia "Offshore Renewable Energy Infrastructure Regions"
    https://services1.arcgis.com/wfNKYeHsOyaFyPw3/arcgis/rest/services/OffshoreRenewable_Energy_Infrastructure_Regions/FeatureServer
  To add a layer (marine parks, petroleum titles, pipelines…), add a GeoSources row with its ArcGIS service URL.

Standard library only. A layer that fails keeps its previous file; the build never fails because of a map layer.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")
OUT = os.path.join(DATA, "geo")
UA = "au-marine-dashboard/1.0 (+python-urllib)"
TIMEOUT = 120
PAGE = 1000


def get_json(url, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,*/*"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                data = json.loads(r.read().decode("utf-8"))
            if isinstance(data, dict) and "error" in data:
                raise RuntimeError("ArcGIS error: " + json.dumps(data["error"])[:300])
            return data
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (attempt + 1))
    raise last


def rnd(c, nd=4):
    if isinstance(c, (int, float)):
        return round(c, nd)
    return [rnd(x, nd) for x in c]


def esri_geom(g):
    if not g:
        return None
    if "x" in g:
        return {"type": "Point", "coordinates": [g["x"], g["y"]]}
    if "paths" in g:
        return {"type": "MultiLineString", "coordinates": g["paths"]}
    if "rings" in g:
        return {"type": "Polygon", "coordinates": g["rings"]}
    return None


def query_layer(base, lid, where):
    feats, offset = [], 0
    while True:
        params = {"where": where or "1=1", "outFields": "*", "outSR": 4326, "returnGeometry": "true",
                  "resultOffset": offset, "resultRecordCount": PAGE, "geometryPrecision": 4}
        url = f"{base}/{lid}/query?" + urllib.parse.urlencode(params)
        try:
            data = get_json(url + "&f=geojson")
            page = data.get("features", [])
        except Exception:  # noqa: BLE001 — some servers refuse f=geojson; fall back to Esri JSON
            data = get_json(url + "&f=json")
            page = [{"type": "Feature", "geometry": esri_geom(f.get("geometry")), "properties": f.get("attributes", {})} for f in data.get("features", [])]
        feats += page
        if not data.get("exceededTransferLimit") and not (data.get("properties") or {}).get("exceededTransferLimit"):
            break
        if len(page) < 1:
            break
        offset += len(page)
    return feats


def fetch_arcgis(spec):
    url = spec["url"].rstrip("/")
    tail = url.rsplit("/", 1)[-1]
    if tail.isdigit():
        base, layers = url.rsplit("/", 1)[0], [{"id": int(tail), "name": spec.get("name_en")}]
    else:
        base = url
        info = get_json(base + "?f=json")
        layers = [l for l in info.get("layers", []) if (l.get("geometryType") or "esriGeometryPolygon") in ("esriGeometryPolygon", "esriGeometryPolyline")]
    feats = []
    for l in layers:
        try:
            got = query_layer(base, l["id"], spec.get("where"))
        except Exception as e:  # noqa: BLE001
            print(f"  layer {l['id']} ({l.get('name')}): {type(e).__name__}: {str(e)[:120]}", file=sys.stderr)
            continue
        for f in got:
            if not f.get("geometry"):
                continue
            f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
            props = {k: v for k, v in (f.get("properties") or {}).items() if not str(k).lower().startswith(("shape", "objectid", "globalid", "fid"))}
            props["_layer"] = l.get("name")
            feats.append({"type": "Feature", "geometry": f["geometry"], "properties": props})
        print(f"  layer {l['id']:>3} {str(l.get('name'))[:50]:50s} {len(got):5d} features")
    return feats


def fetch_telegeography(spec):
    tg = (spec.get("url") or "https://www.submarinecablemap.com/api/v3/").rstrip("/")
    country = get_json(tg + "/country/australia.json", 2)
    ids = {c["id"] for c in country.get("cables", [])}
    geo = get_json(tg + "/cable/cable-geo.json", 2)
    lps = get_json(tg + "/landing-point/landing-point-geo.json", 2)
    feats = [{"type": "Feature", "geometry": {**f["geometry"], "coordinates": rnd(f["geometry"]["coordinates"])}, "properties": {"kind": "cable", **f["properties"]}}
             for f in geo.get("features", []) if f.get("properties", {}).get("id") in ids and f.get("geometry")]
    feats += [{"type": "Feature", "geometry": f["geometry"], "properties": {"kind": "landing_point", **f["properties"]}}
              for f in lps.get("features", []) if "Australia" in (f.get("properties", {}).get("name") or "")]
    return feats


def main():
    try:
        with open(os.path.join(DATA, "geo_sources.json"), encoding="utf-8") as fh:
            sources = json.load(fh)
    except OSError:
        sys.exit("site/data/geo_sources.json not found — run scripts/build_data.py first")
    os.makedirs(OUT, exist_ok=True)
    for s in sources:
        if not s.get("enabled", True) or s.get("type") == "static":
            continue
        print(f"{s['layer_id']}: {s.get('type')} {s.get('url')}")
        try:
            feats = fetch_arcgis(s) if s["type"].startswith("arcgis") else fetch_telegeography(s) if s["type"] == "telegeography" else None
        except Exception as e:  # noqa: BLE001
            print(f"  FAILED {type(e).__name__}: {str(e)[:200]} — keeping the previous file", file=sys.stderr)
            continue
        if not feats:
            print("  no features — keeping the previous file", file=sys.stderr)
            continue
        path = os.path.join(OUT, s["out_name"])
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"type": "FeatureCollection", "name": s["layer_id"],
                       "metadata": {"source": s.get("url"), "note": s.get("note"), "retrieved": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                       "features": feats}, fh, ensure_ascii=False, separators=(",", ":"))
        print(f"  wrote {s['out_name']} {len(feats)} features {os.path.getsize(path)/1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
