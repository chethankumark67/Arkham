"""
nlp_engine.py - spaCy-powered Modus Operandi (MO) Extractor
Parses FIR narrative text to extract structured crime signatures
used for cross-incident pattern matching and graph queries.
"""

import logging
import re
from typing import Optional

from config import SPACY_MODEL

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Load spaCy model once at module import
# ─────────────────────────────────────────────────────────────────────────────
try:
    import spacy
    nlp = spacy.load(SPACY_MODEL)
    logger.info("[NLP] Loaded spaCy model '%s'.", SPACY_MODEL)
except OSError:
    logger.warning(
        "[NLP] spaCy model '%s' not found. Run: python -m spacy download %s",
        SPACY_MODEL,
        SPACY_MODEL,
    )
    nlp = None
except Exception as exc:
    logger.error("[NLP] Unexpected error loading spaCy: %s", exc)
    nlp = None


# ─────────────────────────────────────────────────────────────────────────────
# Keyword taxonomy → MO label mappings
# Extend this dictionary to cover more crime patterns.
# ─────────────────────────────────────────────────────────────────────────────
MO_TAXONOMY: dict[str, list[str]] = {
    "chain_snatching_motorcycle":  ["chain", "snatch", "motorcycle", "bike", "helmet", "rider"],
    "vehicle_theft_master_key":    ["stolen", "vehicle", "master key", "key", "parking", "bypass"],
    "commercial_burglary_shutter": ["shutter", "hydraulic", "jack", "burglary", "storefront", "shop"],
    "atm_robbery":                 ["atm", "robbery", "cash", "withdraw"],
    "house_break_in":              ["house", "break", "window", "door", "residential"],
    "cyber_fraud":                 ["online", "fraud", "phishing", "otp", "upi"],
}

# Fallback MO when nothing matches
_DEFAULT_MO = "general_property_crime"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _keyword_match(text_lower: str) -> Optional[str]:
    """
    Fast keyword-based MO classification before invoking spaCy.
    Returns the first matching MO label, or None.
    """
    for label, keywords in MO_TAXONOMY.items():
        if any(kw in text_lower for kw in keywords):
            return label
    return None


def _spacy_extract(doc) -> list[str]:
    """
    Extract crime-relevant noun chunks from a spaCy Doc object.
    Returns a list of normalised keyword strings.
    """
    relevant_terms = {
        "chain", "motorcycle", "key", "shutter", "hydraulic",
        "helmet", "vehicle", "atm", "window", "door", "otp",
    }
    found: list[str] = []
    for chunk in doc.noun_chunks:
        chunk_text = chunk.text.lower()
        if any(term in chunk_text for term in relevant_terms):
            # Normalise: replace spaces with underscores
            found.append(re.sub(r"\s+", "_", chunk_text.strip()))
    return list(dict.fromkeys(found))  # deduplicate, preserve order


def _extract_entities(doc) -> dict[str, list[str]]:
    """Extract named entities from the FIR text."""
    entities: dict[str, list[str]] = {}
    for ent in doc.ents:
        entities.setdefault(ent.label_, []).append(ent.text)
    return entities


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def extract_modus_operandi(fir_text: str) -> str:
    """
    Determine the Modus Operandi signature from raw FIR narrative text.

    Pipeline:
    1. Fast keyword taxonomy lookup (no NLP overhead).
    2. spaCy noun-chunk extraction when taxonomy gives no match.
    3. Default fallback.

    Parameters
    ----------
    fir_text : str
        Raw First Information Report narrative.

    Returns
    -------
    str
        Normalised MO label such as 'chain_snatching_motorcycle' or a
        '_'-joined set of extracted noun chunks.
    """
    if not fir_text or not fir_text.strip():
        return _DEFAULT_MO

    text_lower = fir_text.lower()

    # Step 1 – Fast taxonomy match
    taxonomy_hit = _keyword_match(text_lower)
    if taxonomy_hit:
        return taxonomy_hit

    # Step 2 – spaCy noun-chunk extraction
    if nlp is not None:
        doc = nlp(text_lower)
        chunks = _spacy_extract(doc)
        if chunks:
            return "_".join(chunks[:4])  # keep top 4 chunks to avoid overly long keys

    # Step 3 – Default
    return _DEFAULT_MO


def analyze_fir(fir_text: str) -> dict:
    """
    Full NLP analysis of a FIR narrative.

    Returns
    -------
    dict with keys:
        - mo_signature      : str
        - extracted_keywords: list[str]
        - named_entities    : dict[label, list[str]]
        - is_night_crime    : bool  (heuristic: mentions darkness / night)
        - weapon_mentioned  : bool
    """
    if not fir_text:
        return {
            "mo_signature": _DEFAULT_MO,
            "extracted_keywords": [],
            "named_entities": {},
            "is_night_crime": False,
            "weapon_mentioned": False,
        }

    text_lower = fir_text.lower()
    mo_sig = extract_modus_operandi(fir_text)

    # Heuristics
    night_terms  = ["night", "midnight", "3 am", "dark", "evening", "late"]
    weapon_terms = ["knife", "gun", "rod", "weapon", "pistol", "acid", "blade"]

    is_night   = any(t in text_lower for t in night_terms)
    has_weapon = any(t in text_lower for t in weapon_terms)

    keywords: list[str] = []
    entities: dict[str, list[str]] = {}

    if nlp is not None:
        doc = nlp(text_lower)
        keywords = _spacy_extract(doc)
        entities = _extract_entities(nlp(fir_text))  # original case for NER

    return {
        "mo_signature":       mo_sig,
        "extracted_keywords": keywords,
        "named_entities":     entities,
        "is_night_crime":     is_night,
        "weapon_mentioned":   has_weapon,
    }
