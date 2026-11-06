"""Download GHSL GHS-POP 2025 (EC JRC, R2023A, 3 arc-second ≈ 90 m, EPSG:4326) and crop it to the study area.

Source: https://ghsl.jrc.ec.europa.eu/ghs_pop2023.php  (licence: CC BY 4.0, cite Schiavina et al. 2023)
Tile R8_C26 (10°×10°) covers Bengaluru. Output: data/processed/population.tif (~0.7 MB COG).
  python scripts/build_population.py
"""
import io
import sys
import tempfile
import zipfile
from pathlib import Path

import httpx
import numpy as np
import rasterio
from rasterio.windows import from_bounds

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config as C  # noqa: E402

URL = ("https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/"
       "GHS_POP_E2025_GLOBE_R2023A_4326_3ss/V1-0/tiles/GHS_POP_E2025_GLOBE_R2023A_4326_3ss_V1_0_R8_C26.zip")


def main():
    if C.POPULATION_TIF.exists():
        print("skip", C.POPULATION_TIF.name); return
    print("downloading GHSL tile (~170 MB)…")
    with tempfile.TemporaryDirectory() as tmp:
        with httpx.stream("GET", URL, follow_redirects=True, timeout=600) as r:
            r.raise_for_status()
            buf = io.BytesIO(b"".join(r.iter_bytes()))
        with zipfile.ZipFile(buf) as z:
            name = next(n for n in z.namelist() if n.endswith(".tif") and "/" not in n.strip("/"))
            z.extract(name, tmp)
        with rasterio.open(Path(tmp) / name) as s:
            w = from_bounds(C.LON_MIN, C.LAT_MIN, C.LON_MAX, C.LAT_MAX, s.transform).round_offsets().round_lengths()
            a = s.read(1, window=w).astype("float32")
            a[~np.isfinite(a) | (a < 0)] = 0
            prof = dict(driver="COG", height=a.shape[0], width=a.shape[1], count=1, dtype="float32", crs=s.crs,
                        transform=s.window_transform(w), compress="DEFLATE", predictor=3)
    C.PROCESSED.mkdir(parents=True, exist_ok=True)
    with rasterio.open(C.POPULATION_TIF, "w", **prof) as d:
        d.write(a, 1)
    print(f"wrote {C.POPULATION_TIF} · {a.sum():,.0f} people in the study area")


if __name__ == "__main__":
    main()
