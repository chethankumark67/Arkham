# ARKHAM: City Digital Twin, Bengaluru

*Predict the risk. Break the cascade.*

ARKHAM is a decision twin for Bengaluru. It models where a storm floods the city, which roads and hospitals that breaks, and which interventions within a budget cut the damage most.

| Part | Stack |
|---|---|
| `frontend/` | React 19, TypeScript, Vite, MapLibre GL, deck.gl, PMTiles, Zustand |
| `backend/` | FastAPI; NumPy/SciPy and a Numba local-inertial solver; NetworkX and OSMnx; Rasterio (COG); Pillow |
| Infra (optional) | PostgreSQL + PostGIS (spatial queries, scenario run log); Redis (shared cache) |
| Deploy | Docker Compose; Fly.io or Render (API); Vercel (web) |

The original single-file dashboard is kept in `frontend/legacy/arkham-legacy.html` for reference. Its logic was ported to `frontend/src/engine/` with minimal changes.

## Run locally (no Docker)

```bash
# API
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scripts/fetch_data.py      # first run only: DEM, BBMP KMLs, OSM → terrain
python scripts/build_bundle.py    # compact deployable bundle (cropped DEM COG)
python scripts/export_tiles.py    # PMTiles vector tiles (needs `brew install tippecanoe`)
uvicorn app.main:app --port 8000  # docs: http://localhost:8000/docs

# Web
cd frontend && npm install && npm run dev   # http://localhost:5173
```

PostGIS and Redis are optional. To enable them, set `DATABASE_URL=postgresql://localhost/arkham` and `REDIS_URL=redis://localhost:6379/0` before starting the API; on startup the API seeds BBMP points, hospitals and roads into PostGIS. Without these variables the API falls back to in-memory caching and Python spatial queries.

## Crime Intelligence (Suraksha-Grid service)

`suraksha-grid/` is a separate FastAPI service: spaCy FIR/MO extraction, a Neo4j suspect graph, PostGIS hotspots and a RandomForest + GradientBoosting risk forecaster. Its data is the 10 mock FIRs in `scraper.py`. The React app shows it under **City Operations → Crime Intelligence**.

```bash
brew services start postgresql@17 neo4j            # local PostGIS + Neo4j
cd suraksha-grid && source .venv/bin/activate      # deps: pip install -r requirements.txt pytest; python -m spacy download en_core_web_sm
uvicorn main:app --port 8100                       # docs: http://localhost:8100/docs
```
- **Configuration:** `suraksha-grid/.env` holds local settings only: the `surakshagrid` database, `bolt://localhost:7687`, and a generated Neo4j password. It is git-ignored, and the archive's cloud credentials were deliberately not copied into it.
- **Pointing the web app elsewhere:** set `VITE_CRIME_API_URL` (or open the app with `?crime=`) to use a different Suraksha-Grid URL.

## Run with Docker

```bash
docker compose up --build        # web http://localhost:8080 · api http://localhost:8000/docs
```

## Deploy

```bash
# API → Fly.io (2 GB VM, Singapore region)
cd backend && fly auth login && fly launch --no-deploy --copy-config && fly deploy
# optional: fly postgres create && fly postgres attach (then CREATE EXTENSION postgis); fly redis create

# Web → Vercel (VITE_API_URL is set at build time)
cd frontend && vercel login && vercel --prod --build-env VITE_API_URL=https://<your-api>.fly.dev
```

`render.yaml` is an alternative to Fly. It provisions the API, Postgres and Key Value (Redis) together from a GitHub repo.

## Tests
- `cd backend && python -m pytest -q`: 19 tests covering the physics (mass conservation, Numba = numpy), API, optimizer, whole-city job, COG and PMTiles.
- `frontend`: `npx tsc --noEmit -p tsconfig.app.json && npm run build`.

See [backend/README.md](backend/README.md) for the models, data sources, API and known limits.
