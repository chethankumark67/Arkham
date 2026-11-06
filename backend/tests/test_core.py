import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import config as C
from app.main import app
from app.models import flood, terrain as T
from app.models.solver import simulate

client = TestClient(app)


def test_priority_flood_fills_pit():
    dem = np.full((5, 5), 10.0); dem[2, 2] = 5.0
    assert T.priority_flood(dem)[2, 2] >= 10.0


def test_accumulation_conserves_cells():
    dem = np.add.outer(np.arange(6.0), np.arange(6.0))  # slopes to (0,0)
    f = T.priority_flood(dem); acc = T.accumulate(f, T.d8_receivers(f))
    assert acc.max() <= dem.size


def test_more_rain_more_flooding():
    a = flood.depth_field(flood.Scenario(80)); b = flood.depth_field(flood.Scenario(150))
    assert (b > C.DEPTH_SLOW).sum() > (a > C.DEPTH_SLOW).sum()


@pytest.mark.parametrize("iv", list(C.INTERVENTIONS))
def test_every_intervention_reduces_flooding(iv):
    base = flood.depth_field(flood.Scenario(120)).sum()
    assert flood.depth_field(flood.Scenario(120, 100, [iv])).sum() < base


def test_solver_mass_balance_closed_flat_basin():
    z = np.zeros((20, 20)); z[0, :] = z[-1, :] = z[:, 0] = z[:, -1] = 50
    out = simulate(z, 30.0, rain_mm_hr=60, drain_mm_hr=0, minutes=30, rain_minutes=30, frames=2)
    # 30 mm of rain on the interior; boundary cells are zeroed so interior depth ≈ 0.03 m
    assert abs(out["hmax"][1:-1, 1:-1].mean() - 0.03) < 0.005


def test_api_scenario_and_validation():
    r = client.get("/api/scenario?rain=120").json()
    assert r["validation"]["points"] > 300 and 0 <= r["validation"]["hit_rate"] <= 1
    assert r["cascade"]["people_cut_off"] >= 0


def test_optimizer_respects_budget():
    r = client.get("/api/optimize?rain=120&budget=100").json()
    assert r["best"]["cost_cr"] <= 100
    assert r["best"]["people_cut_off"] <= r["baseline"]["people_cut_off"]


def test_bad_intervention_rejected():
    assert client.get("/api/scenario?iv=nope").status_code == 422


def test_flood_builds_then_recedes():
    rows = client.get("/api/timeline?rain=120").json()["rows"]
    area = [r["flooded_km2_gt_0_3m"] for r in rows]
    peak = area.index(max(area))
    assert area[0] == 0 and 3 <= peak <= 7 and area[-1] < max(area) / 2


def test_impact_endpoint():
    r = client.get("/api/impact?rain=120&budget=200").json()
    assert len(r["timeline"]) == 13 and r["zones"] and r["interventions"]["best"]["cost_cr"] <= 200
    assert r["kpis"]["people_cut_off"] >= 0


def test_numba_matches_numpy():
    from app.models import solver
    if not solver.HAVE_NUMBA:
        pytest.skip("numba not installed")
    rng = np.random.default_rng(1)
    z = rng.normal(0, 0.5, (30, 30)).cumsum(0)
    a = solver.simulate(z, 30.0, 60, 10, 20, engine="numpy")["hmax"]
    b = solver.simulate(z, 30.0, 60, 10, 20, engine="numba")["hmax"]
    assert np.allclose(a, b, atol=1e-6)


def test_citywide_job_completes():
    import time
    job = client.post("/api/citywide/run?rain_mm_hr=60&minutes=10&res_m=200").json()["job"]
    for _ in range(120):
        r = client.get(f"/api/citywide/{job}").json()
        if r["status"] != "running":
            break
        time.sleep(0.5)
    assert r["status"] == "done" and r["png"].startswith("data:image/png") and r["max_depth_m"] >= 0
    assert client.get(f"/api/cog/citywide/{job}.tif").content[:4] in (b"II*\x00", b"MM\x00*")


def test_cog_export_is_geotiff():
    import io
    import rasterio
    b = client.get("/api/cog/flood.tif?rain=120").content
    with rasterio.open(io.BytesIO(b)) as src:
        assert src.crs.to_epsg() == 4326 and src.count == 1 and src.read(1).max() > 0


def test_nearby_fallback_and_pmtiles_range():
    r = client.get("/api/nearby?lat=12.917&lon=77.623&km=1").json()
    assert r["source"] in ("python", "postgis") and r["bbmp_points"]
    t = client.get("/tiles/arkham.pmtiles", headers={"Range": "bytes=0-6"})
    if t.status_code != 404:
        assert t.status_code == 206 and t.content == b"PMTiles"


def test_solver_never_creates_water():
    """Flux limiter: on rough terrain the stored volume must not exceed the net rain input."""
    from app.models import solver
    rng = np.random.default_rng(3)
    z = rng.normal(0, 2.0, (60, 60))  # very rough surface provokes overshoot without a limiter
    dx = 60.0
    r = solver.simulate(z, dx, 60, 0, 30, rain_minutes=30, frames=1)
    stored = r["snapshots"][-1].sum() * dx * dx
    assert stored <= 0.060 / 2 * z.size * dx * dx * 1.001 and r["hmax"].max() < 10


def test_population_is_observed_ghsl():
    from app.data import population_grid
    pg = population_grid()
    assert pg is not None and 12e6 < pg.sum() < 18e6          # GHSL 2025 inside the study box ≈ 15.3 M
    from app.models import cascade
    assert cascade.network()["pop_source"].startswith("GHSL")


def test_hospitals_are_emergency_capable_only():
    from app.data import hospitals
    hs = hospitals()
    names = " | ".join(h["name"].lower() for h in hs)
    for bad in ("dental", "netralaya", "ivf", "diagnostic", "pathlab"):
        assert bad not in names
    assert any("nimhans" in h["name"].lower() and h["tier"] == "major" for h in hs)
    assert {h["tier"] for h in hs} <= {"major", "general"}


def test_cascade_reports_major_hospital_access():
    r = client.get("/api/scenario?rain=130").json()["cascade"]
    assert {"people_cut_off_major", "hospitals_major_flooded", "population_source"} <= set(r)
    assert r["hospitals_major_flooded"] <= r["hospitals_flooded"]


def test_replay_gauge_correction_and_lead(monkeypatch):
    from app.models import replay
    times = [f"2022-09-04T{h:02d}:00" for h in range(24)]
    raw = [0.0] * 24; raw[20] = 4.0; raw[21] = 1.0  # the gridded product sees only 5 mm
    monkeypatch.setattr(replay, "fetch_rain", lambda ev: (times, raw, "test"))
    ev = replay.EVENTS[0]
    monkeypatch.setitem(ev, "gauges", [{"station": "t", "mm": 120, "from": "2022-09-04T19:00", "to": "2022-09-04T23:00"}])
    monkeypatch.setitem(ev, "reported", {"time": "2022-09-05T07:00", "what": "t"})
    assert abs(sum(replay.gauge_correct(times, raw, ev["gauges"])) - 120) < 1e-6
    r = client.get(f"/api/replays/{ev['id']}").json()
    assert r["raw"]["first_any"] is None
    assert r["gauge_corrected"]["first_any"] == "2022-09-04T20:00" and r["gauge_corrected"]["lead_hours"] == 11.0
    assert client.get("/api/replays/nope").status_code == 404
