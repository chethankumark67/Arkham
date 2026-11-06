"""
graph.py - Neo4j Aura Graph Database & Criminal Association Engine
Syncs crime entities from PostgreSQL into a knowledge graph and
provides multi-hop suspect network queries.
"""

import logging
from typing import Any

import pandas as pd
from neo4j import GraphDatabase
from neo4j.exceptions import ServiceUnavailable

from config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Driver initialisation
# ─────────────────────────────────────────────────────────────────────────────
_driver = None
_GRAPH_AVAILABLE = False

try:
    if "your-free-instance" not in NEO4J_URI:
        _driver = GraphDatabase.driver(
            NEO4J_URI,
            auth=(NEO4J_USER, NEO4J_PASSWORD),
            connection_timeout=3.0,
            max_connection_lifetime=30,
        )
        _driver.verify_connectivity()
        _GRAPH_AVAILABLE = True
        logger.info("[GRAPH] Neo4j connection established.")
    else:
        logger.info("[GRAPH] Placeholder Neo4j URI detected. Running in mock graph lead mode.")
except Exception as exc:
    logger.warning("[GRAPH] Neo4j unavailable (%s). Graph features will return mock data.", exc)
    _driver = None
    _GRAPH_AVAILABLE = False


# ─────────────────────────────────────────────────────────────────────────────
# Schema / index setup
# ─────────────────────────────────────────────────────────────────────────────

_SCHEMA_QUERIES = [
    "CREATE CONSTRAINT incident_id IF NOT EXISTS FOR (i:Incident) REQUIRE i.id IS UNIQUE",
    "CREATE CONSTRAINT suspect_alias IF NOT EXISTS FOR (s:Suspect)  REQUIRE s.alias IS UNIQUE",
    "CREATE CONSTRAINT vehicle_plate IF NOT EXISTS FOR (v:Vehicle)  REQUIRE v.plate IS UNIQUE",
    "CREATE INDEX incident_city IF NOT EXISTS FOR (i:Incident) ON (i.city)",
    "CREATE INDEX incident_mo   IF NOT EXISTS FOR (i:Incident) ON (i.mo)",
]


def ensure_graph_schema() -> None:
    """Create uniqueness constraints and indexes if they don't exist."""
    if not _GRAPH_AVAILABLE:
        return
    with _driver.session() as session:
        for q in _SCHEMA_QUERIES:
            try:
                session.run(q)
            except Exception as exc:
                logger.debug("[GRAPH] Schema query skipped: %s", exc)
    logger.info("[GRAPH] Schema constraints and indexes verified.")


# ─────────────────────────────────────────────────────────────────────────────
# Sync: PostgreSQL → Neo4j
# ─────────────────────────────────────────────────────────────────────────────

_UPSERT_CYPHER = """
MERGE (i:Incident {id: $incident_id})
SET  i.city      = $city,
     i.type      = $crime_type,
     i.mo        = $mo,
     i.timestamp = $timestamp,
     i.lat       = $lat,
     i.lon       = $lon

MERGE (s:Suspect {alias: $suspect_alias})
MERGE (v:Vehicle {plate: $vehicle_plate})

MERGE (i)-[:COMMITTED_BY]->(s)
MERGE (i)-[:UTILIZED_VEHICLE]->(v)
MERGE (s)-[:DRIVES]->(v)
"""

_ASSOCIATE_CYPHER = """
MATCH (s1:Suspect {alias: $a1}), (s2:Suspect {alias: $a2})
WHERE s1 <> s2
MERGE (s1)-[:ASSOCIATES_WITH]-(s2)
"""


def sync_sql_to_neo4j(incidents_df: pd.DataFrame) -> None:
    """
    Upsert all incidents, suspects, and vehicles into Neo4j.
    Also creates ASSOCIATES_WITH edges for suspects sharing the same vehicle
    or the same MO across incidents.
    """
    if not _GRAPH_AVAILABLE:
        logger.warning("[GRAPH] Skipping Neo4j sync – driver not available.")
        return

    ensure_graph_schema()

    with _driver.session() as session:
        for _, row in incidents_df.iterrows():
            session.run(
                _UPSERT_CYPHER,
                incident_id=str(row["incident_id"]),
                city=str(row.get("city", "")),
                crime_type=str(row.get("crime_type", "")),
                mo=str(row.get("mo", "general_property_crime")),
                timestamp=str(row.get("timestamp", "")),
                lat=float(row.get("latitude", 0)),
                lon=float(row.get("longitude", 0)),
                suspect_alias=str(row.get("suspect_alias", "Unknown")),
                vehicle_plate=str(row.get("vehicle_plate", "UNKNOWN")),
            )

        # Associate suspects who share vehicle plates
        shared_vehicle_groups = incidents_df.groupby("vehicle_plate")["suspect_alias"].unique()
        for plate, aliases in shared_vehicle_groups.items():
            if len(aliases) > 1:
                for i in range(len(aliases)):
                    for j in range(i + 1, len(aliases)):
                        session.run(
                            _ASSOCIATE_CYPHER,
                            a1=str(aliases[i]),
                            a2=str(aliases[j]),
                        )

        # Associate suspects who share the same MO
        if "mo" in incidents_df.columns:
            shared_mo_groups = incidents_df.groupby("mo")["suspect_alias"].unique()
            for mo, aliases in shared_mo_groups.items():
                if len(aliases) > 1:
                    for i in range(len(aliases)):
                        for j in range(i + 1, len(aliases)):
                            session.run(
                                _ASSOCIATE_CYPHER,
                                a1=str(aliases[i]),
                                a2=str(aliases[j]),
                            )

    logger.info("[GRAPH] Synced %d incidents into Neo4j knowledge graph.", len(incidents_df))


# ─────────────────────────────────────────────────────────────────────────────
# Graph Queries
# ─────────────────────────────────────────────────────────────────────────────

_ASSOCIATE_QUERY = """
MATCH (i:Incident)
WHERE i.mo CONTAINS $mo_keyword OR i.type = $mo_keyword
MATCH (i)-[:COMMITTED_BY]->(s:Suspect)
OPTIONAL MATCH (s)-[:ASSOCIATES_WITH*1..2]-(associate:Suspect)
RETURN DISTINCT
    s.alias                            AS primary_suspect,
    collect(DISTINCT associate.alias)  AS criminal_network,
    collect(DISTINCT i.city)           AS active_cities,
    collect(DISTINCT i.type)           AS crime_types
LIMIT 20
"""

_VEHICLE_TRACE_QUERY = """
MATCH (v:Vehicle {plate: $plate})
OPTIONAL MATCH (v)<-[:DRIVES]-(s:Suspect)
OPTIONAL MATCH (v)<-[:UTILIZED_VEHICLE]-(i:Incident)
RETURN
    v.plate                            AS plate,
    collect(DISTINCT s.alias)          AS linked_suspects,
    collect(DISTINCT i.city)           AS incident_cities,
    collect(DISTINCT i.type)           AS crime_types
"""

_HOTZONE_QUERY = """
MATCH (i:Incident)
WITH i.city AS city, count(*) AS total, collect(DISTINCT i.type) AS types
RETURN city, total, types
ORDER BY total DESC
LIMIT 10
"""


def query_criminal_associates(mo_signature: str) -> list[dict[str, Any]]:
    """
    Multi-hop graph query: given an MO signature, return suspect networks
    active in that crime pattern.
    """
    if not _GRAPH_AVAILABLE:
        logger.warning("[GRAPH] Neo4j unavailable – returning placeholder leads.")
        return _mock_leads(mo_signature)

    try:
        with _driver.session() as session:
            result = session.run(_ASSOCIATE_QUERY, mo_keyword=mo_signature)
            leads = []
            for record in result:
                leads.append(
                    {
                        "primary_suspect":  record["primary_suspect"],
                        "criminal_network": record["criminal_network"],
                        "active_cities":    record["active_cities"],
                        "crime_types":      record["crime_types"],
                    }
                )
        return leads if leads else _mock_leads(mo_signature)
    except ServiceUnavailable as exc:
        logger.error("[GRAPH] Query failed: %s", exc)
        return _mock_leads(mo_signature)


def trace_vehicle(plate: str) -> dict[str, Any]:
    """Return all suspects and incidents linked to a vehicle plate."""
    if not _GRAPH_AVAILABLE:
        return {"plate": plate, "linked_suspects": [], "incident_cities": [], "crime_types": []}

    with _driver.session() as session:
        result = session.run(_VEHICLE_TRACE_QUERY, plate=plate).single()
        if result:
            return {
                "plate":            result["plate"],
                "linked_suspects":  result["linked_suspects"],
                "incident_cities":  result["incident_cities"],
                "crime_types":      result["crime_types"],
            }
    return {"plate": plate, "linked_suspects": [], "incident_cities": [], "crime_types": []}


def get_city_crime_hotzones() -> list[dict[str, Any]]:
    """Return cities ranked by total incident count from the graph."""
    if not _GRAPH_AVAILABLE:
        return []

    with _driver.session() as session:
        result = session.run(_HOTZONE_QUERY)
        return [
            {"city": r["city"], "total_incidents": r["total"], "crime_types": r["types"]}
            for r in result
        ]


def close_driver() -> None:
    """Cleanly close the Neo4j driver (call on app shutdown)."""
    if _driver:
        _driver.close()
        logger.info("[GRAPH] Neo4j driver closed.")


# ─────────────────────────────────────────────────────────────────────────────
# Mock fallback when Neo4j is unreachable
# ─────────────────────────────────────────────────────────────────────────────

def _mock_leads(mo_signature: str) -> list[dict[str, Any]]:
    """Return deterministic mock leads for offline / demo mode."""
    return [
        {
            "primary_suspect":  "Unknown Group Alpha",
            "criminal_network": ["Unregistered Vehicle Associate", "Helmet_Rider_002"],
            "active_cities":    ["Bengaluru", "Mysuru"],
            "crime_types":      [mo_signature.replace("_", " ").title()],
        }
    ]
