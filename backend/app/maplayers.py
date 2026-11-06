"""Map-ready layers for the live map: coloured PNG rasters and GeoJSON features."""
from __future__ import annotations

import base64
import io

import numpy as np
from PIL import Image

from . import config as C

# depth (m) -> RGBA ramp: light blue (shallow) to deep navy; dry cells transparent
DEPTH_STOPS = [(0.05, (120, 190, 255, 90)), (0.3, (70, 150, 240, 170)), (0.7, (35, 95, 215, 205)),
               (1.5, (20, 50, 170, 230)), (3.0, (10, 20, 110, 245))]
PROB_STOPS = [(0.05, (255, 230, 120, 70)), (0.3, (254, 175, 60, 150)), (0.6, (240, 110, 40, 200)),
              (0.9, (210, 40, 40, 230))]


HEAT_STOPS = [(0.0, (255, 230, 120, 0)), (0.35, (255, 210, 90, 90)), (0.6, (250, 150, 50, 150)),
              (0.8, (235, 80, 35, 190)), (1.0, (180, 20, 30, 220))]
DRAIN_STOPS = [(0.0, (90, 210, 255, 0)), (0.01, (90, 210, 255, 150)), (1.0, (40, 160, 255, 255))]


def colorize(a: np.ndarray, stops) -> np.ndarray:
    rgba = np.zeros(a.shape + (4,), np.uint8)
    vals = np.array([s[0] for s in stops])
    cols = np.array([s[1] for s in stops], float)
    mask = a >= vals[0]
    x = np.clip(a[mask], vals[0], vals[-1])
    for ch in range(4):
        rgba[..., ch][mask] = np.interp(x, vals, cols[:, ch]).astype(np.uint8)
    return rgba


STOPS = {"depth": DEPTH_STOPS, "prob": PROB_STOPS, "heat": HEAT_STOPS, "drain": DRAIN_STOPS}


def png(a: np.ndarray, field: str = "depth", upscale: int = 2) -> bytes:
    img = Image.fromarray(colorize(a, STOPS[field]), "RGBA")
    if upscale > 1:
        img = img.resize((img.width * upscale, img.height * upscale), Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def png_data_url(a, field="depth", upscale=3) -> str:
    return "data:image/png;base64," + base64.b64encode(png(a, field, upscale)).decode()


def feature(geom_type, coords, **props):
    return {"type": "Feature", "geometry": {"type": geom_type, "coordinates": coords}, "properties": props}


def layers_geojson(res: dict, bbmp: list[dict], validation_rc) -> dict:
    """Closed/slowed roads, flooded hospitals, hotspots and BBMP points (hit / missed) as one FeatureCollection."""
    feats = []
    cas = res["cascade"]
    for s in cas.get("segments", []):
        feats.append(feature("LineString", [[lon, lat] for lat, lon in s["coords"]],
                             kind="road", state=s["state"], depth_m=s["depth_m"]))
    for h in cas.get("hospitals", []):
        feats.append(feature("Point", [h["lon"], h["lat"]], kind="hospital", name=h["name"],
                             depth_m=h["depth_m"], functional=h["functional"]))
    for i, hs in enumerate(res["hotspots"]):
        feats.append(feature("Point", [hs["lon"], hs["lat"]], kind="hotspot", rank=i + 1, **{
            k: v for k, v in hs.items() if k not in ("lat", "lon")}))
    wet = validation_rc
    for p, hit in zip(bbmp, wet):
        feats.append(feature("Point", [p["lon"], p["lat"]], kind="bbmp", name=p["name"], ward=p["ward"],
                             layer=p["layer"], hit=bool(hit)))
    return {"type": "FeatureCollection", "features": feats,
            "bounds": [[C.LAT_MIN, C.LON_MIN], [C.LAT_MAX, C.LON_MAX]]}
