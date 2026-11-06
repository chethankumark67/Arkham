"""Validation of the Tier 1 screen against BBMP / KGIS recorded flood points.

Hit rate  = share of BBMP points with a flooded cell (depth > 0.3 m) within `buffer_cells` cells.
Flagged   = share of the study area flagged under the same rule.
Lift      = hit rate / flagged share. A useless map that flags everything scores lift ~1; report both, always.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

from .. import config as C
from ..data import bbmp_points, grid_spec


def validate(depth: np.ndarray, buffer_cells: int = 1) -> dict:
    g = grid_spec()
    pts = bbmp_points()
    wet = depth > C.DEPTH_SLOW
    if buffer_cells:
        wet = ndimage.binary_dilation(wet, iterations=buffer_cells)
    r, c = g.rc([p["lat"] for p in pts], [p["lon"] for p in pts])
    hits = wet[r, c]
    flagged = float(wet.mean())
    by_layer = {}
    for layer in sorted({p["layer"] for p in pts}):
        m = np.array([p["layer"] == layer for p in pts])
        by_layer[layer] = {"points": int(m.sum()), "hit_rate": round(float(hits[m].mean()), 3)}
    hit_rate = float(hits.mean()) if len(pts) else 0.0
    return {
        "points": len(pts),
        "hits": int(hits.sum()),
        "hit_rate": round(hit_rate, 3),
        "area_flagged_share": round(flagged, 3),
        "lift_over_random": round(hit_rate / flagged, 2) if flagged else None,
        "buffer_m": round(buffer_cells * g.cell_m),
        "by_layer": by_layer,
        "missed": [p | {"hit": False} for p, h in zip(pts, hits) if not h][:50],
        "note": "BBMP lists are static inventories of flood-prone locations, not records of a single event.",
    }
