"""Tier 2 hotspot deep-dive: 2D local-inertial shallow-water solver (Bates, Horritt & Fewtrell 2010),
the same scheme as LISFLOOD-FP's ACC solver, vectorised in numpy on the native 30 m DEM.
"""
from __future__ import annotations

import numpy as np

from .. import config as C

G = 9.81
MANNING_N = 0.035  # urban surface roughness [VERIFY]
H_MIN = 1e-3


def dem_window(lat: float, lon: float, half_km: float = 1.5) -> tuple[np.ndarray, float]:
    import rasterio
    from rasterio.merge import merge

    dlat = half_km / 111.0
    dlon = half_km / (111.0 * np.cos(np.radians(lat)))
    srcs = [rasterio.open(p) for p in (C.DEM_FILES or [C.DEM_BBOX])]
    arr, tr = merge(srcs, bounds=(lon - dlon, lat - dlat, lon + dlon, lat + dlat))
    for s in srcs:
        s.close()
    dx = abs(tr.a) * 111_320 * np.cos(np.radians(lat))
    return arr[0].astype(np.float64), float(dx)


try:
    from numba import njit
    HAVE_NUMBA = True
except Exception:  # pragma: no cover
    HAVE_NUMBA = False


if HAVE_NUMBA:
    @njit(cache=True, fastmath=True)
    def _step(z, h, qx, qy, dx, dt, src, n2):
        rows, cols = z.shape
        for r in range(rows):
            for c in range(cols - 1):
                e1 = z[r, c] + h[r, c]; e2 = z[r, c + 1] + h[r, c + 1]
                hf = max(e1, e2) - max(z[r, c], z[r, c + 1])
                if hf > H_MIN:
                    q = qx[r, c]
                    q = (q - G * hf * dt * (e2 - e1) / dx) / (1 + G * dt * n2 * abs(q) / hf ** (7 / 3))
                    lim = (h[r, c] if q > 0 else h[r, c + 1]) * dx / (4 * dt)
                    qx[r, c] = max(-lim, min(lim, q))
                else:
                    qx[r, c] = 0.0
        for r in range(rows - 1):
            for c in range(cols):
                e1 = z[r, c] + h[r, c]; e2 = z[r + 1, c] + h[r + 1, c]
                hf = max(e1, e2) - max(z[r, c], z[r + 1, c])
                if hf > H_MIN:
                    q = qy[r, c]
                    q = (q - G * hf * dt * (e2 - e1) / dx) / (1 + G * dt * n2 * abs(q) / hf ** (7 / 3))
                    lim = (h[r, c] if q > 0 else h[r + 1, c]) * dx / (4 * dt)
                    qy[r, c] = max(-lim, min(lim, q))
                else:
                    qy[r, c] = 0.0
        hmax = 0.0
        for r in range(rows):
            for c in range(cols):
                div = 0.0
                if c < cols - 1: div -= qx[r, c]
                if c > 0: div += qx[r, c - 1]
                if r < rows - 1: div -= qy[r, c]
                if r > 0: div += qy[r - 1, c]
                v = h[r, c] + dt * (div / dx + src)
                if r == 0 or c == 0 or r == rows - 1 or c == cols - 1:
                    v = 0.0
                h[r, c] = v if v > 0 else 0.0
                if h[r, c] > hmax: hmax = h[r, c]
        return hmax


def simulate(z: np.ndarray, dx: float, rain_mm_hr: float, drain_mm_hr: float, minutes: float = 120,
             rain_minutes: float = 60, frames: int = 8, engine: str = "auto") -> dict:
    """engine: 'numba' (compiled kernel, default when available) or 'numpy' (vectorised reference)."""
    if engine == "numpy" or not HAVE_NUMBA:
        return _simulate_numpy(z, dx, rain_mm_hr, drain_mm_hr, minutes, rain_minutes, frames)
    z = np.ascontiguousarray(z, dtype=np.float64)
    h = np.zeros_like(z)
    qx = np.zeros((z.shape[0], z.shape[1] - 1)); qy = np.zeros((z.shape[0] - 1, z.shape[1]))
    t, t_end, hm = 0.0, minutes * 60, 0.0
    snap_every = t_end / frames; next_snap = snap_every
    snaps, series, hmax = [], [], np.zeros_like(z)
    rain = rain_mm_hr / 1000 / 3600; drain = drain_mm_hr / 1000 / 3600
    while t < t_end:
        dt = min(0.7 * dx / np.sqrt(G * max(hm, 0.01)), 10.0, t_end - t)
        src = (rain if t < rain_minutes * 60 else 0.0) - drain
        hm = _step(z, h, qx, qy, dx, dt, src, MANNING_N ** 2)
        np.maximum(hmax, h, out=hmax)
        t += dt
        if t >= next_snap - 1e-6:
            snaps.append(h.copy())
            series.append({"minute": round(t / 60, 1), "max_depth_m": round(float(hm), 3),
                           "wet_share": round(float((h > 0.1).mean()), 3)})
            next_snap += snap_every
    return {"hmax": hmax, "snapshots": snaps, "series": series, "engine": "numba"}


def _simulate_numpy(z: np.ndarray, dx: float, rain_mm_hr: float, drain_mm_hr: float, minutes: float = 120,
                    rain_minutes: float = 60, frames: int = 8) -> dict:
    h = np.zeros_like(z)
    qx = np.zeros((z.shape[0], z.shape[1] - 1))
    qy = np.zeros((z.shape[0] - 1, z.shape[1]))
    t, t_end = 0.0, minutes * 60
    snap_every = t_end / frames
    next_snap = snap_every
    snaps, series = [], []
    hmax = np.zeros_like(z)
    rain = rain_mm_hr / 1000 / 3600
    drain = drain_mm_hr / 1000 / 3600
    while t < t_end:
        dt = min(0.7 * dx / np.sqrt(G * max(h.max(), 0.01)), 10.0, t_end - t)
        eta = z + h
        # x-direction fluxes
        hf = np.maximum(eta[:, 1:], eta[:, :-1]) - np.maximum(z[:, 1:], z[:, :-1])
        wet = hf > H_MIN
        s = (eta[:, 1:] - eta[:, :-1]) / dx
        qx = np.where(wet, (qx - G * hf * dt * s) / (1 + G * dt * MANNING_N ** 2 * np.abs(qx) / np.maximum(hf, H_MIN) ** (7 / 3)), 0)
        lim = np.where(qx > 0, h[:, :-1], h[:, 1:]) * dx / (4 * dt)
        qx = np.clip(qx, -lim, lim)
        hf = np.maximum(eta[1:, :], eta[:-1, :]) - np.maximum(z[1:, :], z[:-1, :])
        wet = hf > H_MIN
        s = (eta[1:, :] - eta[:-1, :]) / dx
        qy = np.where(wet, (qy - G * hf * dt * s) / (1 + G * dt * MANNING_N ** 2 * np.abs(qy) / np.maximum(hf, H_MIN) ** (7 / 3)), 0)
        lim = np.where(qy > 0, h[:-1, :], h[1:, :]) * dx / (4 * dt)
        qy = np.clip(qy, -lim, lim)
        div = np.zeros_like(h)
        div[:, :-1] -= qx
        div[:, 1:] += qx
        div[:-1, :] -= qy
        div[1:, :] += qy
        src = (rain if t < rain_minutes * 60 else 0.0) - drain
        h = np.maximum(h + dt * (div / dx + src), 0)
        # open boundaries: let water leave the window
        h[0, :] = h[-1, :] = 0
        h[:, 0] = h[:, -1] = 0
        hmax = np.maximum(hmax, h)
        t += dt
        if t >= next_snap - 1e-6:
            snaps.append(h.copy())
            series.append({"minute": round(t / 60, 1), "max_depth_m": round(float(h.max()), 3),
                           "wet_share": round(float((h > 0.1).mean()), 3)})
            next_snap += snap_every
    return {"hmax": hmax, "snapshots": snaps, "series": series, "engine": "numpy"}
