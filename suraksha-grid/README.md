# Suraksha-Grid India: Backend & Temporal-Spatial Prediction Engine

> **Palantir Gotham / Foundry-style Predictive Crime Intelligence, Entity Resolution & Daily Spatio-Temporal Risk Forecasting**

---

## 1. Overview & System Architecture

Suraksha-Grid India integrates spatial crime statistics, First Information Report (FIR) narrative NLP, multi-hop knowledge graph queries, and machine learning spatio-temporal risk modeling into a unified high-performance FastAPI service.

```
[Open Data Sources: OpenCity / NCRB / OSM / Mock Ingestion]
                           │
                           ▼
           [Data Ingestion & Scraper Pipeline]
                           │
            ┌──────────────┴──────────────┐
            ▼                             ▼
   [PostgreSQL + PostGIS]        [Neo4j Aura Free Tier]
  (Spatial & Time-Series DB)    (Entity Graph / Multi-Hop)
            └──────────────┬──────────────┘
                           ▼
          [FastAPI Core Engine & NLP Extractor]
                           │
                           ▼
   [Daily Spatio-Temporal Predictor & Suspect Associate Network]
```

---

## 2. Project Directory Structure

```
suraksha-grid-backend/
├── .env.example            # Sample environment variables
├── requirements.txt        # Production Python dependencies
├── config.py               # Centralized configuration with environment fallbacks
├── scraper.py              # Ingestion pipeline for NCRB/OpenCity records into PostGIS
├── database.py             # Spatial clustering (PostGIS ST_DWithin & DBSCAN fallback)
├── graph.py                # Neo4j knowledge graph engine & multi-hop suspect network
├── nlp_engine.py           # spaCy FIR text parsing & Modus Operandi (MO) extraction
├── temporal_predictor.py   # Spatio-temporal ML forecasting (RandomForest + GradientBoosting)
├── main.py                 # FastAPI application & REST endpoint routes
└── tests/
    ├── test_backend.py     # Unit tests for NLP, predictor & scraper
    └── test_api.py         # End-to-end API integration tests for all endpoints
```

---

## 3. Quick Start & Setup

### Prerequisites
- Python 3.10+ (tested with Python 3.11)
- PostgreSQL with PostGIS (optional for local mock testing; automatically falls back gracefully)
- Neo4j Aura Free Tier or local Neo4j instance

### Step 1: Clone & Create Environment
```bash
cd suraksha-grid-backend
python -m venv .venv
source .venv/bin/activate   # On Windows: .venv\Scripts\activate
```

### Step 2: Install Dependencies & spaCy Model
```bash
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

### Step 3: Configure Environment
Copy `.env.example` to `.env` and configure your credentials:
```bash
cp .env.example .env
```

### Step 4: Run Tests
```bash
python tests/test_backend.py
python tests/test_api.py
```

### Step 5: Start the API Server
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Interactive Swagger documentation is available immediately at: **`http://localhost:8000/docs`**

---

## 4. API Endpoints Reference

### 1. Health & Component Status
- **`GET /`** - Service health check.
- **`GET /api/v1/status`** - Health matrix of PostgreSQL, Neo4j, spaCy, and ML models.

### 2. Spatial Analytics & Hotspots
- **`GET /api/v1/hotspots`**  
  Computes crime clusters using PostGIS `ST_DWithin` or haversine DBSCAN.  
  *Query Parameters:* `crime_type` (optional filter).
- **`GET /api/v1/temporal-summary`**  
  Aggregated hourly and day-of-week incident frequencies.
- **`GET /api/v1/city-hotzones`**  
  Graph-derived rankings of cities with highest active criminal operations.

### 3. Spatio-Temporal Risk Prediction
- **`POST /api/v1/predict/daily-slot`**  
  Predicts crime probability (0-100) and threat level for a coordinate and time.
  ```json
  {
    "latitude": 12.9716,
    "longitude": 77.5946,
    "target_datetime": "2026-06-15 22:30:00",
    "is_festival": 1,
    "is_payday": 1
  }
  ```
- **`POST /api/v1/predict/grid`**  
  Generates an $N \times N$ matrix of risk scores across a geographic bounding box for dashboard heatmaps.

### 4. Intelligence & Entity Resolution
- **`POST /api/v1/analyze-incident`**  
  Extracts Modus Operandi (MO) and cross-references active criminal syndicate networks.
  ```json
  {
    "fir_text": "Victim gold chain snatched near metro by two suspects riding black motorcycle with helmets.",
    "city": "Bengaluru",
    "suspect_alias": "Unknown (Black Helmet)",
    "vehicle_plate": "UNREGISTERED"
  }
  ```
- **`POST /api/v1/trace-vehicle`**  
  Performs multi-hop graph resolution across registration numbers, suspect aliases, and associated FIRs.
