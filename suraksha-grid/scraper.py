"""
scraper.py - Free Open Data Ingestion & Scraper Pipeline
Fetches mock NCRB / OpenCity data and loads it into PostgreSQL.
In production, replace the inline dict with live API calls or CSV downloads.
"""

import os
import logging
import pandas as pd
from sqlalchemy import create_engine, text
from config import DATABASE_URL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

# ─────────────────────────────────────────────────────────────────────────────
# Mock dataset — replace with real NCRB / OpenCity API requests in production
# ─────────────────────────────────────────────────────────────────────────────
MOCK_INCIDENTS = {
    "incident_id": [
        "INC-101", "INC-102", "INC-201", "INC-202", "INC-301",
        "INC-302", "INC-401", "INC-402", "INC-501", "INC-502",
    ],
    "city": [
        "Bengaluru", "Bengaluru", "Mysuru", "Bengaluru", "Tumakuru",
        "Bengaluru", "Mysuru",  "Tumakuru", "Bengaluru", "Mysuru",
    ],
    "crime_type": [
        "Chain Snatching", "Vehicle Theft", "Chain Snatching", "Vehicle Theft",
        "Shop Burglary", "Chain Snatching", "Vehicle Theft", "Shop Burglary",
        "Chain Snatching", "Vehicle Theft",
    ],
    "latitude": [
        12.9716, 12.9352, 12.3051, 12.9720, 13.3392,
        12.9800, 12.3080, 13.3400, 12.9710, 12.3100,
    ],
    "longitude": [
        77.5946, 77.6245, 76.6551, 77.5950, 77.1013,
        77.5900, 76.6600, 77.1050, 77.5940, 76.6580,
    ],
    "timestamp": [
        "2026-06-01 21:30:00", "2026-06-01 23:15:00",
        "2026-06-02 22:00:00", "2026-06-03 20:00:00",
        "2026-06-03 03:30:00", "2026-06-04 21:00:00",
        "2026-06-04 22:30:00", "2026-06-05 02:45:00",
        "2026-06-07 20:15:00", "2026-06-08 23:00:00",
    ],
    "fir_text": [
        "Victim's gold chain snatched near metro station by two riders on an unregistered black motorcycle wearing helmets.",
        "Two-wheeler Honda Activa stolen from parking lot using master key during late evening hours.",
        "Gold chain snatched by two suspects riding a dark motorcycle near city circle at night.",
        "Vehicle stolen from residential apartment basement utilizing master key bypass.",
        "Commercial storefront shutter jacked using hydraulic jack at 3 AM; electronics stolen.",
        "Chain snatching incident reported near bus stand; suspects fled on black motorcycle.",
        "Motorcycle stolen from hospital parking; ignition bypassed using master key.",
        "Shop burglary using hydraulic jack on shutter; perpetrators used motorcycle for escape.",
        "Chain snatching near ATM; victim attacked by two helmet-wearing suspects on bike.",
        "Bike stolen near college campus using duplicate key.",
    ],
    "suspect_alias": [
        "Unknown (Black Helmet)", "Ravi_Kulla_Gang",
        "Unknown (Black Helmet)", "Ravi_Kulla_Gang",
        "Shutter_Jack_Crew",     "Unknown (Black Helmet)",
        "Ravi_Kulla_Gang",       "Shutter_Jack_Crew",
        "Unknown (Black Helmet)", "Ravi_Kulla_Gang",
    ],
    "vehicle_plate": [
        "UNREGISTERED", "KA03AB9876",
        "UNREGISTERED", "KA01HH1234",
        "KA05XY5544",   "UNREGISTERED",
        "KA03AB9876",   "KA05XY5544",
        "UNREGISTERED", "KA01HH1234",
    ],
    "is_festival": [0, 0, 1, 0, 0, 1, 0, 1, 0, 0],
    "is_payday":   [1, 1, 0, 1, 0, 0, 1, 0, 1, 1],
}


def _ensure_postgis(eng) -> None:
    """Create the PostGIS extension if it does not already exist."""
    try:
        with eng.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
            conn.commit()
        logger.info("[DB] PostGIS extension ensured.")
    except Exception as exc:
        logger.warning("[DB] Could not enable PostGIS (non-fatal): %s", exc)


def _add_geometry_column(eng, df: pd.DataFrame) -> None:
    """
    Add a PostGIS geometry column 'geom' to crime_incidents if the table was
    created by pandas (which does not know about spatial types).
    """
    try:
        with eng.connect() as conn:
            # Check whether the column already exists
            exists = conn.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns "
                    "WHERE table_name='crime_incidents' AND column_name='geom';"
                )
            ).scalar()

            if not exists:
                conn.execute(
                    text(
                        "ALTER TABLE crime_incidents "
                        "ADD COLUMN geom geometry(Point, 4326);"
                    )
                )

            # Populate / refresh the geometry column from lat/lon
            conn.execute(
                text(
                    "UPDATE crime_incidents "
                    "SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) "
                    "WHERE geom IS NULL;"
                )
            )
            conn.commit()
        logger.info("[DB] PostGIS geometry column populated.")
    except Exception as exc:
        logger.warning("[DB] Geometry column setup skipped (PostGIS may be absent): %s", exc)


def fetch_and_ingest_public_data(custom_data: dict | None = None) -> pd.DataFrame:
    """
    Ingest crime incident data into PostgreSQL.

    Parameters
    ----------
    custom_data : dict, optional
        If provided, use this dict instead of the built-in mock dataset.
        Must have the same keys as MOCK_INCIDENTS.

    Returns
    -------
    pd.DataFrame
        The ingested dataframe (with parsed timestamps).
    """
    logger.info("[SCRAPER] Connecting to public open data repositories (OpenCity / NCRB mocks)…")

    source = custom_data if custom_data is not None else MOCK_INCIDENTS
    df = pd.DataFrame(source)
    df["timestamp"] = pd.to_datetime(df["timestamp"])

    try:
        # Ensure PostGIS is available before writing
        _ensure_postgis(engine)
        df.to_sql("crime_incidents", engine, if_exists="replace", index=False)
        logger.info("[SCRAPER] Ingested %d records into PostgreSQL.", len(df))
        # Spatial geometry column (PostGIS)
        _add_geometry_column(engine, df)
    except Exception as exc:
        logger.warning("[SCRAPER] PostgreSQL unavailable (%s). Continuing in in-memory mode.", exc)

    return df


if __name__ == "__main__":
    fetch_and_ingest_public_data()
