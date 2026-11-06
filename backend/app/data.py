"""Loading of raw inputs and the pre-computed terrain grid. Everything is cached in memory."""
from __future__ import annotations

import json
import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from . import config as C

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}


@dataclass
class Grid:
    lat0: float  # latitude of row 0 (north edge)
    lon0: float  # longitude of col 0 (west edge)
    deg: float
    rows: int
    cols: int

    @property
    def cell_m(self) -> float:
        return self.deg * 111_320 * math.cos(math.radians((C.LAT_MIN + C.LAT_MAX) / 2))

    def rc(self, lat, lon):
        r = np.floor((self.lat0 - np.asarray(lat)) / self.deg).astype(int)
        c = np.floor((np.asarray(lon) - self.lon0) / self.deg).astype(int)
        return np.clip(r, 0, self.rows - 1), np.clip(c, 0, self.cols - 1)

    def latlon(self, r, c):
        return self.lat0 - (np.asarray(r) + 0.5) * self.deg, self.lon0 + (np.asarray(c) + 0.5) * self.deg


def grid_spec() -> Grid:
    rows = int(round((C.LAT_MAX - C.LAT_MIN) / C.GRID_DEG))
    cols = int(round((C.LON_MAX - C.LON_MIN) / C.GRID_DEG))
    return Grid(C.LAT_MAX, C.LON_MIN, C.GRID_DEG, rows, cols)


def load_dem_grid(g: Grid) -> np.ndarray:
    """Mosaic the Copernicus DEM tiles and average-resample to the Tier 1 grid."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.merge import merge
    from rasterio.transform import from_origin

    srcs = [rasterio.open(p) for p in (C.DEM_FILES or ([C.DEM_BBOX] if C.DEM_BBOX.exists() else []))]
    if not srcs:
        raise FileNotFoundError("No DEM tiles in data/raw (run scripts/fetch_data.py)")
    res = srcs[0].res
    mosaic, transform = merge(srcs, bounds=(C.LON_MIN, C.LAT_MIN, C.LON_MAX, C.LAT_MAX), res=res)
    for s in srcs:
        s.close()
    from rasterio.warp import reproject

    out = np.zeros((g.rows, g.cols), np.float32)
    reproject(mosaic[0], out, src_transform=transform, src_crs="EPSG:4326",
              dst_transform=from_origin(g.lon0, g.lat0, g.deg, g.deg), dst_crs="EPSG:4326",
              resampling=Resampling.average)
    return out


@lru_cache
def terrain() -> dict:
    if not C.TERRAIN_NPZ.exists():
        from .prepare import prepare

        prepare()
    d = np.load(C.TERRAIN_NPZ)
    return {k: d[k] for k in d.files}


@lru_cache
def bbmp_points() -> list[dict]:
    """All BBMP / KGIS flood points from the three OpenCity KML layers."""
    pts = []
    for layer, path in C.BBMP_KML.items():
        if not path.exists():
            continue
        root = ET.parse(path).getroot()
        for pm in root.iter("{http://www.opengis.net/kml/2.2}Placemark"):
            coord = pm.find(".//k:coordinates", KML_NS)
            if coord is None:
                continue
            lon, lat = map(float, coord.text.strip().split(",")[:2])
            data = {sd.get("name"): (sd.text or "").strip() for sd in pm.iter("{http://www.opengis.net/kml/2.2}SimpleData")}
            nm = pm.find("k:name", KML_NS)
            name = data.get("LocationName") or (nm.text.strip() if nm is not None and nm.text else "") or f"{layer} point"
            if C.LAT_MIN <= lat <= C.LAT_MAX and C.LON_MIN <= lon <= C.LON_MAX:
                pts.append({"layer": layer, "name": name, "ward": data.get("WARD_NAME"), "zone": data.get("ZONE"),
                            "lat": round(lat, 6), "lon": round(lon, 6)})
    # de-duplicate points that appear in more than one layer (within ~20 m)
    seen, out = set(), []
    for p in pts:
        key = (round(p["lat"], 4), round(p["lon"], 4))
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


@lru_cache
def population_points() -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """GHSL population cells (lat, lon, people) inside the study area, or None if the raster is missing."""
    if not C.POPULATION_TIF.exists():
        return None
    import rasterio
    with rasterio.open(C.POPULATION_TIF) as s:
        a = s.read(1).astype(float)
        rows, cols = np.nonzero(a > 0)
        xs, ys = rasterio.transform.xy(s.transform, rows, cols)
    return np.asarray(ys), np.asarray(xs), a[rows, cols]


@lru_cache
def population_grid() -> np.ndarray | None:
    """People per Tier 1 grid cell (GHSL summed onto the 0.0015° grid), or None if the raster is missing."""
    pts = population_points()
    if pts is None:
        return None
    g = grid_spec()
    lat, lon, pop = pts
    r, c = g.rc(lat, lon)
    out = np.zeros((g.rows, g.cols))
    np.add.at(out, (r, c), pop)
    return out


@lru_cache
def hospitals() -> list[dict]:
    if not C.HOSPITALS_GEOJSON.exists():
        return []
    gj = json.loads(C.HOSPITALS_GEOJSON.read_text())
    out = []
    for f in gj["features"]:
        lon, lat = f["geometry"]["coordinates"][:2]
        p = f["properties"]
        out.append({"name": p.get("name") or "Hospital (unnamed)", "lat": lat, "lon": lon,
                    "tier": p.get("tier") or "general", "reason": p.get("reason")})
    return out


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * np.arcsin(np.sqrt(a))
