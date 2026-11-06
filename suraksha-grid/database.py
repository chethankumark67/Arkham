"""
database.py - PostgreSQL / PostGIS Spatial Query Layer
Computes crime hotspots using DBSCAN clustering or PostGIS spatial aggregation.
Falls back gracefully if PostGIS is unavailable (e.g., plain PostgreSQL).
"""

import logging
from typing import Any

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
from sqlalchemy import Engine, text

from config import HOTSPOT_RADIUS_METERS, MIN_CLUSTER_INCIDENTS

logger = logging.getLogger(__name__)

# Earth radius in km – used for haversine conversion
_EARTH_RADIUS_KM = 6371.0
# Metres per degree of latitude (approximate)
_M_PER_DEG = 111_320.0


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _load_incidents(engine: Engine) -> pd.DataFrame:
    """Load all incidents from PostgreSQL into a DataFrame, or fallback to mock data."""
    try:
        with engine.connect() as conn:
            df = pd.read_sql("SELECT * FROM crime_incidents", conn)
        return df
    except Exception as exc:
        logger.warning("[DB] Failed to load from PostgreSQL (%s). Falling back to mock dataset.", exc)
        from scraper import MOCK_INCIDENTS
        df = pd.DataFrame(MOCK_INCIDENTS)
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        return df


def _dbscan_cluster(df: pd.DataFrame) -> pd.DataFrame:
    """
    Run DBSCAN on (lat, lon) pairs and attach cluster labels.

    The epsilon is converted from metres to radians for haversine metric:
        eps_rad = metres / (earth_radius_metres)
    """
    coords = df[["latitude", "longitude"]].values
    eps_rad = HOTSPOT_RADIUS_METERS / (1000.0 * _EARTH_RADIUS_KM)

    db = DBSCAN(
        eps=eps_rad,
        min_samples=_min_cluster_size(len(df)),
        algorithm="ball_tree",
        metric="haversine",
    ).fit(np.radians(coords))

    df = df.copy()
    df["cluster_id"] = db.labels_
    return df


def _summarise_clusters(clustered: pd.DataFrame) -> list[dict[str, Any]]:
    """Aggregate clustered incidents into hotspot records."""
    hotspots: list[dict[str, Any]] = []
    valid = clustered[clustered["cluster_id"] != -1]
    # fix: normalise by the largest cluster (the fixed sentinel of 10 saturated every
    # cluster at 99.9 once the dataset grew beyond the 10 mock FIRs)
    biggest = max(int(valid.groupby("cluster_id").size().max()) if not valid.empty else 1,
                  MAX_INCIDENTS_IN_ANY_CLUSTER() if len(clustered) <= 50 else 1)

    for cluster_id, group in clustered[clustered["cluster_id"] != -1].groupby("cluster_id"):
        # Dominant crime type in this cluster
        dominant_type = group["crime_type"].mode().iloc[0] if not group.empty else "Unknown"

        # Temporal pattern: peak hour
        if "timestamp" in group.columns:
            hours = pd.to_datetime(group["timestamp"]).dt.hour
            peak_hour = int(hours.mode().iloc[0]) if not hours.empty else 0
        else:
            peak_hour = 0

        # Risk scoring: density × recency weight
        incident_count = len(group)
        risk_score = min(round((incident_count / biggest) * 100, 1), 99.9)

        hotspots.append(
            {
                "cluster_id": int(cluster_id),
                "centroid_lat": round(float(group["latitude"].mean()), 6),
                "centroid_lon": round(float(group["longitude"].mean()), 6),
                "incident_count": incident_count,
                "dominant_crime_type": dominant_type,
                "peak_hour": peak_hour,
                "risk_score": risk_score,
                "cities_involved": group["city"].unique().tolist(),
            }
        )

    return sorted(hotspots, key=lambda h: h["risk_score"], reverse=True)


def MAX_INCIDENTS_IN_ANY_CLUSTER() -> int:
    """Sentinel so risk_score always normalises to [0, 100]."""
    return 10  # adjust upward as real data grows


# ─────────────────────────────────────────────────────────────────────────────
# PostGIS-based hotspot query (used when PostGIS is available)
# ─────────────────────────────────────────────────────────────────────────────

# NOTE (fix): the original query partitioned each incident by its *own* nearest
# neighbour (always itself, distance 0), so every incident got nearby_count = 1
# and the whole table collapsed into ONE "hotspot" spanning Bengaluru, Mysuru
# and Tumakuru. ST_ClusterDBSCAN on a metric projection (UTM 43N, EPSG:32643,
# covers Karnataka) gives real density clusters with eps in metres.
_POSTGIS_HOTSPOT_SQL = text(
    """
    WITH c AS (
        SELECT *,
               ST_ClusterDBSCAN(ST_Transform(geom, 32643), eps := :radius_m, minpoints := :min_cluster)
                   OVER () AS cid
        FROM crime_incidents
        WHERE geom IS NOT NULL
    )
    SELECT
        cid                                                   AS cluster_id,
        COUNT(*)                                              AS incident_count,
        ROUND(AVG(latitude)::numeric,  6)                    AS centroid_lat,
        ROUND(AVG(longitude)::numeric, 6)                    AS centroid_lon,
        MODE() WITHIN GROUP (ORDER BY crime_type)            AS dominant_crime_type,
        MODE() WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM timestamp)::int) AS peak_hour,
        ARRAY_AGG(DISTINCT city)                             AS cities_involved
    FROM c
    WHERE cid IS NOT NULL
    GROUP BY cid
    HAVING COUNT(*) >= :min_cluster
    ORDER BY incident_count DESC;
    """
)


def _min_cluster_size(n_incidents: int) -> int:
    """Scale DBSCAN min-points with data volume (fix: with ~1000 incidents a
    fixed minimum of 2 turns every pair of nearby FIRs into a 'hotspot')."""
    return max(MIN_CLUSTER_INCIDENTS, round(n_incidents / 150))


def _postgis_hotspots(engine: Engine) -> list[dict[str, Any]]:
    """Attempt a PostGIS spatial query; return empty list on any error."""
    try:
        with engine.connect() as conn:
            total = conn.execute(text("SELECT COUNT(*) FROM crime_incidents")).scalar() or 0
            rows = conn.execute(
                _POSTGIS_HOTSPOT_SQL,
                {"radius_m": HOTSPOT_RADIUS_METERS, "min_cluster": _min_cluster_size(total)},
            ).fetchall()

        biggest = max([int(r.incident_count) for r in rows] or [1])
        return [
            {
                "cluster_id": int(r.cluster_id),
                "centroid_lat": float(r.centroid_lat),
                "centroid_lon": float(r.centroid_lon),
                "incident_count": int(r.incident_count),
                "dominant_crime_type": r.dominant_crime_type,
                "peak_hour": int(r.peak_hour) if r.peak_hour is not None else 0,
                "risk_score": min(round(int(r.incident_count) / biggest * 100, 1), 99.9),
                "cities_involved": list(r.cities_involved),
            }
            for r in rows
        ]
    except Exception as exc:
        logger.debug("[DB] PostGIS hotspot query failed (%s); falling back to DBSCAN.", exc)
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def compute_spatial_hotspots(engine: Engine) -> list[dict[str, Any]]:
    """
    Return a list of spatial crime hotspots.

    Strategy:
    1. Try PostGIS ST_DWithin clustering (accurate, server-side).
    2. Fall back to scikit-learn DBSCAN with haversine metric (no PostGIS needed).
    """
    # Strategy 1 – PostGIS (skipped silently if not available)
    postgis_result = _postgis_hotspots(engine)
    if postgis_result:
        logger.info("[DB] Returned %d hotspots via PostGIS.", len(postgis_result))
        return postgis_result

    # Strategy 2 – DBSCAN fallback
    logger.info("[DB] Running DBSCAN hotspot detection (haversine, eps=%dm).", int(HOTSPOT_RADIUS_METERS))
    df = _load_incidents(engine)

    if df.empty:
        logger.warning("[DB] No incidents found; returning empty hotspot list.")
        return []

    clustered = _dbscan_cluster(df)
    hotspots = _summarise_clusters(clustered)
    logger.info("[DB] DBSCAN found %d hotspot cluster(s).", len(hotspots))
    return hotspots


def get_incidents_by_crime_type(engine: Engine, crime_type: str) -> pd.DataFrame:
    """Return all incidents matching a given crime type."""
    with engine.connect() as conn:
        df = pd.read_sql(
            "SELECT * FROM crime_incidents WHERE crime_type = %(crime_type)s",
            conn,
            params={"crime_type": crime_type},
        )
    return df


def get_temporal_summary(engine: Engine) -> dict[str, Any]:
    """
    Return a summary of incidents grouped by hour and day_of_week.
    Useful for dashboard time-series charts.
    """
    df = _load_incidents(engine)
    if df.empty:
        return {"by_hour": {}, "by_day": {}}

    df["timestamp"] = pd.to_datetime(df["timestamp"])
    by_hour = df.groupby(df["timestamp"].dt.hour).size().to_dict()
    by_day  = df.groupby(df["timestamp"].dt.day_name()).size().to_dict()

    return {
        "by_hour": {str(k): int(v) for k, v in by_hour.items()},
        "by_day":  {str(k): int(v) for k, v in by_day.items()},
    }
