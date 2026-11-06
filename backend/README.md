# ARKHAM backend — flood physics core for the Bengaluru digital twin

This FastAPI service sits behind `Arkham — City Digital Twin, Bengaluru (2).html`. It answers the three questions in the build spec:

1. **What will happen?** A Tier 1 city-wide flood screen with ensemble probability, plus a Tier 2 2D solver for individual hotspots.
2. **What breaks next?** Road closures, flooded hospitals, and people cut off from care.
3. **What should we do?** The best intervention portfolio within a budget, chosen by checking every combination.

## Run

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scripts/fetch_data.py        # downloads DEM, BBMP KMLs and OSM data, then builds terrain (~5 min; first run only)
uvicorn app.main:app --port 8000    # interactive docs at http://localhost:8000/docs
```

Open the HTML file. The header badge shows **● PHYSICS BACKEND** when the API is connected. If the API is down, the page uses its built-in synthetic model. To point the page at a different API, open it with `?api=https://host`.

Run the tests with `python -m pytest -q`.

## Live map

The Overview map is a Leaflet map with Esri satellite or CARTO dark tiles. No API keys are needed, but the browser must be online.

**Layers menu** (top bar):

| Layer | What it shows |
|---|---|
| Satellite | Esri imagery when on; CARTO dark when off |
| Buildings | OSM tiles drawn over the base map. Footprints appear from about zoom 15. |
| Road Network | OSM major roads (`/api/map/roads`), plus closed and slowed segments during a flood |
| Drainage | Drainage channels derived from the DEM, starting at a 2 km² catchment (`/api/map/drainage.png`) |
| Hazard Extent | **Flood**: modelled depth for each hour, with hotspots. **Heat**: Open-Meteo 6×6 grid of daily maximum temperature, corrected for elevation (`/api/map/heat.png`). **Other 6 hazards**: the frontend's geolocated synthetic assets, plotted by intensity. |
| Critical Facilities | All OSM hospitals (`/api/map/facilities`). Red means flooded in the flood scenario. |

**Interactions:**
- Click a point in the flood scenario to see the depth and probability there, then **Run Tier 2**.
- The clock, Run and Play animate the flood hour by hour.
- **▦ Static view** switches back to the original image.

## Data (all open)

| Input | Source | Provenance |
|---|---|---|
| Terrain | Copernicus GLO-30 (30 m), tiles N12/N13 E077 | Observed. This is a **DSM**: building heights are included. |
| Flood points | OpenCity: BBMP/KGIS layers for flood-vulnerable (200), flood-prone (70) and low-lying (129) locations; 391 after de-duplication | Observed |
| Roads | OpenStreetMap: roads from motorway to tertiary | Observed |
| Hospitals | OpenStreetMap health facilities (2,276), filtered by `scripts/build_facilities.py` to **842 emergency-capable hospitals: 240 major, 602 general**. Excluded: dental, eye, IVF, diagnostics, AYUSH, PHCs and clinics; each exclusion is kept with its reason in `health_facilities_excluded.geojson`. | Observed + rule-based filter |
| Rainfall | Open-Meteo forecast and ensemble | Observed/forecast |
| Population | **GHSL GHS-POP 2025** (EC JRC, R2023A, ~90 m, CC BY 4.0): 15.28 M people in the study area. Each cell is assigned to its nearest road junction for the cascade, and people in flooded cells are counted directly. | Observed (modelled grid product) |

## Models

- **Tier 1** (`models/flood.py`): a 267×267 grid with 163 m cells. Rain beyond the runoff and drain capacity is routed by flow accumulation and height above the nearest drainage, plus water that ponds in depressions. This is a *screening* model, not hydrodynamics.
- **Time**: the rainfall total is spread over a 6 h storm while the drains run continuously. Water builds up, peaks at about 5–6 h, then recedes. Channels clear first; depressions empty at 35% of the drain rate.
- **Validation** (`models/validation.py`): the 391 BBMP points are split into fixed calibration and held-out halves. Parameters were tuned on the calibration half only. **Held-out at 110 mm: ROC-AUC 0.73, recall 0.37, precision 0.19, lift 2.9× over the urban area flagged** (earlier uncalibrated model: 2.3×). Burning the BBMP 2022 stormwater drains into the terrain was tested and gave no held-out gain, so it isn't used. `GET /api/validation` returns the full report. BBMP lists are inventories of flood-prone spots, not dated events, so precision is a lower bound.
- **Cascade** (`models/cascade.py`): a NetworkX graph of the road network. Roads at 0.3 m depth slow to 25% speed and close at 0.7 m. Shortest paths are computed from every functioning hospital, and a place counts as cut off when the trip takes more than 30 minutes.
- **Optimizer** (`models/optimizer.py`): evaluates all 32 portfolios of the 5 interventions exactly, with costs matching the frontend's `INT` list.
- **Tier 2** (`models/solver.py`): the local-inertial scheme of Bates et al. (2010), which is LISFLOOD-FP's ACC method, on the native 30 m DEM.
  - A compiled Numba kernel is about 8× faster than the numpy reference, and both give the same results.
  - A flux limiter means no cell can send out more water in one step than it holds, which keeps the solver from creating water.
  - `models/citywide.py` runs the same solver over the whole study area.

## API

| Endpoint | What it returns |
|---|---|
| `GET /api/scenario?rain=&drain=&iv=lakes,desilt&detail=&probabilities=` | Flood summary, hotspots, validation and cascade in one call |
| `GET /api/flood/grid?field=depth\|prob` | Map overlay as a base64 uint8 raster (value/100) |
| `POST /api/flood/sample` | Depth and probability at named points |
| `GET /api/validation`, `GET /api/cascade` | One part of the scenario only |
| `GET /api/optimize?rain=&budget=` | Best portfolio, Pareto frontier, single interventions ranked |
| `GET /api/hotspot/simulate?lat=&lon=` | Tier 2: maximum depth grid and a time series |
| `GET /api/rainfall`, `GET /api/live` | Live Open-Meteo forecast, and the scenario it drives |
| `GET /api/domains[/{id}]` | The 12 domains. Climate, transport and economy use flood-core numbers; the rest are synthetic. |
| `GET /api/map/flood.png?rain=&iv=&hour=&field=depth\|prob` | Coloured flood raster for the live map (covers the `/api/meta` bbox) |
| `GET /api/map/heat.png?peak=`, `GET /api/heat` | Heat layer and its summary |
| `GET /api/map/drainage.png`, `GET /api/map/roads`, `GET /api/map/facilities` | Base layers for the live map |
| `GET /api/impact?rain=&drain=&iv=&budget=` | Data for the Impact Analysis page: key figures, hour-by-hour flood and cascade, BBMP zones, hospitals, roads, hotspots, sectors, interventions |
| `GET /api/timeline?rain=` | Flood area and maximum depth for each hour from 0 to 12 h |
| `GET /api/map/layers?rain=&iv=&hour=` | GeoJSON: closed/slowed roads, flooded hospitals, hotspots, BBMP points with hit/miss |
| `POST /api/citywide/run`, `GET /api/citywide/{job}` | Whole-city Tier 2 run as a background job (Numba, 60 m cells, about 6 s) |
| `GET /api/cog/flood.tif`, `GET /api/cog/citywide/{job}.tif` | Float32 Cloud-Optimized GeoTIFF exports for QGIS or ArcGIS |
| `GET /api/nearby?lat=&lon=&km=` | Hospitals, BBMP points and roads within a radius. Uses PostGIS when configured, otherwise Python. |
| `GET /api/runs` | Recent scenario runs (PostGIS log) |
| `GET /tiles/arkham.pmtiles` | Vector tiles with layers roads, bbmp, hospitals and drainage, served with HTTP Range support |
| `GET /api/bbmp-points`, `/api/hospitals`, `/api/meta`, `/api/health` | Reference data and status |

## Known limits (be upfront with judges)

- The DSM includes building heights, and lakes show up as flat water surfaces. A DTM, or a drain network burned into the terrain, would improve the 2× lift.
- `BASE_DRAIN_MM` (50 mm) and the runoff coefficient are assumptions that have not been calibrated against BBMP stormwater-drain data.
- The hospital tiers come from name, operator and footprint rules, because OSM almost never records bed counts. Matching against the NABH or Karnataka health facility registry would make them authoritative.
- The intervention effects (for example, lakes adding 40 mm of storage) are illustrative parameters.
