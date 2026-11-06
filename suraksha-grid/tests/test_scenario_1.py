"""
tests/test_scenario_1.py – End-to-End Test for Scenario 1:
Festival & High-Density Crowd "Chain-Snatching" Hotspot Prediction
"""

import sys
import os
import json

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

print("\n" + "=" * 70)
print("  SCENARIO 1: FESTIVAL & HIGH-DENSITY CROWD CHAIN-SNATCHING TEST")
print("=" * 70 + "\n")

# ─────────────────────────────────────────────────────────────────────────────
# 1. Baseline: Normal Tuesday Daytime (No festival, regular hours)
# ─────────────────────────────────────────────────────────────────────────────
normal_slot = {
    "latitude": 12.9716,
    "longitude": 77.5946,
    "target_datetime": "2026-10-13 11:30:00",
    "is_festival": 0,
    "is_payday": 0,
}
res_normal = client.post("/api/v1/predict/daily-slot", json=normal_slot).json()
print("1. BASELINE COMPARISON (Regular Tuesday 11:30 AM, Quiet Market Hours):")
print(f"   -> Risk Score: {res_normal['data']['risk_score']}%")
print(f"   -> Threat Level: {res_normal['data']['threat_level']}")
print(f"   -> Top Drivers: {res_normal['data'].get('top_risk_drivers')}\n")

# ─────────────────────────────────────────────────────────────────────────────
# 2. Festival Evening: Diwali Shopping Rush (8:30 PM, Festival=1, Payday=1)
# ─────────────────────────────────────────────────────────────────────────────
festival_slot = {
    "latitude": 12.9716,
    "longitude": 77.5946,
    "target_datetime": "2026-10-31 20:30:00",
    "is_festival": 1,
    "is_payday": 1,
}
res_fest = client.post("/api/v1/predict/daily-slot", json=festival_slot).json()
print("2. FESTIVE SHOPPING RUSH (Diwali Market Saturday 8:30 PM):")
print(f"   -> Risk Score: {res_fest['data']['risk_score']}%")
print(f"   -> Threat Level: {res_fest['data']['threat_level']}")
print(f"   -> Occasion Factors: {res_fest['data']['occasion_factors']}")
print(f"   -> Top Drivers: {res_fest['data'].get('top_risk_drivers')}\n")

# ─────────────────────────────────────────────────────────────────────────────
# 3. Market District Heatmap Grid (3x3 grid around shopping area)
# ─────────────────────────────────────────────────────────────────────────────
grid_payload = {
    "lat_min": 12.9650,
    "lat_max": 12.9850,
    "lon_min": 77.5850,
    "lon_max": 77.6050,
    "target_datetime": "2026-10-31 20:30:00",
    "is_festival": 1,
    "is_payday": 1,
    "grid_steps": 3,
}
res_grid = client.post("/api/v1/predict/grid", json=grid_payload).json()
print(f"3. PATROL RESOURCE ALLOCATION HEATMAP ({res_grid['grid_points']} Grid Points):")
for pt in res_grid["data"]:
    print(f"   -> Point ({pt['latitude']:.4f}, {pt['longitude']:.4f}) | Risk: {pt['risk_score']}% [{pt['threat_level']}]")
print()

# ─────────────────────────────────────────────────────────────────────────────
# 4. Incoming FIR: Modus Operandi & Multi-Hop Syndicate Intelligence
# ─────────────────────────────────────────────────────────────────────────────
fir_payload = {
    "fir_text": (
        "Victim walking through crowded festive shopping street near metro station; "
        "gold chain snatched by two suspects riding an unregistered dark motorcycle wearing black helmets."
    ),
    "city": "Bengaluru",
    "suspect_alias": "Unknown (Black Helmet)",
    "vehicle_plate": "UNREGISTERED",
}
res_fir = client.post("/api/v1/analyze-incident", json=fir_payload).json()
print("4. REAL-TIME FIR ANALYSIS & SYNDICATE UNMASKING:")
print(f"   -> Extracted MO Signature: '{res_fir['extracted_mo_signature']}'")
print(f"   -> Cross-Jurisdiction Alert: {res_fir['cross_jurisdiction_alert']['message']}")
print("   -> Suspect Leads & Connected Syndicate Network (from Neo4j):")
for lead in res_fir["suspect_leads"]:
    print(f"      * Primary Suspect : {lead['primary_suspect']}")
    print(f"        Associates      : {', '.join(lead['criminal_network'])}")
    print(f"        Active In Cities: {', '.join(lead['active_cities'])}")
    print(f"        Crime Patterns  : {', '.join(lead['crime_types'])}")
print()

# ─────────────────────────────────────────────────────────────────────────────
# 5. Filtered Spatial Hotspots via PostGIS
# ─────────────────────────────────────────────────────────────────────────────
res_hotspots = client.get("/api/v1/hotspots?crime_type=Chain+Snatching").json()
print(f"5. POSTGIS HISTORICAL CHAIN-SNATCHING HOTSPOTS ({res_hotspots['total_hotspots']} Clusters Found):")
for h in res_hotspots["data"]:
    print(f"   -> Centroid: ({h['centroid_lat']}, {h['centroid_lon']}) | Incidents: {h['incident_count']} | Cities: {h['cities_involved']}")
print("\n" + "=" * 70)
