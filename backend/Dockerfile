# ARKHAM API: FastAPI + numpy/numba physics. Ships the compact data bundle (~25 MB):
# data/processed (cropped DEM COG + terrain.npz), data/raw (OSM graph, hospitals, BBMP KMLs), data/tiles (PMTiles).
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 NUMBA_CACHE_DIR=/tmp/numba
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY scripts ./scripts
COPY data/processed ./data/processed
COPY data/raw ./data/raw
COPY data/tiles ./data/tiles
# warm the numba JIT cache at build time so the first Tier 2 request is fast
RUN python -c "import numpy as np; from app.models.solver import simulate; simulate(np.zeros((8,8)), 30.0, 10, 0, 1)"
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-1}"]
