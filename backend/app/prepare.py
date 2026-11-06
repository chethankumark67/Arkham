"""Pre-compute terrain derivatives for the Tier 1 grid and save them to data/processed/terrain.npz."""
from __future__ import annotations

import time

import numpy as np

from . import config as C
from .data import grid_spec, load_dem_grid
from .models import terrain as T


def prepare() -> None:
    t = time.time()
    g = grid_spec()
    dem = load_dem_grid(g)
    filled = T.priority_flood(dem)
    rec = T.d8_receivers(filled)
    acc = T.accumulate(filled, rec)
    slope = T.slope_tan(dem, g.cell_m)
    stream_cells = 2_000_000 / (g.cell_m ** 2)  # channels start at ~2 km² catchment
    hand = T.relative_elevation(filled, rec, acc, stream_cells)
    sink = np.maximum(filled - dem, 0)  # depression depth: where water ponds
    C.PROCESSED.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(C.TERRAIN_NPZ, dem=dem, filled=filled.astype(np.float32), acc=acc.astype(np.float32),
                        slope=slope.astype(np.float32), hand=hand.astype(np.float32), sink=sink.astype(np.float32))
    print(f"terrain {g.rows}x{g.cols} cell={g.cell_m:.0f}m in {time.time()-t:.1f}s; "
          f"dem {dem.min():.0f}-{dem.max():.0f} m, max acc {acc.max():.0f} cells, max sink {sink.max():.1f} m")


if __name__ == "__main__":
    prepare()
