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


# ---------------------------------------------------------------------------------------------
# Ranking metrics + held-out split (used for calibration and for the numbers we report)
# ---------------------------------------------------------------------------------------------
def split_points(pts: list[dict]) -> tuple[list[dict], list[dict]]:
    """Deterministic 50/50 split of BBMP points into calibration / held-out sets (hash of rounded coords)."""
    cal, test = [], []
    for p in pts:
        h = (int(round(p["lat"] * 1e4)) * 7919 + int(round(p["lon"] * 1e4)) * 104729) % 2
        (cal if h == 0 else test).append(p)
    return cal, test


def _urban_mask() -> np.ndarray:
    """Negatives are drawn only from populated cells (≥ 1,000 people per cell), not empty farmland."""
    from ..data import population_grid
    pg = population_grid()
    return pg >= 1000 if pg is not None else np.ones(grid_spec().rows * grid_spec().cols, bool).reshape(grid_spec().rows, grid_spec().cols)


def ranking_metrics(depth: np.ndarray, pts: list[dict] | None = None) -> dict:
    """ROC-AUC of modelled depth separating BBMP flood cells from other urban cells, plus precision/recall/F1
    at the 0.3 m threshold (both with the same ±1-cell buffer as the hit rate)."""
    g = grid_spec()
    pts = bbmp_points() if pts is None else pts
    score = ndimage.maximum_filter(depth, size=3)            # ±1 cell, same tolerance as hit rate
    r, c = g.rc([p["lat"] for p in pts], [p["lon"] for p in pts])
    pos = np.zeros(depth.shape, bool)
    pos[r, c] = True
    pos_near = ndimage.binary_dilation(pos, iterations=1)
    urban = _urban_mask()
    neg = urban & ~pos_near
    sp, sn = score[pos], score[neg]
    # AUC = P(score_pos > score_neg) (+0.5 for ties), via ranks (Mann–Whitney U)
    allv = np.concatenate([sp, sn])
    ranks = _rankdata(allv)
    auc = (ranks[: len(sp)].sum() - len(sp) * (len(sp) + 1) / 2) / max(1, len(sp) * len(sn))
    flagged = score > C.DEPTH_SLOW
    tp = int(flagged[pos].sum())
    recall = tp / max(1, pos.sum())
    fl_urban = flagged & urban
    precision = float((fl_urban & pos_near).sum()) / max(1, fl_urban.sum())
    f1 = 2 * precision * recall / max(1e-9, precision + recall)
    share = float(fl_urban.sum()) / max(1, urban.sum())
    return {"roc_auc": round(float(auc), 3), "recall": round(float(recall), 3), "precision": round(precision, 3),
            "f1": round(float(f1), 3), "urban_area_flagged": round(share, 3),
            "lift": round(float(recall) / share, 2) if share else None,
            "positives": int(pos.sum()), "negatives": int(neg.sum())}


def _rankdata(a: np.ndarray) -> np.ndarray:
    order = a.argsort(kind="mergesort")
    ranks = np.empty(len(a))
    ranks[order] = np.arange(1, len(a) + 1)
    _, inv, cnt = np.unique(a, return_inverse=True, return_counts=True)   # average ranks for ties
    sums = np.bincount(inv, weights=ranks)
    return (sums / cnt)[inv]


def report(depth: np.ndarray) -> dict:
    """Headline validation: metrics on the held-out half of BBMP points (calibration half shown for reference)."""
    cal, test = split_points(bbmp_points())
    return {"held_out": ranking_metrics(depth, test), "calibration": ranking_metrics(depth, cal),
            "all_points": validate(depth), "split": {"calibration": len(cal), "held_out": len(test)},
            "note": "Model parameters were tuned on the calibration half only; held_out numbers are the honest estimate."}
