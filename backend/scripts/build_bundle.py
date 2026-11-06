"""Build the compact deployable data bundle in data/processed:
  dem_bbox.tif  - Copernicus DEM cropped to the study area, Cloud-Optimized GeoTIFF (replaces the 80 MB tiles)
  terrain.npz   - Tier 1 terrain derivatives
Run after scripts/fetch_data.py.  python scripts/build_bundle.py
"""
import sys
from pathlib import Path

import rasterio
from rasterio.merge import merge

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config as C  # noqa: E402
from app.prepare import prepare  # noqa: E402

srcs = [rasterio.open(p) for p in C.DEM_FILES]
arr, tr = merge(srcs, bounds=(C.LON_MIN, C.LAT_MIN, C.LON_MAX, C.LAT_MAX))
prof = srcs[0].profile
for s in srcs:
    s.close()
prof.update(driver="COG", height=arr.shape[1], width=arr.shape[2], transform=tr, count=1, dtype="float32",
            compress="DEFLATE", predictor=3, BLOCKSIZE=512, OVERVIEWS="AUTO")
for k in ("blockxsize", "blockysize", "tiled", "interleave"):
    prof.pop(k, None)
C.PROCESSED.mkdir(parents=True, exist_ok=True)
with rasterio.open(C.DEM_BBOX, "w", **prof) as dst:
    dst.write(arr[0].astype("float32"), 1)
print("wrote", C.DEM_BBOX, round(C.DEM_BBOX.stat().st_size / 1e6, 1), "MB")
prepare()
