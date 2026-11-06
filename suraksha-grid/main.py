"""
main.py - Suraksha-Grid India – FastAPI Core Backend Engine v3.0

Endpoints:
  GET  /                             Health check
  GET  /api/v1/hotspots              Spatial crime hotspots
  GET  /api/v1/temporal-summary      Hour / day-of-week incident distribution
  GET  /api/v1/city-hotzones         Graph-derived city rankings
  POST /api/v1/predict/daily-slot    Single-point risk prediction
  POST /api/v1/predict/grid          Bounding-box grid risk heatmap
  POST /api/v1/analyze-incident      Full NLP + graph analysis of a new FIR
  POST /api/v1/trace-vehicle         Vehicle plate → linked suspects
  GET  /api/v1/status                System component health status
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import Any

import pandas as pd
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine

from config import API_HOST, API_PORT, API_RELOAD, DATABASE_URL
from database import compute_spatial_hotspots, get_temporal_summary
from graph import (
    close_driver,
    get_city_crime_hotzones,
    query_criminal_associates,
    sync_sql_to_neo4j,
    _GRAPH_AVAILABLE,
)
from nlp_engine import analyze_fir, extract_modus_operandi, nlp as _spacy_nlp
from scraper import fetch_and_ingest_public_data
from temporal_predictor import DailyCrimePredictor
from extensions import router as extensions_router, set_dataframe

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s – %(message)s",
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# App-level singletons
# ─────────────────────────────────────────────────────────────────────────────
engine    = create_engine(DATABASE_URL, pool_pre_ping=True)
predictor = DailyCrimePredictor()


# ─────────────────────────────────────────────────────────────────────────────
# Lifespan (startup / shutdown)
# ─────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Bootstrap data pipeline on startup; clean up on shutdown."""
    logger.info("=== Suraksha-Grid India: Starting up ===")

    # 1. Ingest / refresh data
    #    SURAKSHA_DATASET=synthetic -> ~1000 generated SYNTHETIC incidents (demo_data.py);
    #    otherwise the original 10 mock FIRs.
    if os.getenv("SURAKSHA_DATASET", "").lower() == "synthetic":
        from demo_data import generate_dataset
        df = fetch_and_ingest_public_data(custom_data=generate_dataset())
    else:
        df = fetch_and_ingest_public_data()

    # 2. NLP – annotate MO signatures
    df["mo"] = df["fir_text"].apply(extract_modus_operandi)

    # 3. Push to Neo4j knowledge graph
    try:
        sync_sql_to_neo4j(df)
    except Exception as exc:
        logger.warning("[STARTUP] Neo4j sync failed (non-fatal): %s", exc)

    # 4. Train ML predictor
    try:
        predictor.train_model(df)
    except Exception as exc:
        logger.warning("[STARTUP] Predictor training failed (rule-based fallback active): %s", exc)

    set_dataframe(df)  # in-memory copy for the read-only /api/v1 extension endpoints

    logger.info("=== Suraksha-Grid India: Ready ===")
    yield

    # Shutdown
    close_driver()
    logger.info("=== Suraksha-Grid India: Shutdown complete ===")


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI app
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Suraksha-Grid India – Predictive Crime Intelligence Engine",
    description=(
        "Palantir Gotham-style predictive crime intelligence, entity-resolution, "
        "and spatio-temporal risk forecasting for Indian cities."
    ),
    version="3.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(extensions_router)


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic request / response models
# ─────────────────────────────────────────────────────────────────────────────

class PredictionRequest(BaseModel):
    latitude:        float = Field(..., ge=-90,   le=90,   example=12.9716)
    longitude:       float = Field(..., ge=-180,  le=180,  example=77.5946)
    target_datetime: str   = Field(..., example="2026-06-15 21:00:00")
    is_festival:     int   = Field(0,  ge=0, le=1)
    is_payday:       int   = Field(0,  ge=0, le=1)


class GridPredictionRequest(BaseModel):
    lat_min:         float = Field(..., example=12.90)
    lat_max:         float = Field(..., example=13.05)
    lon_min:         float = Field(..., example=77.55)
    lon_max:         float = Field(..., example=77.65)
    target_datetime: str   = Field(..., example="2026-06-15 21:00:00")
    is_festival:     int   = Field(0,  ge=0, le=1)
    is_payday:       int   = Field(0,  ge=0, le=1)
    grid_steps:      int   = Field(5,  ge=2, le=20)


class IncidentRequest(BaseModel):
    fir_text:       str  = Field(..., min_length=5)
    city:           str  = Field("Unknown", example="Bengaluru")
    suspect_alias:  str  = Field("Unknown", example="Ravi_Kulla_Gang")
    vehicle_plate:  str  = Field("UNKNOWN", example="KA03AB9876")


class VehicleTraceRequest(BaseModel):
    vehicle_plate: str = Field(..., example="KA03AB9876")


# ─────────────────────────────────────────────────────────────────────────────
# Health & Status
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/", tags=["System"])
def root() -> dict[str, str]:
    return {
        "service": "Suraksha-Grid India",
        "version": "3.0.0",
        "status":  "operational",
        "docs":    "/docs",
    }


@app.get("/api/v1/status", tags=["System"])
def system_status() -> dict[str, Any]:
    """Return health status of each system component."""
    # PostgreSQL
    try:
        with engine.connect() as conn:
            count = conn.execute(
                __import__("sqlalchemy").text("SELECT COUNT(*) FROM crime_incidents")
            ).scalar()
        db_status = {"status": "connected", "incident_count": count}
    except Exception as exc:
        db_status = {"status": "error", "detail": str(exc)}

    return {
        "postgresql":    db_status,
        "neo4j":         {"status": "connected" if _GRAPH_AVAILABLE else "unavailable"},
        "spacy_nlp":     {"status": "loaded" if _spacy_nlp else "model_missing"},
        "ml_predictor":  {
            "status":      "trained" if predictor.is_trained else "rule_based",
            "cv_accuracy": predictor.cv_score,
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Hotspots & Analytics
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/v1/hotspots", tags=["Analytics"])
def get_predictive_hotspots(
    crime_type: str | None = Query(None, description="Filter by crime type, e.g. 'Chain Snatching'")
) -> dict[str, Any]:
    """
    Return spatially clustered crime hotspots.
    Uses PostGIS ST_DWithin when available; falls back to scikit-learn DBSCAN.
    """
    try:
        hotspots = compute_spatial_hotspots(engine)
        if crime_type:
            hotspots = [h for h in hotspots if crime_type.lower() in h.get("dominant_crime_type", "").lower()]
        return {"status": "success", "total_hotspots": len(hotspots), "data": hotspots}
    except Exception as exc:
        logger.error("[API] /hotspots error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/v1/temporal-summary", tags=["Analytics"])
def get_temporal_summary_endpoint() -> dict[str, Any]:
    """Return incident counts grouped by hour-of-day and day-of-week."""
    try:
        summary = get_temporal_summary(engine)
        return {"status": "success", "data": summary}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/v1/city-hotzones", tags=["Analytics"])
def get_city_hotzones() -> dict[str, Any]:
    """Graph-derived city-level crime frequency ranking."""
    try:
        hotzones = get_city_crime_hotzones()
        return {"status": "success", "data": hotzones}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# Prediction Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/v1/predict/daily-slot", tags=["Prediction"])
def get_daily_slot_prediction(payload: PredictionRequest) -> dict[str, Any]:
    """
    Predict crime risk for a single geographic point at a specific date/time.
    Returns a risk_score (0-100) and threat_level.
    """
    try:
        result = predictor.predict_risk_for_slot(
            lat=payload.latitude,
            lon=payload.longitude,
            target_datetime=payload.target_datetime,
            is_festival=payload.is_festival,
            is_payday=payload.is_payday,
        )
        return {"status": "success", "data": result}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.error("[API] /predict/daily-slot error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/v1/predict/grid", tags=["Prediction"])
def get_grid_prediction(payload: GridPredictionRequest) -> dict[str, Any]:
    """
    Generate a risk heatmap over a bounding box grid.
    Useful for map overlays in front-end dashboards.
    """
    try:
        grid_results = predictor.predict_grid(
            lat_min=payload.lat_min,
            lat_max=payload.lat_max,
            lon_min=payload.lon_min,
            lon_max=payload.lon_max,
            target_datetime=payload.target_datetime,
            is_festival=payload.is_festival,
            is_payday=payload.is_payday,
            grid_steps=payload.grid_steps,
        )
        return {
            "status":       "success",
            "grid_points":  len(grid_results),
            "data":         grid_results,
        }
    except Exception as exc:
        logger.error("[API] /predict/grid error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# Incident Analysis & Graph Intelligence
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/v1/analyze-incident", tags=["Intelligence"])
def analyze_new_incident(payload: IncidentRequest) -> dict[str, Any]:
    """
    Full-pipeline analysis of a newly reported FIR:
    1. NLP extracts MO signature + entities
    2. Graph queries for matching suspect networks
    3. Returns actionable cross-jurisdiction intelligence
    """
    try:
        nlp_result     = analyze_fir(payload.fir_text)
        mo_sig         = nlp_result["mo_signature"]
        suspect_leads  = query_criminal_associates(mo_sig)

        alert_level = "HIGH" if suspect_leads and suspect_leads[0].get("criminal_network") else "MEDIUM"

        return {
            "status":                   "success",
            "extracted_mo_signature":   mo_sig,
            "nlp_analysis":             nlp_result,
            "cross_jurisdiction_alert": {
                "level":   alert_level,
                "message": (
                    f"Pattern '{mo_sig}' matches incidents across "
                    f"{len(set(c for lead in suspect_leads for c in lead.get('active_cities', [])))} city(ies)."
                    if suspect_leads else
                    "No cross-jurisdiction pattern found in current dataset."
                ),
            },
            "suspect_leads": suspect_leads,
        }
    except Exception as exc:
        logger.error("[API] /analyze-incident error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/v1/trace-vehicle", tags=["Intelligence"])
def trace_vehicle_endpoint(payload: VehicleTraceRequest) -> dict[str, Any]:
    """
    Trace a vehicle registration plate to linked suspects and incident history.
    Queries the Neo4j knowledge graph for multi-hop associations.
    """
    from graph import trace_vehicle
    try:
        result = trace_vehicle(payload.vehicle_plate)
        return {"status": "success", "data": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=API_HOST,
        port=API_PORT,
        reload=API_RELOAD,
    )
