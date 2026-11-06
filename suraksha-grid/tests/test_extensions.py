"""tests/test_extensions.py - read-only dashboard endpoints on the SYNTHETIC dataset."""
import os
import sys
from datetime import date

import pandas as pd
import pytest
from starlette.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import extensions  # noqa: E402
from demo_data import CRIME_TYPES, generate_dataset  # noqa: E402
from main import app  # noqa: E402

client = TestClient(app)


@pytest.fixture(autouse=True, scope="module")
def synthetic():
    ds = generate_dataset(end=date(2026, 11, 6))
    extensions.set_dataframe(pd.DataFrame(ds))
    yield ds
    extensions._DF = None


def test_generator_deterministic_and_shaped():
    a, b = generate_dataset(end=date(2026, 11, 6)), generate_dataset(end=date(2026, 11, 6))
    assert a == b
    n = len(a["incident_id"])
    assert 600 <= n <= 1100
    assert all(len(v) == n for v in a.values())
    assert set(a["crime_type"]) >= set(CRIME_TYPES)
    assert {"Bengaluru", "Mysuru", "Tumakuru"} <= set(a["city"])
    assert len(set(a["incident_id"])) == n


def test_incidents_filters_and_paging():
    r = client.get("/api/v1/incidents?limit=20&offset=0").json()
    assert r["dataset"] == "synthetic" and len(r["data"]) == 20 and r["total"] > 600
    row = r["data"][0]
    for k in ("latitude", "longitude", "timestamp", "crime_type", "police_station", "status", "mo"):
        assert k in row
    r2 = client.get("/api/v1/incidents?limit=20&offset=20").json()
    assert r2["data"][0]["incident_id"] != row["incident_id"]
    f = client.get("/api/v1/incidents?crime_type=Cyber Fraud,ATM Robbery&city=Bengaluru&limit=500").json()
    assert f["total"] > 0 and {d["crime_type"] for d in f["data"]} <= {"Cyber Fraud", "ATM Robbery"}
    q = client.get("/api/v1/incidents?q=KA03AB9876").json()
    assert q["total"] > 0
    bb = client.get("/api/v1/incidents?bbox=76.5,12.2,76.8,12.4&limit=500").json()
    assert bb["total"] > 0 and all(d["city"] == "Mysuru" for d in bb["data"])
    dr = client.get("/api/v1/incidents?date_from=2026-10-01&date_to=2026-10-31&limit=1").json()
    assert 0 < dr["total"] < r["total"]
    assert client.get("/api/v1/incidents?bbox=bad").status_code == 422


def test_summary():
    s = client.get("/api/v1/stats/summary").json()
    assert s["total_incidents"] > 600 and s["last_30_days"] > 0
    assert 0 <= s["clearance_rate"] <= 100
    assert 0 <= s["peak_hour"] < 24 and s["peak_day"]
    assert len(s["by_station"]) == 10 and s["active_gangs_90d"] > 5
    assert sum(x["count"] for x in s["by_type"]) == s["total_incidents"]


def test_trend_and_heatmatrix():
    m = client.get("/api/v1/stats/trend?interval=month").json()
    assert 12 <= len(m["data"]) <= 13 and m["types"]
    w = client.get("/api/v1/stats/trend?interval=week&crime_type=Vehicle Theft").json()
    assert w["types"] == ["Vehicle Theft"] and len(w["data"]) > 40
    assert client.get("/api/v1/stats/trend?interval=year").status_code == 422
    h = client.get("/api/v1/stats/heatmatrix").json()
    assert len(h["matrix"]) == 7 and all(len(r) == 24 for r in h["matrix"]) and h["max"] > 0


def test_stations():
    s = client.get("/api/v1/stations").json()
    assert s["total"] >= 20
    top = s["data"][0]
    assert top["count"] >= s["data"][-1]["count"] and 12 < top["lat"] < 14


def test_network_dataframe():
    n = client.get("/api/v1/network?source=dataframe&limit=30").json()
    types = {x["type"] for x in n["nodes"]}
    assert {"suspect", "vehicle", "city", "incident"} <= types
    ids = {x["id"] for x in n["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in n["edges"])
    # shared vehicles give multi-gang links
    drivers: dict = {}
    for e in n["edges"]:
        if e["type"] == "DRIVES":
            drivers.setdefault(e["target"], set()).add(e["source"])
    assert any(len(v) > 1 for v in drivers.values())
    assert n["counts"]["incident"] <= 30
