"""
tests/test_backend.py – Lightweight integration tests for Suraksha-Grid Backend
Run with: pytest tests/ -v  (no PostgreSQL or Neo4j required)
"""

import sys
import os

# Allow imports from parent directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ─────────────────────────────────────────────────────────────────────────────
# NLP Engine Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_extract_mo_chain_snatching():
    from nlp_engine import extract_modus_operandi
    result = extract_modus_operandi(
        "Victim's gold chain snatched near metro by two riders on a black motorcycle."
    )
    assert result == "chain_snatching_motorcycle", f"Unexpected MO: {result}"


def test_extract_mo_vehicle_theft():
    from nlp_engine import extract_modus_operandi
    result = extract_modus_operandi(
        "Honda Activa stolen from parking lot using master key bypass."
    )
    assert result == "vehicle_theft_master_key", f"Unexpected MO: {result}"


def test_extract_mo_commercial_burglary():
    from nlp_engine import extract_modus_operandi
    result = extract_modus_operandi(
        "Commercial storefront shutter jacked open using hydraulic jack at 3 AM."
    )
    assert result == "commercial_burglary_shutter", f"Unexpected MO: {result}"


def test_extract_mo_empty_text():
    from nlp_engine import extract_modus_operandi
    result = extract_modus_operandi("")
    assert result == "general_property_crime"


def test_analyze_fir_night_crime():
    from nlp_engine import analyze_fir
    result = analyze_fir("Chain snatching at night near metro station by bike riders.")
    assert result["is_night_crime"] is True
    assert result["mo_signature"] == "chain_snatching_motorcycle"


def test_analyze_fir_weapon():
    from nlp_engine import analyze_fir
    result = analyze_fir("Victim stabbed with a knife during robbery.")
    assert result["weapon_mentioned"] is True


# ─────────────────────────────────────────────────────────────────────────────
# Temporal Predictor Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_rule_based_prediction_night_festival():
    from temporal_predictor import DailyCrimePredictor
    p = DailyCrimePredictor()  # untrained → rule-based
    result = p.predict_risk_for_slot(
        lat=12.9716, lon=77.5946,
        target_datetime="2026-06-01 22:00:00",
        is_festival=1,
        is_payday=1,
    )
    assert "risk_score" in result
    assert result["risk_score"] > 50, "Night + festival + payday should be high risk"
    assert result["threat_level"] in ("Critical", "High")


def test_rule_based_prediction_daytime_normal():
    from temporal_predictor import DailyCrimePredictor
    p = DailyCrimePredictor()
    result = p.predict_risk_for_slot(
        lat=12.9716, lon=77.5946,
        target_datetime="2026-06-01 10:00:00",
        is_festival=0,
        is_payday=0,
    )
    assert result["risk_score"] < 60, "Daytime normal should be lower risk"


def test_trained_model_prediction():
    import pandas as pd
    from temporal_predictor import DailyCrimePredictor

    df = pd.DataFrame({
        "incident_id":   ["I1", "I2", "I3", "I4", "I5", "I6"],
        "latitude":      [12.97, 12.93, 12.30, 12.97, 13.33, 12.98],
        "longitude":     [77.59, 77.62, 76.65, 77.59, 77.10, 77.60],
        "timestamp":     [
            "2026-06-01 21:30:00", "2026-06-01 23:15:00",
            "2026-06-02 22:00:00", "2026-06-03 20:00:00",
            "2026-06-03 03:30:00", "2026-06-04 21:00:00",
        ],
        "is_festival":   [0, 0, 1, 0, 0, 1],
        "is_payday":     [1, 1, 0, 1, 0, 0],
    })

    p = DailyCrimePredictor()
    p.train_model(df)
    assert p.is_trained

    result = p.predict_risk_for_slot(
        lat=12.9716, lon=77.5946,
        target_datetime="2026-06-15 22:00:00",
        is_festival=1,
        is_payday=1,
    )
    assert 0.0 <= result["risk_score"] <= 100.0
    assert result["prediction_method"] == "ensemble_rf_gb"
    assert "top_risk_drivers" in result


def test_grid_prediction_shape():
    import pandas as pd
    from temporal_predictor import DailyCrimePredictor

    df = pd.DataFrame({
        "incident_id": ["I1", "I2", "I3", "I4", "I5"],
        "latitude":    [12.97, 12.93, 12.30, 12.97, 13.33],
        "longitude":   [77.59, 77.62, 76.65, 77.59, 77.10],
        "timestamp":   [
            "2026-06-01 21:30:00", "2026-06-01 23:15:00",
            "2026-06-02 22:00:00", "2026-06-03 20:00:00",
            "2026-06-03 03:30:00",
        ],
        "is_festival": [0, 0, 1, 0, 0],
        "is_payday":   [1, 1, 0, 1, 0],
    })

    p = DailyCrimePredictor()
    p.train_model(df)
    grid = p.predict_grid(
        lat_min=12.90, lat_max=13.00,
        lon_min=77.55, lon_max=77.65,
        target_datetime="2026-06-15 21:00:00",
        grid_steps=3,
    )
    assert len(grid) == 9  # 3x3 grid


# ─────────────────────────────────────────────────────────────────────────────
# Scraper Tests (no DB needed)
# ─────────────────────────────────────────────────────────────────────────────

def test_mock_data_structure():
    from scraper import MOCK_INCIDENTS
    assert "incident_id" in MOCK_INCIDENTS
    assert "fir_text" in MOCK_INCIDENTS
    assert "latitude" in MOCK_INCIDENTS
    assert len(MOCK_INCIDENTS["incident_id"]) == len(MOCK_INCIDENTS["latitude"])


if __name__ == "__main__":
    # Run as plain script for quick manual checks
    test_extract_mo_chain_snatching()
    test_extract_mo_vehicle_theft()
    test_extract_mo_commercial_burglary()
    test_extract_mo_empty_text()
    test_analyze_fir_night_crime()
    test_analyze_fir_weapon()
    test_rule_based_prediction_night_festival()
    test_rule_based_prediction_daytime_normal()
    test_trained_model_prediction()
    test_grid_prediction_shape()
    test_mock_data_structure()
    print("\n[SUCCESS] All tests passed.")
