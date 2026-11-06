"""Tier 1 city-wide flood screening.

Method (screening, not hydrodynamics):
  excess rain  = max(0, rain * runoff_coef - drain_capacity)              [mm, per cell]
  conveyance   = excess * K * (log acc / log acc_max)^1.5 * exp(-HAND / H0)  -> water collecting along drainage lines
  ponding      = min(depression depth, excess * P)                       -> water trapped in depressions
  depth        = conveyance + ponding                                     [m]
Probability = share of a rainfall ensemble in which depth exceeds 0.3 m.
Constants K, H0, P are screening parameters, tuned against BBMP flood points (see validation.py).
"""
from __future__ import annotations

import base64
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

from .. import config as C
from ..data import bbmp_points, grid_spec, haversine_km, terrain

K_CONVEY = 45.0
H0 = 2.0
P_POND = 12.0
BASE_DRAIN_MM = 50.0   # event depth the primary drain network clears at 100% capacity [VERIFY with BBMP SWD]
RUNOFF = 0.75          # impervious-dominated urban runoff coefficient
STORM_H = 6.0          # design storm duration (frontend rainfall is "mm / 6 h")
POND_DRAIN_FRAC = 0.35 # depressions empty slower than channels once the storm stops


def storm_fraction(hour: float) -> float:
    """Cumulative share of the storm's rain fallen by `hour` (smooth hyetograph peaking mid-storm)."""
    x = min(max(hour / STORM_H, 0.0), 1.0)
    return x * x * (3 - 2 * x)


@dataclass
class Scenario:
    rain_mm: float = 110.0
    drain_pct: float = 100.0
    interventions: list[str] = field(default_factory=list)
    hour: float | None = None  # hours since storm start; None = end-of-storm state (t = STORM_H)

    def key(self):
        h = None if self.hour is None else round(self.hour, 1)
        return (round(self.rain_mm, 1), round(self.drain_pct, 1), tuple(sorted(self.interventions)), h)


def _distance_mask(lat, lon, radius_km):
    g = grid_spec()
    la, lo = g.latlon(*np.indices((g.rows, g.cols)))
    return haversine_km(la, lo, lat, lon) <= radius_km


_MASKS: dict = {}


def _mask(name, lat, lon, r):
    if name not in _MASKS:
        _MASKS[name] = _distance_mask(lat, lon, r)
    return _MASKS[name]


def _core_mask():
    if "core" not in _MASKS:
        g = grid_spec()
        la, lo = g.latlon(*np.indices((g.rows, g.cols)))
        _MASKS["core"] = (la > 12.94) & (la < 13.02) & (lo > 77.54) & (lo < 77.65)
    return _MASKS["core"]


def depth_field(sc: Scenario, rain_mm: float | None = None) -> np.ndarray:
    """Depth (m) at time sc.hour. Water in = rain fallen so far x runoff; water out = drains running
    continuously (design capacity is the 6 h total). Channels drain at full rate after the storm,
    depressions at POND_DRAIN_FRAC of it, so ponds linger while streets clear."""
    t = terrain()
    rain = sc.rain_mm if rain_mm is None else rain_mm
    shape = t["dem"].shape
    runoff = np.full(shape, RUNOFF)
    drain = np.full(shape, BASE_DRAIN_MM * sc.drain_pct / 100.0)
    iv = set(sc.interventions)
    if "desilt" in iv:
        drain *= 1.3
    if "permeable" in iv:
        runoff[_core_mask()] -= 0.15
    if "bellandur" in iv:
        lat, lon, r = C.BELLANDUR_OUTFALL
        drain[_mask("bellandur", lat, lon, r)] += 25
    if "lakes" in iv:
        for i, (lat, lon, r) in enumerate(C.LAKE_SITES):
            drain[_mask(f"lake{i}", lat, lon, r)] += 40  # detention storage, mm equivalent
    h = STORM_H if sc.hour is None else max(0.0, sc.hour)
    water_in = rain * runoff * storm_fraction(h)
    out_ch = drain * h / STORM_H
    out_pond = drain * (min(h, STORM_H) + POND_DRAIN_FRAC * max(0.0, h - STORM_H)) / STORM_H
    excess_m = np.maximum(0.0, water_in - out_ch) / 1000.0
    pond_excess_m = np.maximum(0.0, water_in - out_pond) / 1000.0
    accn = np.log1p(t["acc"]) / np.log1p(t["acc"].max())
    convey = excess_m * K_CONVEY * accn ** 1.5 * np.exp(-t["hand"] / H0)
    pond = np.minimum(t["sink"], pond_excess_m * P_POND)
    depth = convey + pond
    if "pumps" in iv:
        # 12 pumps sited at the deepest cells of the no-pump scenario; each removes up to 0.4 m within ~500 m
        base = depth.copy()
        lab, _ = ndimage.label(base > C.DEPTH_SLOW)
        idx = ndimage.maximum_position(base, lab, range(1, lab.max() + 1)) if lab.max() else []
        idx = sorted(idx, key=lambda rc: -base[rc])[:12]
        relief = np.zeros(shape)
        for r, c in idx:
            relief[max(0, r - 3): r + 4, max(0, c - 3): c + 4] = 0.4
        depth = np.maximum(0, depth - relief)
    return np.clip(depth, 0, 4.0)


def ensemble_members(rain_mm: float, n: int = 16, sigma: float = 0.35, seed: int = 7) -> np.ndarray:
    """Synthetic ensemble around a deterministic rainfall total (used when live ensemble is unavailable)."""
    rng = np.random.default_rng(seed)
    return rain_mm * np.exp(rng.normal(-sigma ** 2 / 2, sigma, n))


def probability_field(sc: Scenario, members: np.ndarray) -> np.ndarray:
    exceed = np.zeros(terrain()["dem"].shape)
    for m in members:
        exceed += depth_field(sc, float(m)) > C.DEPTH_SLOW
    return exceed / len(members)


def hotspots(depth: np.ndarray, prob: np.ndarray | None = None, top: int = 15) -> list[dict]:
    g = grid_spec()
    lab, n = ndimage.label(depth > C.DEPTH_SLOW)
    if n == 0:
        return []
    ids = np.arange(1, n + 1)
    area = ndimage.sum(np.ones_like(depth), lab, ids) * (g.cell_m ** 2) / 1e6
    peak = ndimage.maximum(depth, lab, ids)
    pos = ndimage.maximum_position(depth, lab, ids)
    pts = bbmp_points()
    plat = np.array([p["lat"] for p in pts]) if pts else None
    out = []
    for i in np.argsort(-(peak * np.sqrt(area)))[:top]:
        r, c = pos[i]
        lat, lon = g.latlon(r, c)
        item = {"lat": round(float(lat), 5), "lon": round(float(lon), 5), "max_depth_m": round(float(peak[i]), 2),
                "area_km2": round(float(area[i]), 3),
                "probability": round(float(prob[r, c]), 2) if prob is not None else None}
        if pts:
            d = haversine_km(lat, lon, plat, np.array([p["lon"] for p in pts]))
            j = int(np.argmin(d))
            item["nearest_bbmp"] = {"name": pts[j]["name"], "ward": pts[j]["ward"], "km": round(float(d[j]), 2)}
        out.append(item)
    return out


def encode_grid(a: np.ndarray, scale: float) -> str:
    """uint8 row-major, base64. value = round(a * scale) clipped to 0..255."""
    return base64.b64encode(np.clip(np.round(a * scale), 0, 255).astype(np.uint8).tobytes()).decode()


def summary(depth: np.ndarray) -> dict:
    g = grid_spec()
    cell_km2 = g.cell_m ** 2 / 1e6
    return {
        "flooded_km2_gt_0_3m": round(float((depth > C.DEPTH_SLOW).sum() * cell_km2), 2),
        "flooded_km2_gt_0_7m": round(float((depth > C.DEPTH_CLOSED).sum() * cell_km2), 2),
        "max_depth_m": round(float(depth.max()), 2),
    }
