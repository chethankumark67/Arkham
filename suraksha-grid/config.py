"""
config.py - Centralized configuration for Suraksha-Grid India Backend
Reads from environment variables with safe defaults for local development.
"""

import os
from dotenv import load_dotenv

load_dotenv()  # Load .env file if present

# ─────────────────────────────────────────────
# Database Configuration
# ─────────────────────────────────────────────
DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://postgres:password@localhost:5432/surakshagrid"
)

# ─────────────────────────────────────────────
# Neo4j Graph Database
# ─────────────────────────────────────────────
NEO4J_URI: str = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER: str = os.getenv("NEO4J_USER", os.getenv("NEO4J_USERNAME", "neo4j"))
NEO4J_PASSWORD: str = os.getenv("NEO4J_PASSWORD", "password")

# ─────────────────────────────────────────────
# Spatial / ML Configuration
# ─────────────────────────────────────────────
HOTSPOT_RADIUS_METERS: float = float(os.getenv("HOTSPOT_RADIUS_METERS", "500"))
MIN_CLUSTER_INCIDENTS: int = int(os.getenv("MIN_CLUSTER_INCIDENTS", "2"))

# ─────────────────────────────────────────────
# API Configuration
# ─────────────────────────────────────────────
API_HOST: str = os.getenv("API_HOST", "0.0.0.0")
API_PORT: int = int(os.getenv("API_PORT", "8000"))
API_RELOAD: bool = os.getenv("API_RELOAD", "true").lower() == "true"

# ─────────────────────────────────────────────
# Spacy NLP Model
# ─────────────────────────────────────────────
SPACY_MODEL: str = os.getenv("SPACY_MODEL", "en_core_web_sm")

# ─────────────────────────────────────────────
# Risk Thresholds
# ─────────────────────────────────────────────
RISK_CRITICAL_THRESHOLD: float = float(os.getenv("RISK_CRITICAL_THRESHOLD", "75.0"))
RISK_HIGH_THRESHOLD: float = float(os.getenv("RISK_HIGH_THRESHOLD", "50.0"))
RISK_MODERATE_THRESHOLD: float = float(os.getenv("RISK_MODERATE_THRESHOLD", "25.0"))
