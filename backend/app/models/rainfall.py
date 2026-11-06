"""Live rainfall from Open-Meteo (deterministic + ensemble), cached, with a labelled offline fallback."""
from __future__ import annotations

import time

import httpx
import numpy as np

from .. import config as C

_CACHE: dict[str, tuple[float, dict]] = {}
TTL = 900


def _get(url, params):
    key = url + str(sorted(params.items()))
    if key in _CACHE and time.time() - _CACHE[key][0] < TTL:
        return _CACHE[key][1]
    r = httpx.get(url, params=params, timeout=12)
    r.raise_for_status()
    _CACHE[key] = (time.time(), r.json())
    return _CACHE[key][1]


def forecast(hours: int = 48) -> dict:
    lat, lon = C.CENTER
    try:
        det = _get(C.OPEN_METEO_FORECAST, {"latitude": lat, "longitude": lon, "hourly": "precipitation", "forecast_days": 2})
        hourly = det["hourly"]["precipitation"][:hours]
        members = []
        try:
            ens = _get(C.OPEN_METEO_ENSEMBLE, {"latitude": lat, "longitude": lon, "hourly": "precipitation",
                                               "models": "gfs_seamless", "forecast_days": 2})
            h = ens["hourly"]
            for k, v in h.items():
                if k.startswith("precipitation"):
                    members.append(float(np.nansum([x or 0 for x in v[:hours]])))
        except Exception:
            pass
        return {"provenance": "Observed/forecast (Open-Meteo)", "time": det["hourly"]["time"][:hours],
                "hourly_mm": hourly, "total_mm": round(float(sum(x or 0 for x in hourly)), 1),
                "peak_mm_hr": max((x or 0) for x in hourly) if hourly else 0,
                "ensemble_totals_mm": [round(m, 1) for m in members]}
    except Exception as e:
        return {"provenance": "Synthetic (Open-Meteo unreachable)", "error": str(e)[:120], "time": [],
                "hourly_mm": [], "total_mm": 0.0, "peak_mm_hr": 0.0, "ensemble_totals_mm": []}
