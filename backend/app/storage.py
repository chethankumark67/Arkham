"""Optional infrastructure: Redis (response cache) and PostgreSQL + PostGIS (spatial store, run log).

Both are enabled by environment variables and degrade gracefully:
  REDIS_URL=redis://localhost:6379/0           -> shared JSON cache across workers / restarts
  DATABASE_URL=postgresql://user:pw@host/db    -> PostGIS tables for BBMP points, hospitals, roads, scenario runs
Without them the API uses an in-process dict and pure-Python spatial queries.
"""
from __future__ import annotations

import json
import os
import time
from collections import OrderedDict

# ---------------------------------------------------------------- cache
_mem: OrderedDict = OrderedDict()
_redis = None
_redis_err = None
CACHE_TTL = int(os.getenv("CACHE_TTL", "3600"))


def _r():
    global _redis, _redis_err
    if _redis is None and _redis_err is None and os.getenv("REDIS_URL"):
        try:
            import redis
            _redis = redis.Redis.from_url(os.environ["REDIS_URL"], socket_timeout=2)
            _redis.ping()
        except Exception as e:  # pragma: no cover
            _redis, _redis_err = None, str(e)[:120]
    return _redis


def cache_get(key: str):
    r = _r()
    if r is not None:
        try:
            v = r.get("arkham:" + key)
            return json.loads(v) if v else None
        except Exception:
            pass
    v = _mem.get(key)
    if v and v[0] > time.time():
        _mem.move_to_end(key)
        return v[1]
    return None


def cache_set(key: str, value) -> None:
    r = _r()
    if r is not None:
        try:
            r.setex("arkham:" + key, CACHE_TTL, json.dumps(value, default=float))
            return
        except Exception:
            pass
    _mem[key] = (time.time() + CACHE_TTL, value)
    if len(_mem) > 128:
        _mem.popitem(last=False)


# ---------------------------------------------------------------- PostGIS
_pg_err = None
_pg_retry_at = 0.0
SCHEMA = """
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS bbmp_points (id serial PRIMARY KEY, layer text, name text, ward text, zone text,
  geom geography(Point, 4326));
CREATE TABLE IF NOT EXISTS hospitals (id serial PRIMARY KEY, name text, geom geography(Point, 4326));
CREATE TABLE IF NOT EXISTS roads (id serial PRIMARY KEY, name text, hw text, geom geography(LineString, 4326));
CREATE TABLE IF NOT EXISTS scenario_runs (id serial PRIMARY KEY, at timestamptz DEFAULT now(), rain_mm real,
  drain_pct real, interventions text, hour real, flooded_km2 real, people_cut_off integer, roads_closed_km real,
  hospitals_flooded integer);
CREATE INDEX IF NOT EXISTS bbmp_gix ON bbmp_points USING gist (geom);
CREATE INDEX IF NOT EXISTS hosp_gix ON hospitals USING gist (geom);
CREATE INDEX IF NOT EXISTS roads_gix ON roads USING gist (geom);
"""


def pg():
    """A new psycopg connection, or None when DATABASE_URL is unset / unreachable."""
    global _pg_err, _pg_retry_at
    url = os.getenv("DATABASE_URL")
    if not url or time.time() < _pg_retry_at:
        return None
    try:
        import psycopg
        c = psycopg.connect(url, connect_timeout=3, autocommit=True)
        _pg_err = None
        return c
    except Exception as e:  # pragma: no cover
        _pg_err, _pg_retry_at = str(e)[:120], time.time() + 30  # retry later (DB may still be starting)
        return None


def status() -> dict:
    r = _r()
    c = pg()
    db = None
    if c:
        with c:
            db = {k: c.execute(f"SELECT count(*) FROM {k}").fetchone()[0]
                  for k in ("bbmp_points", "hospitals", "roads", "scenario_runs")}
    return {"redis": bool(r), "redis_error": _redis_err, "postgis": bool(db is not None), "postgis_error": _pg_err,
            "tables": db}


def seed(force: bool = False) -> dict:
    """Create the schema and load BBMP points, hospitals and roads (idempotent)."""
    from .data import bbmp_points, hospitals
    from .models import cascade

    c = pg()
    if not c:
        return {"seeded": False, "reason": _pg_err or "DATABASE_URL not set"}
    with c:
        c.execute(SCHEMA)
        if not force and c.execute("SELECT count(*) FROM bbmp_points").fetchone()[0]:
            return {"seeded": False, "reason": "already seeded"}
        for t in ("bbmp_points", "hospitals", "roads"):
            c.execute(f"TRUNCATE {t}")
        with c.cursor() as cur:
            cur.executemany("INSERT INTO bbmp_points (layer,name,ward,zone,geom) VALUES (%s,%s,%s,%s,ST_MakePoint(%s,%s)::geography)",
                            [(p["layer"], p["name"], p["ward"], p["zone"], p["lon"], p["lat"]) for p in bbmp_points()])
            cur.executemany("INSERT INTO hospitals (name,geom) VALUES (%s,ST_MakePoint(%s,%s)::geography)",
                            [(h["name"], h["lon"], h["lat"]) for h in hospitals()])
            net = cascade.network()
            G, rows, seen = net["G"], [], set()
            for u, v in net["edges"]:
                if (v, u) in seen:
                    continue
                seen.add((u, v))
                d = G.edges[u, v]
                wkt = "LINESTRING(" + ",".join(f"{x} {y}" for x, y in d["coords"]) + ")"
                rows.append((d["name"], d["hw"], wkt))
            cur.executemany("INSERT INTO roads (name,hw,geom) VALUES (%s,%s,ST_GeogFromText(%s))", rows)
        return {"seeded": True, **{k: c.execute(f"SELECT count(*) FROM {k}").fetchone()[0]
                                   for k in ("bbmp_points", "hospitals", "roads")}}


def log_run(rain, drain, ivs, hour, summary: dict, cas: dict) -> None:
    c = pg()
    if not c:
        return
    try:
        with c:
            c.execute("INSERT INTO scenario_runs (rain_mm,drain_pct,interventions,hour,flooded_km2,people_cut_off,"
                      "roads_closed_km,hospitals_flooded) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                      (rain, drain, ",".join(ivs), hour, summary["flooded_km2_gt_0_3m"], cas["people_cut_off"],
                       cas["roads_closed_km"], cas["hospitals_flooded"]))
    except Exception:
        pass


def nearby(lat: float, lon: float, km: float) -> dict | None:
    """PostGIS radius query; None if the database is unavailable (caller falls back to Python)."""
    c = pg()
    if not c:
        return None
    with c:
        pt = "ST_MakePoint(%s,%s)::geography"
        hs = c.execute(f"SELECT name, ST_Y(geom::geometry), ST_X(geom::geometry), round(ST_Distance(geom,{pt})::numeric) "
                       f"FROM hospitals WHERE ST_DWithin(geom,{pt},%s) ORDER BY 4 LIMIT 25",
                       (lon, lat, lon, lat, km * 1000)).fetchall()
        bp = c.execute(f"SELECT name, ward, layer, ST_Y(geom::geometry), ST_X(geom::geometry), round(ST_Distance(geom,{pt})::numeric) "
                       f"FROM bbmp_points WHERE ST_DWithin(geom,{pt},%s) ORDER BY 6 LIMIT 25",
                       (lon, lat, lon, lat, km * 1000)).fetchall()
        rd = c.execute(f"SELECT coalesce(name,'(unnamed)'), hw, round(ST_Length(geom)::numeric) FROM roads "
                       f"WHERE ST_DWithin(geom,{pt},%s) ORDER BY 3 DESC LIMIT 15", (lon, lat, km * 1000)).fetchall()
    return {"source": "postgis",
            "hospitals": [{"name": a, "lat": b, "lon": c_, "m": float(d)} for a, b, c_, d in hs],
            "bbmp_points": [{"name": a, "ward": b, "layer": c_, "lat": d, "lon": e, "m": float(f)} for a, b, c_, d, e, f in bp],
            "roads": [{"name": a, "hw": b, "length_m": float(c_)} for a, b, c_ in rd]}


def recent_runs(n: int = 20) -> list | None:
    c = pg()
    if not c:
        return None
    with c:
        cur = c.execute("SELECT at, rain_mm, drain_pct, interventions, hour, flooded_km2, people_cut_off, roads_closed_km, "
                        "hospitals_flooded FROM scenario_runs ORDER BY id DESC LIMIT %s", (n,))
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, [v.isoformat() if hasattr(v, "isoformat") else v for v in row])) for row in cur.fetchall()]
