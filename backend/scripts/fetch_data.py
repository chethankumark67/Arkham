"""Download all raw inputs into data/raw, then pre-compute terrain. Safe to re-run (skips existing files).

  python scripts/fetch_data.py
"""
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config as C  # noqa: E402

KML = {
    "vulnerable.kml": "a7d8a01f-1fbc-41e1-85f0-f15ea16b2d27/download/6b3c63b0-f461-4e9c-a2c2-006f734c5b41.kml",
    "flood_prone.kml": "d90fe768-caba-4c6e-b6b5-a75acd5e88a9/download/00fb1229-dcfd-4f59-813f-885e0c629add.kml",
    "low_lying.kml": "62ceac3b-f6e2-4dd1-ae9f-be80b1f2fda8/download/8e87a2fc-e014-4c6e-81f1-d5cb4db57a46.kml",
}
KML_BASE = "https://data.opencity.in/dataset/b03218ea-4b7c-4fa9-ab67-b9054d7ecc4c/resource/"
DEM = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{t}_E077_00_DEM/Copernicus_DSM_COG_10_{t}_E077_00_DEM.tif"
OVERPASS = ["https://maps.mail.ru/osm/tools/overpass/api", "https://overpass-api.de/api",
            "https://overpass.kumi.systems/api", "https://overpass.private.coffee/api"]


def dl(url, dest: Path):
    if dest.exists():
        print("skip", dest.name); return
    print("get ", dest.name)
    with httpx.stream("GET", url, follow_redirects=True, timeout=300) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)


def osm():
    if C.ROADS_GRAPHML.exists() and (C.RAW / "osm_health_facilities.geojson").exists():
        print("skip osm"); return
    import osmnx as ox
    ox.settings.overpass_rate_limit = False
    ox.settings.requests_timeout = 300
    bbox = (C.LON_MIN, C.LAT_MIN, C.LON_MAX, C.LAT_MAX)
    for url in OVERPASS:
        ox.settings.overpass_url = url
        try:
            t = time.time()
            if not C.ROADS_GRAPHML.exists():
                G = ox.graph_from_bbox(bbox, network_type="drive",
                                       custom_filter='["highway"~"motorway|trunk|primary|secondary|tertiary"]')
                ox.save_graphml(G, C.ROADS_GRAPHML)
            # all health facilities with footprints + tags; build_facilities.py keeps emergency-capable hospitals
            h = ox.features_from_bbox(bbox, {"amenity": ["hospital", "clinic", "doctors"], "healthcare": ["hospital"]})
            keep = [c for c in ["name", "amenity", "healthcare", "healthcare:speciality", "beds", "emergency",
                                "operator", "operator:type", "building", "geometry"] if c in h.columns]
            h[keep].reset_index(drop=True).to_file(C.RAW / "osm_health_facilities.geojson", driver="GeoJSON")
            print(f"osm ok via {url} in {time.time()-t:.0f}s"); return
        except Exception as e:
            print("overpass failed:", url, str(e)[:100])
    raise SystemExit("All Overpass mirrors failed; retry later.")


if __name__ == "__main__":
    C.RAW.mkdir(parents=True, exist_ok=True)
    for name, path in KML.items():
        dl(KML_BASE + path, C.RAW / name)
    for t in ("N12_00", "N13_00"):
        dl(DEM.format(t=t), C.RAW / f"dem_{t}.tif")
    osm()
    import subprocess
    subprocess.run([sys.executable, str(Path(__file__).parent / "build_facilities.py")], check=True)
    subprocess.run([sys.executable, str(Path(__file__).parent / "build_population.py")], check=True)
    from app.prepare import prepare
    prepare()
