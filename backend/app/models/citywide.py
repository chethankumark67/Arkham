"""Whole-city Tier 2: run the local-inertial solver over the full study area as a background job.

The 30 m DEM (~1450 x 1450 cells) is resampled to `res_m` (default 60 m) to keep a 2 h storm under a
minute on a laptop with the Numba kernel. Results are kept in memory, keyed by the run parameters.
"""
from __future__ import annotations

import threading
import time
import uuid

import numpy as np

from .. import config as C
from . import solver

JOBS: dict[str, dict] = {}
_lock = threading.Lock()


def _dem(res_m: float) -> tuple[np.ndarray, float]:
    import rasterio
    from rasterio.enums import Resampling

    src_path = C.DEM_BBOX if C.DEM_BBOX.exists() else None
    if src_path is None:
        from rasterio.merge import merge
        srcs = [rasterio.open(p) for p in C.DEM_FILES]
        arr, _ = merge(srcs, bounds=(C.LON_MIN, C.LAT_MIN, C.LON_MAX, C.LAT_MAX))
        for s in srcs:
            s.close()
        z = arr[0].astype(np.float64)
        native = 30.0
    else:
        with rasterio.open(src_path) as s:
            native = abs(s.transform.a) * 111_320 * np.cos(np.radians(13))
            f = native / res_m
            z = s.read(1, out_shape=(int(s.height * f), int(s.width * f)), resampling=Resampling.average).astype(np.float64)
            return z, res_m
    step = max(1, int(round(res_m / native)))
    z = z[: z.shape[0] // step * step, : z.shape[1] // step * step]
    z = z.reshape(z.shape[0] // step, step, z.shape[1] // step, step).mean(axis=(1, 3))
    return z, native * step


def start(rain_mm_hr: float, drain_mm_hr: float, minutes: float, res_m: float) -> str:
    key = (round(rain_mm_hr, 1), round(drain_mm_hr, 1), round(minutes), round(res_m))
    with _lock:
        for jid, j in JOBS.items():
            if j["key"] == key and j["status"] in ("running", "done"):
                return jid
        jid = uuid.uuid4().hex[:10]
        JOBS[jid] = {"key": key, "status": "running", "started": time.time(), "progress": 0.0}

    def work():
        try:
            z, dx = _dem(res_m)
            res = solver.simulate(z, dx, rain_mm_hr, drain_mm_hr, minutes, rain_minutes=min(60, minutes), frames=12)
            JOBS[jid].update(status="done", hmax=res["hmax"], snapshots=res["snapshots"], series=res["series"],
                             cell_m=dx, shape=z.shape, engine=res["engine"],
                             seconds=round(time.time() - JOBS[jid]["started"], 1))
        except Exception as e:  # pragma: no cover
            JOBS[jid].update(status="error", error=str(e)[:300])

    threading.Thread(target=work, daemon=True).start()
    return jid
