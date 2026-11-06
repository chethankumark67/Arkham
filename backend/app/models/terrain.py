"""Terrain derivatives on the Tier 1 grid: depression filling, D8 flow, flow accumulation.

Pure numpy + heapq so it runs on any Python without compiled hydrology packages.
"""
from __future__ import annotations

import heapq

import numpy as np

# D8 neighbour offsets
DR = np.array([-1, -1, -1, 0, 0, 1, 1, 1])
DC = np.array([-1, 0, 1, -1, 1, -1, 0, 1])
DIST = np.array([1.414, 1, 1.414, 1, 1, 1.414, 1, 1.414])


def priority_flood(dem: np.ndarray, eps: float = 1e-4) -> np.ndarray:
    """Barnes et al. (2014) priority-flood with epsilon so every cell drains to the edge."""
    rows, cols = dem.shape
    filled = dem.astype(np.float64).copy()
    closed = np.zeros(dem.shape, bool)
    pq: list[tuple[float, int, int]] = []
    for r in range(rows):
        for c in (0, cols - 1):
            heapq.heappush(pq, (filled[r, c], r, c)); closed[r, c] = True
    for c in range(1, cols - 1):
        for r in (0, rows - 1):
            heapq.heappush(pq, (filled[r, c], r, c)); closed[r, c] = True
    while pq:
        z, r, c = heapq.heappop(pq)
        for k in range(8):
            nr, nc = r + DR[k], c + DC[k]
            if 0 <= nr < rows and 0 <= nc < cols and not closed[nr, nc]:
                closed[nr, nc] = True
                if filled[nr, nc] <= z:
                    filled[nr, nc] = z + eps
                heapq.heappush(pq, (filled[nr, nc], nr, nc))
    return filled


def d8_receivers(filled: np.ndarray) -> np.ndarray:
    """Flat index of the steepest-descent neighbour for each cell (-1 at outlets)."""
    rows, cols = filled.shape
    pad = np.pad(filled, 1, constant_values=np.inf)
    best = np.zeros(filled.shape)
    rec = np.full(filled.shape, -1, dtype=np.int64)
    rr, cc = np.indices(filled.shape)
    for k in range(8):
        nb = pad[1 + DR[k]: 1 + DR[k] + rows, 1 + DC[k]: 1 + DC[k] + cols]
        slope = (filled - nb) / DIST[k]
        better = slope > best
        best = np.where(better, slope, best)
        nr, nc = rr + DR[k], cc + DC[k]
        rec = np.where(better, nr * cols + nc, rec)
    return rec


def accumulate(filled: np.ndarray, rec: np.ndarray, weight: np.ndarray | None = None) -> np.ndarray:
    """Upslope accumulation (cells, or summed weight) following D8 receivers."""
    flat_rec = rec.ravel()
    acc = (np.ones(filled.size) if weight is None else weight.ravel().astype(float).copy())
    order = np.argsort(-filled.ravel(), kind="stable")
    for i in order:
        j = flat_rec[i]
        if j >= 0:
            acc[j] += acc[i]
    return acc.reshape(filled.shape)


def slope_tan(dem: np.ndarray, cell_m: float) -> np.ndarray:
    gy, gx = np.gradient(dem, cell_m)
    return np.hypot(gx, gy)


def relative_elevation(filled: np.ndarray, rec: np.ndarray, acc: np.ndarray, stream_cells: float) -> np.ndarray:
    """Height above nearest drainage (HAND): elevation minus the elevation of the stream cell each cell drains to."""
    flat = filled.ravel()
    flat_rec = rec.ravel()
    stream = acc.ravel() >= stream_cells
    target = np.where(stream, np.arange(flat.size), -1)
    # Walk downhill in ascending elevation: a cell's stream target is its receiver's target.
    order = np.argsort(flat, kind="stable")
    for i in order:
        if target[i] < 0:
            j = flat_rec[i]
            target[i] = target[j] if j >= 0 and target[j] >= 0 else i
    hand = flat - flat[target]
    return np.maximum(hand, 0).reshape(filled.shape)
