"""Urban heat screening layer.

Spatial pattern = Open-Meteo daily max temperature on a 6x6 grid over the study area (observed/forecast),
bilinearly interpolated, plus an elevation lapse-rate correction from the DEM (-6.5 °C/km).
The field is then shifted so its city maximum equals the scenario peak temperature chosen in the UI.
Falls back to the lapse-rate pattern alone if Open-Meteo is unreachable (provenance says so).
"""
from __future__ import annotations

import time

import httpx
import numpy as np
from scipy.ndimage import zoom

from .. import config as C
from ..data import terrain

N = 6
_cache: dict = {}


def _openmeteo_grid():
    if "grid" in _cache and time.time() - _cache["grid"][0] < 3600:
        return _cache["grid"][1]
    lats = np.linspace(C.LAT_MAX, C.LAT_MIN, N)
    lons = np.linspace(C.LON_MIN, C.LON_MAX, N)
    la, lo = np.meshgrid(lats, lons, indexing="ij")
    r = httpx.get(C.OPEN_METEO_FORECAST, timeout=15, params={
        "latitude": ",".join(f"{x:.3f}" for x in la.ravel()), "longitude": ",".join(f"{x:.3f}" for x in lo.ravel()),
        "daily": "temperature_2m_max", "forecast_days": 1, "timezone": "Asia/Kolkata"})
    r.raise_for_status()
    js = r.json()
    vals = np.array([j["daily"]["temperature_2m_max"][0] for j in js], float).reshape(N, N)
    _cache["grid"] = (time.time(), vals)
    return vals


def field(peak_c: float) -> tuple[np.ndarray, dict]:
    dem = terrain()["dem"].astype(float)
    lapse = -6.5 * (dem - np.median(dem)) / 1000.0
    try:
        g = _openmeteo_grid()
        base = zoom(g, (dem.shape[0] / N, dem.shape[1] / N), order=1)[: dem.shape[0], : dem.shape[1]]
        prov = "Observed pattern (Open-Meteo daily max, 6x6 grid) + DEM lapse rate, scaled to scenario peak"
        live_max = float(g.max())
    except Exception:
        base = np.zeros_like(dem)
        prov = "Modelled: DEM lapse rate only (Open-Meteo unreachable), scaled to scenario peak"
        live_max = None
    t = base + lapse
    t = t - t.max() + peak_c
    return t, {"provenance": prov, "live_max_c": live_max, "peak_c": peak_c,
               "min_c": round(float(t.min()), 1), "share_within_1c_of_peak": round(float((t >= peak_c - 1).mean()), 3)}
