"""Clean OSM health facilities into emergency-capable hospitals for the cascade.

OSM tags many dental / eye / diagnostic clinics as amenity=hospital, and almost never carries `beds`.
Rules (applied in order, the reason is stored on every feature so the result is auditable):
  1. EXCLUDE amenity=clinic/doctors (not hospital-tagged) and emergency=no
  2. EXCLUDE single-speciality / non-emergency facilities by name or healthcare:speciality
     (dental, eye, skin, IVF, diagnostics/labs, physio, AYUSH, de-addiction, piles, cosmetic, veterinary…)
     except named tertiary institutes (NIMHANS, Jayadeva, Kidwai, IGICH), which are always MAJOR
  3. EXCLUDE primary health centres (PHC/UPHC: outpatient only, no emergency admissions)
  4. MAJOR  if government/public operator, medical college, "general/district/ESI hospital",
            a known large Bengaluru hospital, or a building footprint >= 5,000 m²
  5. GENERAL otherwise (nursing homes, maternity and small multispeciality hospitals)

Input : OSM features (amenity in hospital|clinic|doctors, healthcare=hospital) with geometry
Output: data/raw/hospitals.geojson            (major + general: used by the cascade)
        data/raw/health_facilities_excluded.geojson  (excluded, with reason: for transparency)

  python scripts/build_facilities.py [path/to/osm_health.geojson]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import geopandas as gpd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config as C  # noqa: E402

EXCLUDE = re.compile(
    r"dental|dentist|teeth|tooth|orthodont|\beye\b|eyes|vision|ophthal|netra|nethra|lasik|vasan|agarwal|"
    r"\bskin\b|derma|hair|cosmet|aesthetic|laser clinic|ivf|fertility|diagnos|\bscan|scans\b|\blab\b|labs\b|"
    r"laborator|imaging|x-?ray|pathology|physio|rehab|ayurved|homoeo|homeo|unani|siddha|naturo|yoga|"
    r"piles|proctolog|fistula|de-?addiction|psychiatr|mental health|veterinar|\bpet\b|\bvet\b|spa\b|wellness|"
    r"blood bank|pharmacy|medical store|hearing|speech|sleep clinic|diabet(ic|es) cent|dialysis cent|"
    r"polyclinic|clinic\W*$", re.I)
# Major hospitals whose names would otherwise trip a speciality rule (e.g. "Mental Health" in NIMHANS).
ALWAYS_MAJOR = re.compile(r"nimhans|national institute of mental health|jayadeva|kidwai|indira gandhi institute", re.I)
PHC = re.compile(r"primary health|\bphc\b|\buphc\b|urban health cent|health cent(re|er)\b|dispensary", re.I)
MAJOR_NAME = re.compile(
    r"government|govt|general hospital|district hospital|taluk hospital|medical college|institute of|\besi\b|"
    r"victoria|bowring|vani vilas|k\.?\s?c\.? general|jayadeva|nimhans|kidwai|indira gandhi|sanjay gandhi|"
    r"command hospital|\bhal\b|manipal|narayana|apollo|fortis|columbia asia|aster|sakra|st\.? ?john|st\.? ?martha|"
    r"st\.? ?philomena|mallya|sparsh|\bbgs\b|ramaiah|baptist|sagar hospital|vydehi|rajarajeswari|cytecare|\bhcg\b|"
    r"people tree|vikram hospital|chinmaya|motherhood|cloudnine|rainbow|kims|bangalore hospital|sevakshetra|"
    r"mazumdar|santosh hospital|church of south india|csi hospital|hosmat|brookefield|ovum|trustwell|"
    r"bangalore medical|super ?speciality|multi ?speciality hospital", re.I)
BIG_FOOTPRINT_M2 = 5000


def _s(v) -> str:
    """OSM tags arrive as str, None or float NaN; normalise to a stripped string."""
    return v.strip() if isinstance(v, str) else ""


def classify(row) -> tuple[str, str]:
    name = _s(row.get("name"))
    spec = _s(row.get("healthcare:speciality"))
    amen = _s(row.get("amenity"))
    if amen != "hospital" and _s(row.get("healthcare")) != "hospital":
        return "excluded", f"not hospital-tagged (amenity={amen})"
    if _s(row.get("emergency")).lower() == "no":
        return "excluded", "emergency=no"
    if not name:
        return "excluded", "unnamed"
    if ALWAYS_MAJOR.search(name):
        return "major", "named tertiary-care institute"
    if EXCLUDE.search(name) or (spec and EXCLUDE.search(spec) and "multi" not in spec.lower() and "general" not in spec.lower()):
        return "excluded", "single-speciality / non-emergency"
    if PHC.search(name) and not re.search(r"hospital", name, re.I):
        return "excluded", "primary health centre (outpatient)"
    if _s(row.get("operator:type")).lower() in ("government", "public"):
        return "major", "government/public operator"
    if MAJOR_NAME.search(name):
        return "major", "known large / government hospital"
    if (row.get("area_m2") or 0) >= BIG_FOOTPRINT_M2:
        return "major", f"footprint >= {BIG_FOOTPRINT_M2:,} m²"
    return "general", "hospital-tagged, not specialist"


def main(src: str):
    g = gpd.read_file(src)
    g = g[g.geometry.notna()].copy()
    g["area_m2"] = g.to_crs(32643).geometry.area.round(0)          # UTM 43N: Bengaluru
    for c in ("name", "amenity", "healthcare", "healthcare:speciality", "emergency", "operator:type"):
        if c in g.columns:
            g[c] = g[c].where(g[c].notna(), None)
    g["geometry"] = g.to_crs(32643).geometry.centroid.to_crs(4326)
    out = g.apply(lambda r: classify(r), axis=1, result_type="expand")
    g["tier"], g["reason"] = out[0], out[1]
    # de-duplicate the same hospital mapped as both a point and a building (same name within ~150 m)
    g["key"] = g["name"].fillna("").str.lower().str.replace(r"[^a-z0-9]", "", regex=True)
    g = g.sort_values("area_m2", ascending=False)
    g["cell"] = (g.geometry.y / 0.0015).round().astype(int).astype(str) + "_" + (g.geometry.x / 0.0015).round().astype(int).astype(str)
    g = g.drop_duplicates(subset=["key", "cell"])
    cols = ["name", "tier", "reason", "area_m2", "amenity", "emergency", "operator:type", "geometry"]
    cols = [c for c in cols if c in g.columns]
    keep = g[g.tier.isin(["major", "general"])][cols]
    drop = g[g.tier == "excluded"][cols]
    keep.to_file(C.HOSPITALS_GEOJSON, driver="GeoJSON")
    drop.to_file(C.RAW / "health_facilities_excluded.geojson", driver="GeoJSON")
    print(f"input {len(g)} facilities -> hospitals: {len(keep)} "
          f"(major {int((keep.tier == 'major').sum())}, general {int((keep.tier == 'general').sum())}); "
          f"excluded {len(drop)}")
    print(drop.reason.value_counts().to_string())


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(C.RAW / "osm_health_facilities.geojson"))
