"""
tests/test_api.py – Comprehensive End-to-End API Integration Tests
Tests all endpoints defined in main.py using Starlette TestClient.
"""

import sys
import os
import pytest
from starlette.testclient import TestClient

# Ensure root package is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app

client = TestClient(app)


def test_root():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "Suraksha-Grid India"
    assert data["status"] == "operational"


def test_system_status():
    response = client.get("/api/v1/status")
    assert response.status_code == 200
    data = response.json()
    assert "postgresql" in data
    assert "neo4j" in data
    assert "spacy_nlp" in data
    assert "ml_predictor" in data


def test_hotspots():
    response = client.get("/api/v1/hotspots")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "data" in data
    assert isinstance(data["data"], list)


def test_hotspots_filtered():
    response = client.get("/api/v1/hotspots?crime_type=Chain+Snatching")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"


def test_temporal_summary():
    response = client.get("/api/v1/temporal-summary")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "by_hour" in data["data"]
    assert "by_day" in data["data"]


def test_city_hotzones():
    response = client.get("/api/v1/city-hotzones")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert isinstance(data["data"], list)


def test_predict_daily_slot():
    payload = {
        "latitude": 12.9716,
        "longitude": 77.5946,
        "target_datetime": "2026-06-15 22:30:00",
        "is_festival": 1,
        "is_payday": 1
    }
    response = client.post("/api/v1/predict/daily-slot", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    pred = data["data"]
    assert 0.0 <= pred["risk_score"] <= 100.0
    assert pred["threat_level"] in ("Critical", "High", "Moderate", "Normal")
    assert pred["occasion_factors"]["is_festival"] is True


def test_predict_grid():
    payload = {
        "lat_min": 12.90,
        "lat_max": 13.00,
        "lon_min": 77.55,
        "lon_max": 77.65,
        "target_datetime": "2026-06-15 21:00:00",
        "is_festival": 0,
        "is_payday": 1,
        "grid_steps": 3
    }
    response = client.post("/api/v1/predict/grid", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["grid_points"] == 9
    assert len(data["data"]) == 9


def test_analyze_incident():
    payload = {
        "fir_text": "Victim gold chain snatched near metro station by two motorcycle riders wearing black helmets.",
        "city": "Bengaluru",
        "suspect_alias": "Unknown (Black Helmet)",
        "vehicle_plate": "UNREGISTERED"
    }
    response = client.post("/api/v1/analyze-incident", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "chain_snatching" in data["extracted_mo_signature"]
    assert "cross_jurisdiction_alert" in data
    assert "suspect_leads" in data


def test_trace_vehicle():
    payload = {
        "vehicle_plate": "KA03AB9876"
    }
    response = client.post("/api/v1/trace-vehicle", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "data" in data


if __name__ == "__main__":
    with TestClient(app) as test_client:
        test_root()
        test_system_status()
        test_hotspots()
        test_hotspots_filtered()
        test_temporal_summary()
        test_city_hotzones()
        test_predict_daily_slot()
        test_predict_grid()
        test_analyze_incident()
        test_trace_vehicle()
    print("[SUCCESS] All API endpoint tests passed.")
