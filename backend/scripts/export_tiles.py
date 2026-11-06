"""Export static vector layers to PMTiles (needs `tippecanoe`, e.g. `brew install tippecanoe`).

Layers in data/tiles/arkham.pmtiles:
  roads     - OSM major road network (hw, name)
  bbmp      - BBMP / KGIS flood points (layer, name, ward, zone)
  hospitals - OSM hospitals (name)
  drainage  - DEM-derived drainage network (D8 receivers of cells with > 2 km^2 catchment; order = log catchment)
  python scripts/export_tiles.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.data import bbmp_points, grid_spec, hospitals, terrain  # noqa: E402
from app.models import cascade  # noqa: E402
from app.models.terrain import d8_receivers  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "data" / "tiles"


def fc(features):
    return {"type": "FeatureCollection", "features": features}


def pt(lon, lat, **p):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": p}


def main():
    if not shutil.which("tippecanoe"):
        raise SystemExit("tippecanoe not found: brew install tippecanoe")
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())

    net = cascade.network()
    G, seen, roads = net["G"], set(), []
    for u, v in net["edges"]:
        if (v, u) in seen:
            continue
        seen.add((u, v))
        d = G.edges[u, v]
        roads.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": d["sample"]},
                      "properties": {"hw": d["hw"], "name": d["name"] or ""}})
    layers = {
        "roads": fc(roads),
        "bbmp": fc([pt(p["lon"], p["lat"], layer=p["layer"], name=p["name"], ward=p["ward"] or "", zone=p["zone"] or "")
                    for p in bbmp_points()]),
        "hospitals": fc([pt(h["lon"], h["lat"], name=h["name"]) for h in hospitals()]),
    }
    t = terrain()
    g = grid_spec()
    rec = d8_receivers(t["filled"]).ravel()
    thresh = 2_000_000 / g.cell_m ** 2
    acc = t["acc"].ravel()
    lines = []
    for i in np.flatnonzero(acc >= thresh):
        j = rec[i]
        if j < 0:
            continue
        la1, lo1 = g.latlon(i // g.cols, i % g.cols)
        la2, lo2 = g.latlon(j // g.cols, j % g.cols)
        lines.append({"type": "Feature", "geometry": {"type": "LineString",
                      "coordinates": [[round(float(lo1), 5), round(float(la1), 5)], [round(float(lo2), 5), round(float(la2), 5)]]},
                      "properties": {"order": round(float(np.log10(acc[i] / thresh + 1)), 2)}})
    layers["drainage"] = fc(lines)

    args = ["tippecanoe", "-o", str(OUT / "arkham.pmtiles"), "--force", "-Z9", "-z15", "--drop-densest-as-needed",
            "--no-tile-size-limit", "--quiet"]
    for name, data in layers.items():
        f = tmp / f"{name}.geojson"
        f.write_text(json.dumps(data))
        args += ["-L", f"{name}:{f}"]
        print(f"{name}: {len(data['features'])} features")
    subprocess.run(args, check=True)
    print("wrote", OUT / "arkham.pmtiles", round((OUT / "arkham.pmtiles").stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
