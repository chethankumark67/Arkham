"""ARKHAM / NammaTwin backend API.

Run:  uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""
from __future__ import annotations

import json
import os
import time
from collections import OrderedDict
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config as C
from . import maplayers, storage
from .data import bbmp_points, grid_spec, hospitals
from .models import cascade, citywide, flood, heat, optimizer, rainfall, replay, solver
from .models.validation import ranking_metrics, report as validation_report, split_points, validate

app = FastAPI(title="ARKHAM City Digital Twin API", version="0.1.0",
              description="Flood screening, BBMP validation, road/hospital cascade and budgeted interventions for Bengaluru.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DOMAINS = json.loads((Path(__file__).parent / "domains.json").read_text())

PROVENANCE = {
    "terrain": "Observed: Copernicus GLO-30 DSM (surface model, includes buildings)",
    "flood_points": "Observed: BBMP/KGIS flood-vulnerable, flood-prone and low-lying locations (OpenCity)",
    "roads_hospitals": "Observed: OpenStreetMap (major roads, amenity=hospital)",
    "rainfall": "Observed/forecast: Open-Meteo",
    "flood_depth": "Modelled: Tier 1 terrain screening, not a hydrodynamic solve",
    "population": "Observed: GHSL GHS-POP 2025 (EC JRC, R2023A), ~90 m grid, assigned to the nearest road junction",
    "hospitals": "Observed: OpenStreetMap, filtered to emergency-capable hospitals (scripts/build_facilities.py): major + general tiers",
    "other_domains": "Synthetic: illustrative values for the 11 non-flood domains",
}


def _ivs(iv: str | None) -> list[str]:
    ivs = [x for x in (iv or "").split(",") if x]
    bad = [x for x in ivs if x not in C.INTERVENTIONS]
    if bad:
        raise HTTPException(422, f"unknown interventions {bad}; valid: {list(C.INTERVENTIONS)}")
    return ivs


_cache: OrderedDict = OrderedDict()


def _scenario(rain: float, drain: float, ivs: list[str], hour: float | None = None) -> dict:
    sc = flood.Scenario(rain, drain, ivs, hour)
    k = sc.key()
    if k in _cache:
        _cache.move_to_end(k)
        return _cache[k]
    depth = flood.depth_field(sc)
    members = flood.ensemble_members(rain)
    prob = flood.probability_field(sc, members)
    res = {"scenario": sc, "depth": depth, "prob": prob, "cascade": cascade.run(depth),
           "validation": validate(depth) | {"held_out": ranking_metrics(depth, split_points(bbmp_points())[1])},
           "hotspots": flood.hotspots(depth, prob)}
    _cache[k] = res
    storage.log_run(rain, drain, ivs, hour, flood.summary(depth), res["cascade"])
    if len(_cache) > 256:
        _cache.popitem(last=False)
    return res


def _probabilities(res) -> dict:
    """City-level exceedance probabilities across the ensemble (feeds the 'Ensemble probability' tab)."""
    members = flood.ensemble_members(res["scenario"].rain_mm)
    sc = res["scenario"]
    flood_any = closed_any = cutoff_any = 0
    for m in members:
        d = flood.depth_field(sc, float(m))
        flood_any += (d > C.DEPTH_SLOW).mean() > 0.01
        closed_any += (d > C.DEPTH_CLOSED).mean() > 0.005
        cutoff_any += cascade.run(d, detail=False)["people_cut_off"] > 1000
    n = len(members)
    return {"p_flood_gt_0_3m": round(flood_any / n, 2), "p_roads_blocked_gt_0_7m": round(closed_any / n, 2),
            "p_hospital_cut_off": round(cutoff_any / n, 2), "members": n,
            "member_rain_mm": [round(float(x), 1) for x in members]}


@app.get("/api/health")
def health():
    return {"status": "ok", "terrain": C.TERRAIN_NPZ.exists(), "roads": C.ROADS_GRAPHML.exists(),
            "hospitals": len(hospitals()), "bbmp_points": len(bbmp_points()),
            "numba": solver.HAVE_NUMBA, "infra": storage.status()}


@app.get("/api/meta")
def meta():
    g = grid_spec()
    return {"bbox": {"lat_min": C.LAT_MIN, "lat_max": C.LAT_MAX, "lon_min": C.LON_MIN, "lon_max": C.LON_MAX},
            "grid": {"rows": g.rows, "cols": g.cols, "deg": g.deg, "cell_m": round(g.cell_m)},
            "thresholds": {"slow_m": C.DEPTH_SLOW, "closed_m": C.DEPTH_CLOSED, "cutoff_minutes": C.CUTOFF_MINUTES},
            "interventions": [{"id": k, **v} for k, v in C.INTERVENTIONS.items()], "provenance": PROVENANCE}


@app.get("/api/scenario")
def scenario(rain: float = Query(110, ge=0, le=400, description="Event rainfall, mm"),
             drain: float = Query(100, ge=10, le=200, description="Drain capacity, % of design"),
             iv: str | None = Query(None, description="Comma-separated intervention ids"),
             detail: bool = False, probabilities: bool = False):
    """One call for the dashboard: flood summary, hotspots, validation, cascade."""
    res = _scenario(rain, drain, _ivs(iv))
    cas = res["cascade"] if detail else {k: v for k, v in res["cascade"].items() if k not in ("segments", "cut_off_nodes")}
    val = {k: v for k, v in res["validation"].items() if k != "missed"}
    out = {"inputs": {"rain_mm": rain, "drain_pct": drain, "interventions": _ivs(iv)},
           "flood": flood.summary(res["depth"]), "hotspots": res["hotspots"], "validation": val, "cascade": cas,
           "provenance": {"flood": PROVENANCE["flood_depth"], "population": PROVENANCE["population"]}}
    if probabilities:
        out["probabilities"] = _probabilities(res)
    return out


@app.get("/api/flood/grid")
def flood_grid(rain: float = 110, drain: float = 100, iv: str | None = None, field: str = "depth"):
    """Raster overlay. depth: value/100 = metres. prob: value/100 = probability. Row 0 = north."""
    res = _scenario(rain, drain, _ivs(iv))
    if field not in ("depth", "prob"):
        raise HTTPException(422, "field must be depth or prob")
    g = grid_spec()
    return {"field": field, "rows": g.rows, "cols": g.cols, "scale": 100,
            "bounds": [[C.LAT_MIN, C.LON_MIN], [C.LAT_MAX, C.LON_MAX]], "encoding": "base64 uint8 row-major",
            "data": flood.encode_grid(res[field], 100)}


class SampleReq(BaseModel):
    rain: float = 110
    drain: float = 100
    interventions: list[str] = Field(default_factory=list)
    points: list[dict] = Field(..., description="[{id, lat, lon}]")


@app.post("/api/flood/sample")
def flood_sample(req: SampleReq):
    """Depth / probability at named places (max over a ~500 m neighbourhood around the point)."""
    res = _scenario(req.rain, req.drain, _ivs(",".join(req.interventions)))
    g = grid_spec()
    out = []
    for p in req.points:
        r, c = g.rc(p["lat"], p["lon"])
        win = (slice(max(0, r - 3), r + 4), slice(max(0, c - 3), c + 4))
        out.append({"id": p.get("id"), "depth_m": round(float(res["depth"][win].max()), 2),
                    "probability": round(float(res["prob"][win].max()), 2)})
    return {"points": out}


@app.get("/api/validation")
def validation(rain: float = 110, drain: float = 100, iv: str | None = None):
    """Hit rate on all BBMP points + ROC-AUC / precision / recall / lift on the held-out half (parameters were
    calibrated on the other half)."""
    return validation_report(_scenario(rain, drain, _ivs(iv))["depth"])


@app.get("/api/cascade")
def cascade_ep(rain: float = 110, drain: float = 100, iv: str | None = None):
    return _scenario(rain, drain, _ivs(iv))["cascade"]


@app.get("/api/optimize")
def optimize(rain: float = 110, drain: float = 100, budget: float = Query(200, ge=0)):
    key = f"opt:{round(rain,1)}:{round(drain,1)}:{round(budget)}"
    out = storage.cache_get(key)
    if out is None:
        out = json.loads(json.dumps(optimizer.optimise(rain, drain, budget), default=float))
        storage.cache_set(key, out)
    return out


@app.get("/api/hotspot/simulate")
def hotspot(lat: float, lon: float, rain_mm_hr: float = 60, drain_mm_hr: float = 15,
            minutes: float = Query(120, le=360), half_km: float = Query(1.0, le=2.0)):
    """Tier 2: local-inertial 2D solve on the native 30 m DEM around a hotspot."""
    if not (C.LAT_MIN <= lat <= C.LAT_MAX and C.LON_MIN <= lon <= C.LON_MAX):
        raise HTTPException(422, "point outside study area")
    z, dx = solver.dem_window(lat, lon, half_km)
    sim = solver.simulate(z, dx, rain_mm_hr, drain_mm_hr, minutes)
    hmax = sim["hmax"]
    return {"rows": hmax.shape[0], "cols": hmax.shape[1], "cell_m": round(dx, 1), "scale": 100,
            "bounds": [[lat - half_km / 111, lon - half_km / (111 * np.cos(np.radians(lat)))],
                       [lat + half_km / 111, lon + half_km / (111 * np.cos(np.radians(lat)))]],
            "max_depth_m": round(float(hmax.max()), 2),
            "area_gt_0_3m_ha": round(float((hmax > C.DEPTH_SLOW).sum() * dx * dx / 1e4), 1),
            "series": sim["series"], "hmax": flood.encode_grid(hmax, 100),
            "png": maplayers.png_data_url(hmax, "depth", upscale=4),
            "provenance": "Modelled: local-inertial solver (Bates et al. 2010) on Copernicus DSM"}


@app.get("/api/rainfall")
def rain():
    return rainfall.forecast()


@app.get("/api/live")
def live(drain: float = 100):
    """Scenario driven by the live Open-Meteo 48 h forecast total."""
    f = rainfall.forecast()
    r = float(f["total_mm"])
    return {"rainfall": f, **scenario(rain=r, drain=drain, iv=None, detail=False, probabilities=False)}


@app.get("/api/replays")
def replays():
    """Historical events available for replay."""
    return [{k: e[k] for k in ("id", "name", "area", "start", "end")} for e in replay.EVENTS]


@app.get("/api/replays/{event_id}")
def replay_ep(event_id: str, drain: float = Query(100, ge=10, le=200)):
    """Re-run the screen hour by hour through a real past event (raw and gauge-corrected rainfall)."""
    key = f"replay:{event_id}:{round(drain)}"
    out = storage.cache_get(key)
    if out is None:
        try:
            out = replay.replay(event_id, drain)
        except KeyError:
            raise HTTPException(404, "unknown event")
        except Exception as e:
            raise HTTPException(503, f"historical rainfall unavailable: {str(e)[:120]}")
        storage.cache_set(key, out)
    return out


@app.get("/api/domains")
def domains():
    return [{"provenance": "Synthetic" if d["id"] != "climate" else "Modelled (flood core)", **d} for d in DOMAINS]


@app.get("/api/domains/{domain_id}")
def domain(domain_id: str, rain: float = 110, drain: float = 100):
    d = next((x for x in DOMAINS if x["id"] == domain_id), None)
    if not d:
        raise HTTPException(404, "unknown domain")
    d = dict(d)
    if domain_id in ("climate", "economy", "transport"):
        res = _scenario(rain, drain, [])
        cas = res["cascade"]
        live = {"climate": [["Flooded area (>0.3 m)", f"{flood.summary(res['depth'])['flooded_km2_gt_0_3m']} km²"],
                            ["People cut off", f"{cas['people_cut_off']:,}"],
                            ["Roads closed", f"{cas['roads_closed_km']} km"]],
                "economy": [["Freight roads closed", f"{cas['roads_closed_km']} km"],
                            ["Roads slowed", f"{cas['roads_slowed_km']} km"],
                            ["Hospitals flooded", str(cas["hospitals_flooded"])]],
                "transport": [["Roads closed", f"{cas['roads_closed_km']} km"],
                              ["Roads slowed", f"{cas['roads_slowed_km']} km"],
                              ["p90 extra travel", f"+{cas['p90_extra_minutes']} min"]]}[domain_id]
        d["metrics"] = live
        d["provenance"] = "Modelled (flood core)"
    else:
        d["provenance"] = "Synthetic"
    return d


@app.get("/api/bbmp-points")
def bbmp():
    return bbmp_points()


@app.get("/api/hospitals")
def hospitals_ep():
    return hospitals()


# ---------------- live map layers ----------------
@app.get("/api/map/flood.png", responses={200: {"content": {"image/png": {}}}})
def map_flood_png(rain: float = 110, drain: float = 100, iv: str | None = None, field: str = "depth",
                  hour: float | None = Query(None, ge=0, le=24, description="Hours since storm start")):
    """Coloured flood raster for an image overlay. Bounds: /api/meta bbox (row 0 = north)."""
    if field not in ("depth", "prob"):
        raise HTTPException(422, "field must be depth or prob")
    sc = flood.Scenario(rain, drain, _ivs(iv), hour)
    a = flood.depth_field(sc) if field == "depth" else _scenario(rain, drain, _ivs(iv), hour)["prob"]
    return Response(maplayers.png(a, field), media_type="image/png",
                    headers={"Cache-Control": "max-age=300",
                             "X-Bounds": f"{C.LAT_MIN},{C.LON_MIN},{C.LAT_MAX},{C.LON_MAX}"})


@app.get("/api/map/layers")
def map_layers(rain: float = 110, drain: float = 100, iv: str | None = None,
               hour: float | None = Query(None, ge=0, le=24)):
    """GeoJSON: closed/slowed roads, flooded hospitals, flood hotspots, BBMP points with hit/miss."""
    from scipy import ndimage
    res = _scenario(rain, drain, _ivs(iv), hour)
    pts = bbmp_points()
    g = grid_spec()
    wet = ndimage.binary_dilation(res["depth"] > C.DEPTH_SLOW, iterations=1)
    r, c = g.rc([p["lat"] for p in pts], [p["lon"] for p in pts])
    out = maplayers.layers_geojson(res, pts, wet[r, c])
    out["summary"] = {"hour": hour, **flood.summary(res["depth"]),
                      **{k: res["cascade"][k] for k in ("roads_closed_km", "roads_slowed_km", "hospitals_flooded", "people_cut_off")}}
    return out


@app.get("/api/timeline")
def timeline(rain: float = 110, drain: float = 100, iv: str | None = None, hours: int = Query(12, le=24)):
    """Hour-by-hour flood evolution (depth-only, fast): build-up during the storm, recession after."""
    ivs = _ivs(iv)
    rows = []
    for h in range(hours + 1):
        d = flood.depth_field(flood.Scenario(rain, drain, ivs, float(h)))
        rows.append({"hour": h, "rain_fallen_mm": round(rain * flood.storm_fraction(h), 1), **flood.summary(d)})
    return {"storm_hours": flood.STORM_H, "rows": rows}


@app.get("/api/map/heat.png", responses={200: {"content": {"image/png": {}}}})
def map_heat_png(peak: float = Query(40, ge=25, le=50, description="Scenario peak temperature, °C")):
    """Heat layer: colour = position between the city's coolest and hottest cell (relative heat island map)."""
    t, _ = heat.field(peak)
    rel = (t - t.min()) / max(1e-6, t.max() - t.min())
    return Response(maplayers.png(rel ** 1.6, "heat"), media_type="image/png",
                    headers={"Cache-Control": "max-age=600"})


@app.get("/api/heat")
def heat_summary(peak: float = Query(40, ge=25, le=50)):
    return heat.field(peak)[1]


@app.get("/api/map/drainage.png", responses={200: {"content": {"image/png": {}}}})
def map_drainage_png():
    """Derived drainage network: cells with > ~2 km² upstream catchment (from the DEM flow accumulation)."""
    t = flood.terrain()
    g = grid_spec()
    thresh = 2_000_000 / g.cell_m ** 2
    a = np.where(t["acc"] >= thresh, np.log(t["acc"] / thresh + 1) / np.log(t["acc"].max() / thresh + 1) + 0.02, 0)
    return Response(maplayers.png(a, "drain", upscale=3), media_type="image/png", headers={"Cache-Control": "max-age=86400"})


_roads_gj: dict = {}


@app.get("/api/map/roads")
def map_roads():
    """Major road network (OSM) as GeoJSON, one feature per segment (simplified to 3 points)."""
    if not _roads_gj:
        net = cascade.network()
        G = net["G"]
        seen, feats = set(), []
        for u, v in net["edges"]:
            if (v, u) in seen:
                continue
            seen.add((u, v))
            d = G.edges[u, v]
            feats.append(maplayers.feature("LineString", [[round(x, 5), round(y, 5)] for x, y in d["coords"]],
                                           hw=d["hw"], name=d["name"]))
        _roads_gj.update({"type": "FeatureCollection", "features": feats})
    return _roads_gj


@app.get("/api/map/facilities")
def map_facilities(rain: float = 110, drain: float = 100, iv: str | None = None,
                   hour: float | None = Query(None, ge=0, le=24)):
    """All hospitals with modelled depth at their location for the scenario."""
    res = _scenario(rain, drain, _ivs(iv), hour)
    g = grid_spec()
    out = []
    for h in hospitals():
        r, c = g.rc(h["lat"], h["lon"])
        d = float(res["depth"][r, c])
        out.append({**h, "depth_m": round(d, 2), "functional": d < C.DEPTH_SLOW})
    return out


_impact_cache: OrderedDict = OrderedDict()


@app.get("/api/impact")
def impact(rain: float = Query(110, ge=0, le=400), drain: float = Query(100, ge=10, le=200),
           iv: str | None = None, budget: float = Query(200, ge=0)):
    """Everything the Impact Analysis view needs in one call: KPIs at peak, hour-by-hour impact,
    affected hospitals / roads / BBMP zones, and what each intervention protects."""
    ivs = _ivs(iv)
    key = (round(rain, 1), round(drain, 1), tuple(sorted(ivs)), round(budget))
    if key in _impact_cache:
        return _impact_cache[key]
    shared = storage.cache_get(f"impact:{key}")
    if shared:
        _impact_cache[key] = shared
        return shared
    res = _scenario(rain, drain, ivs)
    cas = res["cascade"]

    # hour-by-hour: flood + cascade (depth-only scenarios, no ensemble -> fast)
    timeline = []
    for h in range(13):
        d = flood.depth_field(flood.Scenario(rain, drain, ivs, float(h)))
        c = cascade.run(d, detail=False)
        timeline.append({"hour": h, "rain_fallen_mm": round(rain * flood.storm_fraction(h), 1), **flood.summary(d),
                         **{k: c[k] for k in ("people_exposed", "people_cut_off", "roads_closed_km",
                                              "roads_slowed_km", "hospitals_flooded")}})
    peak = max(timeline, key=lambda r: (r["people_cut_off"], r["flooded_km2_gt_0_3m"]))

    # BBMP zones / wards: share of the city's recorded flood points the scenario flags
    from scipy import ndimage
    g = grid_spec()
    pts = bbmp_points()
    wet = ndimage.binary_dilation(res["depth"] > C.DEPTH_SLOW, iterations=1)
    r, c = g.rc([p["lat"] for p in pts], [p["lon"] for p in pts])
    zones: dict = {}
    for p, hit, rr, cc in zip(pts, wet[r, c], r, c):
        z = p.get("zone") or "Unzoned (low-lying / flood-prone lists)"
        e = zones.setdefault(z, {"zone": z, "points": 0, "flagged": 0, "max_depth_m": 0.0, "wards": set()})
        e["points"] += 1
        e["flagged"] += int(hit)
        e["max_depth_m"] = max(e["max_depth_m"], round(float(res["depth"][max(0, rr - 1):rr + 2, max(0, cc - 1):cc + 2].max()), 2))
        if hit and p.get("ward"):
            e["wards"].add(p["ward"])
    zone_rows = sorted(({**z, "wards": sorted(z["wards"])[:6], "share": round(z["flagged"] / z["points"], 2)}
                        for z in zones.values()), key=lambda z: (-z["flagged"], -z["points"]))

    opt = optimizer.optimise(rain, drain, budget)
    out = {
        "inputs": {"rain_mm": rain, "drain_pct": drain, "interventions": ivs, "budget_cr": budget},
        "kpis": {**flood.summary(res["depth"]), **{k: v for k, v in cas.items() if not isinstance(v, list)},
                 "bbmp_hit_rate": res["validation"]["hit_rate"], "lift": res["validation"]["lift_over_random"]},
        "peak_hour": peak["hour"],
        "timeline": timeline,
        "hospitals": sorted(cas.get("hospitals", []), key=lambda h: -h["depth_m"])[:25],
        "roads": cas.get("closed_roads_top", []),
        "zones": zone_rows,
        "hotspots": res["hotspots"][:10],
        "sectors": [
            {"sector": "Healthcare", "metric": f"{cas['hospitals_flooded']} hospitals flooded ({cas.get('hospitals_major_flooded', 0)} major) · {cas['people_cut_off']:,} people >30 min from care · {cas.get('people_cut_off_major', 0):,} >30 min from a major hospital"},
            {"sector": "Transport", "metric": f"{cas['roads_closed_km']} km closed · {cas['roads_slowed_km']} km slowed · p90 +{cas['p90_extra_minutes']} min"},
            {"sector": "Population", "metric": f"{cas['people_exposed']:,} people living in flooded cells (GHSL 2025 population grid)"},
            {"sector": "Economy / logistics", "metric": f"{round(cas['roads_closed_km'] + 0.25 * cas['roads_slowed_km'])} km-equivalent freight network lost"},
        ],
        "interventions": {"baseline_cut_off": opt["baseline"]["people_cut_off"], "best": opt["best"],
                          "people_protected": opt["people_protected"], "ranked": opt["ranked_single_interventions"]},
        "provenance": PROVENANCE,
    }
    out = json.loads(json.dumps(out, default=float))
    storage.cache_set(f"impact:{key}", out)
    _impact_cache[key] = out
    if len(_impact_cache) > 32:
        _impact_cache.popitem(last=False)
    return out


# ---------------- whole-city Tier 2 (Numba) ----------------
@app.post("/api/citywide/run")
def citywide_run(rain_mm_hr: float = Query(60, ge=1, le=200), drain_mm_hr: float = Query(15, ge=0, le=100),
                 minutes: float = Query(120, ge=10, le=360), res_m: float = Query(60, ge=30, le=200)):
    """Start (or reuse) a whole-city local-inertial run. Poll /api/citywide/{job}."""
    return {"job": citywide.start(rain_mm_hr, drain_mm_hr, minutes, res_m)}


@app.get("/api/citywide/{job}")
def citywide_status(job: str, frame: int | None = Query(None, ge=0)):
    j = citywide.JOBS.get(job)
    if not j:
        raise HTTPException(404, "unknown job")
    out = {"job": job, "status": j["status"], "elapsed_s": round(time.time() - j["started"], 1)}
    if j["status"] == "done":
        a = j["hmax"] if frame is None else j["snapshots"][min(frame, len(j["snapshots"]) - 1)]
        out.update(seconds=j["seconds"], engine=j["engine"], cell_m=round(j["cell_m"], 1), shape=list(j["shape"]),
                   frames=len(j["snapshots"]), series=j["series"],
                   max_depth_m=round(float(j["hmax"].max()), 2),
                   area_gt_0_3m_km2=round(float((j["hmax"] > C.DEPTH_SLOW).sum()) * j["cell_m"] ** 2 / 1e6, 1),
                   bounds=[[C.LAT_MIN, C.LON_MIN], [C.LAT_MAX, C.LON_MAX]],
                   png=maplayers.png_data_url(a, "depth", upscale=1))
    elif j["status"] == "error":
        out["error"] = j.get("error")
    return out


# ---------------- Cloud-Optimized GeoTIFF exports ----------------
def _cog_bytes(a: np.ndarray, bounds, nodata=None) -> bytes:
    import rasterio
    from rasterio.io import MemoryFile
    from rasterio.transform import from_bounds
    (s_, w_), (n_, e_) = bounds
    prof = dict(driver="COG", height=a.shape[0], width=a.shape[1], count=1, dtype="float32", crs="EPSG:4326",
                transform=from_bounds(w_, s_, e_, n_, a.shape[1], a.shape[0]), compress="DEFLATE", nodata=nodata)
    with MemoryFile() as mf:
        with mf.open(**prof) as dst:
            dst.write(a.astype("float32"), 1)
        return mf.read()


@app.get("/api/cog/flood.tif", responses={200: {"content": {"image/tiff": {}}}})
def cog_flood(rain: float = 110, drain: float = 100, iv: str | None = None, hour: float | None = None,
              field: str = "depth"):
    """Tier 1 depth (m) or probability as a float32 Cloud-Optimized GeoTIFF (EPSG:4326) for QGIS / ArcGIS."""
    if field not in ("depth", "prob"):
        raise HTTPException(422, "field must be depth or prob")
    a = flood.depth_field(flood.Scenario(rain, drain, _ivs(iv), hour)) if field == "depth" else _scenario(rain, drain, _ivs(iv), hour)["prob"]
    return Response(_cog_bytes(a, [[C.LAT_MIN, C.LON_MIN], [C.LAT_MAX, C.LON_MAX]]), media_type="image/tiff",
                    headers={"Content-Disposition": f'attachment; filename="arkham_{field}_{int(rain)}mm.tif"'})


@app.get("/api/cog/citywide/{job}.tif", responses={200: {"content": {"image/tiff": {}}}})
def cog_citywide(job: str):
    j = citywide.JOBS.get(job)
    if not j or j["status"] != "done":
        raise HTTPException(404, "job not finished")
    return Response(_cog_bytes(j["hmax"], [[C.LAT_MIN, C.LON_MIN], [C.LAT_MAX, C.LON_MAX]]), media_type="image/tiff",
                    headers={"Content-Disposition": f'attachment; filename="arkham_citywide_{job}.tif"'})


# ---------------- PostGIS-backed queries (Python fallback) ----------------
@app.get("/api/nearby")
def nearby(lat: float, lon: float, km: float = Query(1.0, gt=0, le=10)):
    """Hospitals, BBMP flood points and roads within `km` of a point. Uses PostGIS when configured."""
    out = storage.nearby(lat, lon, km)
    if out is not None:
        return out
    from .data import haversine_km
    hs = sorted(({**h, "m": round(float(haversine_km(lat, lon, h["lat"], h["lon"])) * 1000)} for h in hospitals()),
                key=lambda h: h["m"])
    bp = sorted(({**p, "m": round(float(haversine_km(lat, lon, p["lat"], p["lon"])) * 1000)} for p in bbmp_points()),
                key=lambda p: p["m"])
    return {"source": "python", "hospitals": [h for h in hs if h["m"] <= km * 1000][:25],
            "bbmp_points": [p for p in bp if p["m"] <= km * 1000][:25], "roads": []}


@app.get("/api/runs")
def runs(n: int = Query(20, le=200)):
    """Recently computed scenarios (PostGIS run log)."""
    return {"source": "postgis" if storage.pg() else "disabled", "runs": storage.recent_runs(n) or []}


@app.post("/api/admin/seed")
def admin_seed(force: bool = False):
    return storage.seed(force)


# ---------------- PMTiles (static vector tiles with HTTP range support) ----------------
TILES_DIR = C.ROOT / "data" / "tiles"


@app.get("/tiles/{name}")
def tiles(name: str, request: Request):
    """Serve .pmtiles with Range support so MapLibre can read only the tiles it needs."""
    path = (TILES_DIR / name).resolve()
    if path.parent != TILES_DIR.resolve() or not path.exists() or path.suffix != ".pmtiles":
        raise HTTPException(404, "no such tileset (run scripts/export_tiles.py)")
    size = path.stat().st_size
    rng = request.headers.get("range")
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400"}
    if rng and rng.startswith("bytes="):
        a, _, b = rng[6:].partition("-")
        start = int(a) if a else max(0, size - int(b))
        end = min(int(b) if (b and a) else size - 1, size - 1)
        with open(path, "rb") as f:
            f.seek(start)
            data = f.read(end - start + 1)
        return Response(data, status_code=206, media_type="application/octet-stream",
                        headers={**headers, "Content-Range": f"bytes {start}-{end}/{size}"})
    return Response(path.read_bytes(), media_type="application/octet-stream", headers=headers)


@app.on_event("startup")
def _startup():
    if os.getenv("DATABASE_URL"):
        import threading

        def seed_with_retry():
            for _ in range(20):  # the database may still be initialising
                try:
                    r = storage.seed()
                    if r.get("seeded") or r.get("reason") == "already seeded":
                        print("PostGIS:", r)
                        return
                except Exception as e:  # pragma: no cover
                    print("PostGIS seed retry:", e)
                storage._pg_retry_at = 0.0
                time.sleep(6)
        threading.Thread(target=seed_with_retry, daemon=True).start()

from .complaints import router as complaints_router  # noqa: E402
app.include_router(complaints_router)
