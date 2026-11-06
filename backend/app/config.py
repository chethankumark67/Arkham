"""Static configuration: study area, grid, file paths, model constants."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"

# Study area (matches the frontend's BB constant): lat_min, lat_max, lon_min, lon_max
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 12.80, 13.20, 77.45, 77.85

# Tier 1 screening grid resolution in degrees (~165 m at Bengaluru's latitude)
GRID_DEG = 0.0015

# Bare-earth FABDEM (Copernicus with buildings & trees removed; Hawker et al. 2022, CC BY-NC-SA 4.0) when present,
# otherwise the raw Copernicus DSM tiles (development only; deployments use the cropped DEM_BBOX COG).
DEM_FILES = sorted(RAW.glob("fabdem_*.tif")) or sorted(RAW.glob("dem_*.tif"))
BBMP_KML = {
    "vulnerable": RAW / "vulnerable.kml",
    "flood_prone": RAW / "flood_prone.kml",
    "low_lying": RAW / "low_lying.kml",
}
ROADS_GRAPHML = RAW / "roads.graphml"
HOSPITALS_GEOJSON = RAW / "hospitals.geojson"
TERRAIN_NPZ = PROCESSED / "terrain.npz"
DEM_BBOX = PROCESSED / "dem_bbox.tif"
# GHSL GHS-POP R2023A, epoch 2025, 3 arc-second (~90 m), cropped to the study area (scripts/build_population.py)
POPULATION_TIF = PROCESSED / "population.tif"  # cropped COG used when the raw tiles are absent (deployments)

# Road failure thresholds (m of water), from the build spec
DEPTH_SLOW = 0.3
DEPTH_CLOSED = 0.7
# A node is "cut off" if its fastest route to a functioning hospital exceeds this
CUTOFF_MINUTES = 30.0

# Fallback only (used when data/processed/population.tif is missing): city total spread by a density gradient
CITY_POPULATION = 13_600_000

# Interventions: id, label, cost (₹ crore), effect parameters. Costs mirror the frontend INT array.
INTERVENTIONS = {
    "lakes": {"label": "Restore 3 lost lakes", "cost": 180},
    "desilt": {"label": "Desilt primary drains", "cost": 60},
    "pumps": {"label": "Add 12 pump stations", "cost": 45},
    "bellandur": {"label": "Widen Bellandur outfall", "cost": 90},
    "permeable": {"label": "Permeable pavements, 8 wards", "cost": 35},
}

# Lake / outfall locations used by interventions (lat, lon, radius_km). From the frontend LAKES list.
LAKE_SITES = [(12.93, 77.672, 2.5), (12.94, 77.742, 2.5), (13.045, 77.592, 2.0)]
BELLANDUR_OUTFALL = (12.926, 77.676, 4.0)

OPEN_METEO_ENSEMBLE = "https://ensemble-api.open-meteo.com/v1/ensemble"
OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast"
CENTER = (12.97, 77.59)
