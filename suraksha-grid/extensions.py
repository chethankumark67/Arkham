"""
extensions.py - Read-only analytics endpoints for the dashboard (additive).

All endpoints work on the in-memory incident dataframe set at startup by
main.py (`set_dataframe`) and fall back to the `crime_incidents` table.
When SURAKSHA_DATASET=synthetic the data is SYNTHETIC (see demo_data.py).

  GET /api/v1/incidents        filtered, paginated incident rows
  GET /api/v1/stats/summary    KPIs: totals, 30d change, by type/station/status, clearance, peaks
  GET /api/v1/stats/trend      week / month time-series per crime type
  GET /api/v1/stats/heatmatrix day-of-week x hour counts
  GET /api/v1/network          suspect / vehicle / city / incident graph for visualisation
  GET /api/v1/stations         per-station counts + centroid
"""

from __future__ import annotations

import logging
import os
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["Dashboard (read-only)"])

_DF: pd.DataFrame | None = None
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
UNKNOWN_SUSPECTS = {"unknown", ""}
UNKNOWN_PLATES = {"UNKNOWN", "UNREGISTERED", ""}
CLEARED = {"Charge-sheeted", "Closed"}


def _prepare(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    defaults = {"locality": "", "police_station": "Unknown", "ward": "", "status": "Under Investigation",
                "gang": "", "data_source": "mock", "suspect_alias": "Unknown", "vehicle_plate": "UNKNOWN"}
    for c, v in defaults.items():
        if c not in df.columns:
            df[c] = v
        df[c] = df[c].fillna(v)
    if "mo" not in df.columns:
        from nlp_engine import extract_modus_operandi
        df["mo"] = df["fir_text"].apply(extract_modus_operandi)
    return df.sort_values("timestamp", ascending=False).reset_index(drop=True)


def set_dataframe(df: pd.DataFrame) -> None:
    global _DF
    _DF = _prepare(df)


def get_dataframe() -> pd.DataFrame:
    global _DF
    if _DF is None:
        from sqlalchemy import create_engine
        from config import DATABASE_URL
        from database import _load_incidents
        _DF = _prepare(_load_incidents(create_engine(DATABASE_URL, pool_pre_ping=True)))
    return _DF


def _dataset_label(df: pd.DataFrame) -> str:
    return "synthetic" if df["data_source"].astype(str).str.startswith("synthetic").any() or \
        os.getenv("SURAKSHA_DATASET", "").lower() == "synthetic" else "mock"


def _filter(df: pd.DataFrame, crime_type: str | None = None, city: str | None = None, station: str | None = None,
            status: str | None = None, date_from: str | None = None, date_to: str | None = None,
            bbox: str | None = None, q: str | None = None) -> pd.DataFrame:
    def multi(col: str, v: str | None) -> None:
        nonlocal df
        if v:
            vals = [x.strip().lower() for x in v.split(",") if x.strip()]
            df = df[df[col].astype(str).str.lower().isin(vals)]
    multi("crime_type", crime_type)
    multi("city", city)
    multi("police_station", station)
    multi("status", status)
    try:
        if date_from:
            df = df[df["timestamp"] >= pd.to_datetime(date_from)]
        if date_to:
            to = pd.to_datetime(date_to)
            if len(date_to) <= 10:
                to = to + pd.Timedelta(days=1)
            df = df[df["timestamp"] < to]
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid date: {exc}")
    if bbox:
        try:
            w, s, e, n = (float(x) for x in bbox.split(","))
        except ValueError:
            raise HTTPException(status_code=422, detail="bbox must be 'west,south,east,north'")
        df = df[df["longitude"].between(w, e) & df["latitude"].between(s, n)]
    if q:
        ql = q.lower()
        hay = (df["incident_id"].astype(str) + " " + df["fir_text"].astype(str) + " " + df["suspect_alias"].astype(str)
               + " " + df["vehicle_plate"].astype(str) + " " + df["locality"].astype(str) + " " + df["police_station"].astype(str)
               + " " + df["mo"].astype(str)).str.lower()
        df = df[hay.str.contains(ql, regex=False)]
    return df


def _filtered(**kw: Any) -> pd.DataFrame:
    return _filter(get_dataframe(), **kw)


def _counts(s: pd.Series, top: int | None = None) -> list[dict[str, Any]]:
    vc = s.value_counts()
    if top:
        vc = vc.head(top)
    return [{"name": str(k), "count": int(v)} for k, v in vc.items()]


# Shared filter params --------------------------------------------------------
def _fq(crime_type: str | None = Query(None, description="Comma-separated crime types"),
        city: str | None = Query(None), station: str | None = Query(None), status: str | None = Query(None),
        date_from: str | None = Query(None, description="YYYY-MM-DD"), date_to: str | None = Query(None),
        bbox: str | None = Query(None, description="west,south,east,north"), q: str | None = Query(None)) -> dict:
    return dict(crime_type=crime_type, city=city, station=station, status=status,
                date_from=date_from, date_to=date_to, bbox=bbox, q=q)


from fastapi import Depends  # noqa: E402


@router.get("/incidents")
def list_incidents(f: dict = Depends(_fq), limit: int = Query(50, ge=1, le=2000), offset: int = Query(0, ge=0)) -> dict[str, Any]:
    df = _filtered(**f)
    page = df.iloc[offset: offset + limit]
    cols = ["incident_id", "timestamp", "crime_type", "city", "locality", "police_station", "ward", "status",
            "latitude", "longitude", "mo", "suspect_alias", "vehicle_plate", "gang", "fir_text", "is_festival", "is_payday"]
    rows = page[cols].copy()
    rows["timestamp"] = rows["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    return {"status": "success", "dataset": _dataset_label(df if len(df) else get_dataframe()),
            "total": int(len(df)), "limit": limit, "offset": offset,
            "data": rows.to_dict(orient="records")}


@router.get("/stats/summary")
def stats_summary(f: dict = Depends(_fq)) -> dict[str, Any]:
    full = get_dataframe()
    df = _filter(full, **f)
    ref = full["timestamp"].max() if len(full) else pd.Timestamp.now()
    last30 = df[df["timestamp"] > ref - pd.Timedelta(days=30)]
    prev30 = df[(df["timestamp"] <= ref - pd.Timedelta(days=30)) & (df["timestamp"] > ref - pd.Timedelta(days=60))]
    change = None if len(prev30) == 0 else round((len(last30) - len(prev30)) / len(prev30) * 100, 1)
    gangs = df[(df["gang"].astype(str) != "")]
    active_gangs = gangs[gangs["timestamp"] > ref - pd.Timedelta(days=90)]["gang"].nunique()
    by_hour = df["timestamp"].dt.hour.value_counts()
    by_day = df["timestamp"].dt.day_name().value_counts()
    return {
        "status": "success",
        "dataset": _dataset_label(full),
        "reference_time": ref.strftime("%Y-%m-%d %H:%M:%S") if len(full) else None,
        "total_incidents": int(len(df)),
        "date_range": [df["timestamp"].min().strftime("%Y-%m-%d"), df["timestamp"].max().strftime("%Y-%m-%d")] if len(df) else None,
        "last_30_days": int(len(last30)),
        "previous_30_days": int(len(prev30)),
        "change_30d_pct": change,
        "by_type": _counts(df["crime_type"]),
        "by_station": _counts(df["police_station"], 10),
        "by_city": _counts(df["city"]),
        "by_status": _counts(df["status"]),
        "clearance_rate": round(float(df["status"].isin(CLEARED).mean()) * 100, 1) if len(df) else 0.0,
        "peak_hour": int(by_hour.idxmax()) if len(df) else None,
        "peak_day": str(by_day.idxmax()) if len(df) else None,
        "active_gangs_90d": int(active_gangs),
        "known_gangs": int(gangs["gang"].nunique()),
        "attributed_share": round(float((df["suspect_alias"].str.lower() != "unknown").mean()) * 100, 1) if len(df) else 0.0,
    }


@router.get("/stats/trend")
def stats_trend(f: dict = Depends(_fq), interval: str = Query("month", pattern="^(week|month)$")) -> dict[str, Any]:
    df = _filtered(**f)
    if df.empty:
        return {"status": "success", "interval": interval, "types": [], "data": []}
    period = df["timestamp"].dt.to_period("W-SUN" if interval == "week" else "M")
    key = period.dt.start_time.dt.strftime("%Y-%m-%d")
    pv = pd.crosstab(key, df["crime_type"]).sort_index()
    types = list(df["crime_type"].value_counts().index)
    data = [{"period": str(p), "total": int(r.sum()), **{t: int(r.get(t, 0)) for t in types}} for p, r in pv.iterrows()]
    return {"status": "success", "interval": interval, "types": types, "data": data}


@router.get("/stats/heatmatrix")
def stats_heatmatrix(f: dict = Depends(_fq)) -> dict[str, Any]:
    df = _filtered(**f)
    m = [[0] * 24 for _ in DAYS]
    for (d, h), n in df.groupby([df["timestamp"].dt.day_of_week, df["timestamp"].dt.hour]).size().items():
        m[int(d)][int(h)] = int(n)
    return {"status": "success", "days": DAYS, "hours": list(range(24)), "matrix": m,
            "max": max(max(r) for r in m)}


@router.get("/stations")
def stations(f: dict = Depends(_fq)) -> dict[str, Any]:
    df = _filtered(**f)
    out = []
    for st, g in df.groupby("police_station"):
        out.append({
            "station": str(st), "city": str(g["city"].mode().iloc[0]),
            "count": int(len(g)),
            "lat": round(float(g["latitude"].mean()), 6), "lon": round(float(g["longitude"].mean()), 6),
            "top_type": str(g["crime_type"].mode().iloc[0]),
            "clearance_rate": round(float(g["status"].isin(CLEARED).mean()) * 100, 1),
            "by_status": {k: int(v) for k, v in g["status"].value_counts().items()},
        })
    out.sort(key=lambda r: r["count"], reverse=True)
    return {"status": "success", "total": len(out), "data": out}


# Network -------------------------------------------------------------------

def _network_from_df(df: pd.DataFrame, limit: int, include_unknown: bool) -> dict[str, Any]:
    if not include_unknown:
        df = df[~df["suspect_alias"].astype(str).str.lower().isin(UNKNOWN_SUSPECTS)]
    nodes: dict[str, dict] = {}
    edges: dict[tuple, dict] = {}

    def node(nid: str, typ: str, label: str, **extra: Any) -> None:
        n = nodes.setdefault(nid, {"id": nid, "type": typ, "label": label, "count": 0, **extra})
        n["count"] += 1

    def edge(a: str, b: str, rel: str) -> None:
        e = edges.setdefault((a, b, rel), {"source": a, "target": b, "type": rel, "weight": 0})
        e["weight"] += 1

    for _, r in df.iterrows():
        s = f"s:{r['suspect_alias']}"
        node(s, "suspect", str(r["suspect_alias"]), gang=str(r.get("gang", "")))
        c = f"c:{r['city']}"
        node(c, "city", str(r["city"]))
        edge(s, c, "ACTIVE_IN")
        plate = str(r["vehicle_plate"])
        if plate.upper() not in UNKNOWN_PLATES:
            v = f"v:{plate}"
            node(v, "vehicle", plate)
            edge(s, v, "DRIVES")
    # most recent incidents per suspect (bounded by `limit`)
    if limit > 0:
        recent = df.groupby("suspect_alias", group_keys=False).head(2).head(limit)
        for _, r in recent.iterrows():
            i = f"i:{r['incident_id']}"
            node(i, "incident", str(r["incident_id"]), crime_type=str(r["crime_type"]),
                 timestamp=pd.Timestamp(r["timestamp"]).strftime("%Y-%m-%d %H:%M"))
            edge(i, f"s:{r['suspect_alias']}", "COMMITTED_BY")
    return {"nodes": list(nodes.values()), "edges": list(edges.values())}


def _network_from_neo4j(limit: int, include_unknown: bool) -> dict[str, Any] | None:
    import graph
    if not graph._GRAPH_AVAILABLE:
        return None
    df = get_dataframe()
    ids = df["incident_id"].astype(str).tolist()  # restrict to the currently loaded dataset
    q = """
    MATCH (i:Incident)-[:COMMITTED_BY]->(s:Suspect)
    WHERE i.id IN $ids AND ($unk OR NOT toLower(s.alias) IN ['unknown', ''])
    OPTIONAL MATCH (i)-[:UTILIZED_VEHICLE]->(v:Vehicle)
    RETURN s.alias AS alias, i.city AS city, v.plate AS plate, i.id AS iid, i.type AS type, i.timestamp AS ts
    ORDER BY i.timestamp DESC
    """
    with graph._driver.session() as session:
        recs = [dict(r) for r in session.run(q, ids=ids, unk=include_unknown)]
    if not recs:
        return None
    gang_of = dict(zip(df["suspect_alias"].astype(str), df["gang"].astype(str)))
    sub = pd.DataFrame({
        "suspect_alias": [r["alias"] for r in recs], "city": [r["city"] for r in recs],
        "vehicle_plate": [r["plate"] or "UNKNOWN" for r in recs], "incident_id": [r["iid"] for r in recs],
        "crime_type": [r["type"] for r in recs], "timestamp": [r["ts"] for r in recs],
        "gang": [gang_of.get(r["alias"], "") for r in recs],
    })
    return _network_from_df(sub, limit, include_unknown=True)


@router.get("/network")
def network(limit: int = Query(60, ge=0, le=1000, description="Max incident nodes"),
            include_unknown: bool = Query(False), source: str = Query("auto", pattern="^(auto|neo4j|dataframe)$")) -> dict[str, Any]:
    result, used = None, "dataframe"
    if source in ("auto", "neo4j"):
        try:
            result = _network_from_neo4j(limit, include_unknown)
            used = "neo4j" if result else used
        except Exception as exc:  # pragma: no cover - depends on live Neo4j
            logger.warning("[EXT] Neo4j network query failed (%s); deriving from dataframe.", exc)
    if result is None:
        result = _network_from_df(get_dataframe(), limit, include_unknown)
    counts = {t: sum(1 for n in result["nodes"] if n["type"] == t) for t in ("suspect", "vehicle", "city", "incident")}
    return {"status": "success", "source": used, "dataset": _dataset_label(get_dataframe()), "counts": counts, **result}
