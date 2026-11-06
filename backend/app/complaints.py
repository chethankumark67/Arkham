"""Citizen Reports: citizens lodge complaints (with photos); officials triage them.

Storage: PostGIS table `complaints` (geography point + GiST index) when storage.pg() is available, otherwise a
JSON file (data/complaints.json) guarded by a lock. Behaviour is identical; spatial predicates run in SQL on PostGIS
and in Python on the fallback. Photos are re-encoded with Pillow (strips EXIF/GPS) into data/uploads/.
"""
from __future__ import annotations

import io
import json
import math
import os
import re
import secrets
import statistics
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import config as C
from . import storage

router = APIRouter(tags=["complaints"])

DATA_DIR = Path(os.getenv("COMPLAINTS_DATA_DIR", str(C.ROOT / "data")))

CATEGORIES = ["flooding", "waterlogging", "drain_blockage", "sewage_overflow", "water_quality", "power_outage",
              "fallen_tree", "road_damage_pothole", "traffic_signal", "garbage", "streetlight", "fire_hazard",
              "crowd_safety", "crime_safety", "health_disease", "other"]
AGENCY = {"flooding": "BBMP", "waterlogging": "BBMP", "drain_blockage": "BBMP", "sewage_overflow": "BWSSB",
          "water_quality": "BWSSB", "power_outage": "BESCOM", "fallen_tree": "BBMP", "road_damage_pothole": "BBMP",
          "traffic_signal": "BTP", "garbage": "BBMP", "streetlight": "BESCOM", "fire_hazard": "Fire & Emergency",
          "crowd_safety": "Bengaluru Police", "crime_safety": "Bengaluru Police", "health_disease": "Health Dept",
          "other": "BBMP"}
AGENCIES = ["BBMP", "BWSSB", "BESCOM", "BTP", "Bengaluru Police", "Health Dept", "Fire & Emergency"]
CAT_WEIGHT = {"flooding": 3, "fire_hazard": 3, "crowd_safety": 3, "sewage_overflow": 2, "power_outage": 2,
              "fallen_tree": 2, "traffic_signal": 2, "crime_safety": 2, "health_disease": 2, "waterlogging": 2,
              "water_quality": 2, "drain_blockage": 1, "road_damage_pothole": 1, "garbage": 1, "streetlight": 1,
              "other": 0}
SEVERITIES = ["low", "medium", "high", "critical"]
STATUSES = ["new", "acknowledged", "in_progress", "resolved", "rejected", "duplicate"]
OPEN = {"new", "acknowledged", "in_progress"}
TRANSITIONS = {
    "new": {"acknowledged", "in_progress", "resolved", "rejected", "duplicate"},
    "acknowledged": {"in_progress", "resolved", "rejected", "duplicate"},
    "in_progress": {"resolved", "rejected", "duplicate", "acknowledged"},
    "resolved": {"in_progress"},  # reopen
    "rejected": {"acknowledged"},
    "duplicate": {"acknowledged"},
}
PUBLIC = ["id", "created_at", "updated_at", "category", "title", "description", "lat", "lon", "address", "ward",
          "severity", "photos", "status", "priority", "assigned_agency", "upvotes", "history", "duplicate_of", "demo"]
MAX_PHOTOS, MAX_BYTES, MAX_PX = 4, 5 * 1024 * 1024, 1600
PHONE_RE = re.compile(r"^(?:\+?91[\s-]?|0)?([6-9]\d{9})$")

_lock = threading.RLock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hav(lat1, lon1, lat2, lon2) -> float:
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 12_742_000 * math.asin(math.sqrt(a))


def _in_bbox(lat, lon) -> bool:
    return C.LAT_MIN <= lat <= C.LAT_MAX and C.LON_MIN <= lon <= C.LON_MAX


# ---------------------------------------------------------------- persistence (PostGIS or JSON file)
PG_SCHEMA = """
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS complaints (id text PRIMARY KEY, created_at timestamptz, data jsonb NOT NULL,
  geom geography(Point, 4326));
CREATE INDEX IF NOT EXISTS complaints_gix ON complaints USING gist (geom);
"""
_pg_ready = False


def _pg():
    global _pg_ready
    c = storage.pg()
    if c is not None and not _pg_ready:
        try:
            with c.transaction():
                c.execute(PG_SCHEMA)
            _pg_ready = True
        except Exception:  # pragma: no cover
            c.close()
            return None
    return c


def _file() -> Path:
    return DATA_DIR / "complaints.json"


def _uploads() -> Path:
    d = DATA_DIR / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_file() -> list[dict]:
    f = _file()
    if not f.exists():
        return []
    try:
        return json.loads(f.read_text())
    except Exception:
        return []


def _save_file(rows: list[dict]) -> None:
    f = _file()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(rows, ensure_ascii=False))
    tmp.replace(f)


def _all(bbox: Optional[tuple] = None) -> list[dict]:
    _ensure_seed()
    c = _pg()
    if c is not None:
        with c:
            if bbox:
                rows = c.execute("SELECT data FROM complaints WHERE geom && ST_MakeEnvelope(%s,%s,%s,%s,4326)::geography",
                                 (bbox[1], bbox[0], bbox[3], bbox[2])).fetchall()
            else:
                rows = c.execute("SELECT data FROM complaints").fetchall()
        return [r[0] for r in rows]
    with _lock:
        rows = _load_file()
    if bbox:
        rows = [r for r in rows if bbox[0] <= r["lat"] <= bbox[2] and bbox[1] <= r["lon"] <= bbox[3]]
    return rows


def _get(cid: str) -> Optional[dict]:
    _ensure_seed()
    c = _pg()
    if c is not None:
        with c:
            r = c.execute("SELECT data FROM complaints WHERE id=%s", (cid,)).fetchone()
        return r[0] if r else None
    with _lock:
        return next((r for r in _load_file() if r["id"] == cid), None)


def _put(row: dict) -> None:
    """Insert or replace one complaint."""
    c = _pg()
    if c is not None:
        from psycopg.types.json import Jsonb
        with c:
            c.execute("INSERT INTO complaints (id, created_at, data, geom) VALUES (%s,%s,%s,"
                      "ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data",
                      (row["id"], row["created_at"], Jsonb(row), row["lon"], row["lat"]))
        return
    with _lock:
        rows = _load_file()
        for i, r in enumerate(rows):
            if r["id"] == row["id"]:
                rows[i] = row
                break
        else:
            rows.append(row)
        _save_file(rows)


def _update(cid: str, fn) -> dict:
    """Atomic read-modify-write; fn mutates the row in place."""
    _ensure_seed()
    c = _pg()
    if c is not None:
        from psycopg.types.json import Jsonb
        with c:
            with c.transaction():
                r = c.execute("SELECT data FROM complaints WHERE id=%s FOR UPDATE", (cid,)).fetchone()
                if not r:
                    raise HTTPException(404, "complaint not found")
                row = r[0]
                fn(row)
                c.execute("UPDATE complaints SET data=%s WHERE id=%s", (Jsonb(row), cid))
        return row
    with _lock:
        rows = _load_file()
        row = next((r for r in rows if r["id"] == cid), None)
        if row is None:
            raise HTTPException(404, "complaint not found")
        fn(row)
        _save_file(rows)
        return row


def _nearby_rows(lat, lon, radius_m, category=None, exclude=None) -> list[tuple[float, dict]]:
    c = _pg()
    if c is not None:
        with c:
            rows = c.execute("SELECT data, ST_Distance(geom, ST_MakePoint(%s,%s)::geography) FROM complaints "
                             "WHERE ST_DWithin(geom, ST_MakePoint(%s,%s)::geography, %s)",
                             (lon, lat, lon, lat, radius_m)).fetchall()
        out = [(float(d), r) for r, d in rows]
    else:
        out = [(d, r) for r in _all() if (d := _hav(lat, lon, r["lat"], r["lon"])) <= radius_m]
    out = [(d, r) for d, r in out if (not category or r["category"] == category) and r["id"] != exclude]
    return sorted(out, key=lambda x: x[0])


def _new_id() -> str:
    return "CR-" + datetime.now(timezone.utc).strftime("%y%m") + "-" + secrets.token_hex(3).upper()


# ---------------------------------------------------------------- priority / privacy
def compute_priority(severity: str, category: str, nearby_open: int) -> str:
    score = SEVERITIES.index(severity) * 2 + CAT_WEIGHT.get(category, 0) + min(nearby_open, 4)
    return "P1" if score >= 7 else "P2" if score >= 4 else "P3"


def _mask_phone(p: Optional[str]) -> Optional[str]:
    return (p[:2] + "XXXXXX" + p[-2:]) if p else None


def _mask_name(n: Optional[str]) -> Optional[str]:
    return " ".join(w[0] + "***" for w in n.split()) if n else None


def public(row: dict) -> dict:
    out = {k: row.get(k) for k in PUBLIC}
    out["reporter_name"] = _mask_name(row.get("reporter_name"))
    out["reporter_phone"] = _mask_phone(row.get("reporter_phone"))
    return out


# ---------------------------------------------------------------- demo seed
SEED = [
    ("flooding", "Knee-deep water under Silk Board flyover", 12.9177, 77.6238, "Silk Board junction", "high", "in_progress"),
    ("sewage_overflow", "Sewage frothing onto Bellandur lake road", 12.9352, 77.6669, "Bellandur lake, Yemalur side", "high", "acknowledged"),
    ("waterlogging", "Waterlogging at Koramangala 6th Block", 12.9344, 77.6229, "Near Sony World signal", "medium", "new"),
    ("road_damage_pothole", "Large pothole on ITPL Main Road", 12.9862, 77.7311, "Whitefield, near ITPL gate", "medium", "new"),
    ("traffic_signal", "Signal not working at Hebbal flyover exit", 13.0358, 77.5970, "Hebbal flyover", "high", "acknowledged"),
    ("garbage", "Garbage dump not cleared for a week", 13.0068, 77.6950, "KR Puram market", "medium", "new"),
    ("crowd_safety", "Overcrowding on Majestic bus stand platforms", 12.9767, 77.5713, "Kempegowda Bus Station", "high", "new"),
    ("streetlight", "Streetlights off on Yelahanka New Town road", 13.1007, 77.5963, "Yelahanka 4th phase", "medium", "in_progress"),
    ("power_outage", "No power for 9 hours in Electronic City Phase 1", 12.8452, 77.6602, "Electronic City Phase 1", "high", "acknowledged"),
    ("fallen_tree", "Tree fallen across road after rain", 12.9719, 77.5946, "Cubbon Park, Kasturba Road", "high", "resolved"),
    ("drain_blockage", "Storm drain choked with plastic", 12.9279, 77.6271, "Koramangala 4th Block", "medium", "new"),
    ("water_quality", "Muddy tap water supply", 12.9141, 77.6101, "BTM Layout 2nd Stage", "medium", "new"),
    ("fire_hazard", "Exposed transformer sparking near shops", 12.9591, 77.6974, "Marathahalli bridge", "critical", "new"),
    ("health_disease", "Dengue cases rising, stagnant water in plot", 12.9081, 77.6476, "HSR Layout Sector 2", "high", "acknowledged"),
    ("crime_safety", "Chain snatching reports near metro exit", 12.9784, 77.6408, "Indiranagar metro", "medium", "new"),
    ("flooding", "Underpass flooded, vehicles stranded", 12.9592, 77.6450, "Domlur underpass", "critical", "new"),
    ("waterlogging", "Water entering ground floor homes", 12.9230, 77.6800, "Sarjapur Road, Kaikondrahalli", "high", "in_progress"),
    ("road_damage_pothole", "Road caved in near metro works", 12.9166, 77.5847, "Jayanagar 9th Block", "high", "acknowledged"),
    ("garbage", "Black spot: waste burning at night", 13.0280, 77.6390, "Kammanahalli", "medium", "rejected"),
    ("streetlight", "Dark stretch on Outer Ring Road service lane", 12.9500, 77.7010, "Kadubeesanahalli", "low", "new"),
    ("drain_blockage", "Rajakaluve overflowing after 30 min rain", 12.9990, 77.6620, "Banaswadi", "high", "new"),
    ("power_outage", "Frequent tripping in Rajajinagar", 12.9915, 77.5520, "Rajajinagar 2nd Block", "medium", "resolved"),
    ("other", "Broken footpath slabs near school", 13.0170, 77.5560, "Malleshwaram 8th Cross", "low", "new"),
    ("traffic_signal", "Timer stuck at Tin Factory junction", 12.9960, 77.6690, "Tin Factory, KR Puram", "medium", "duplicate"),
    ("flooding", "Lake overflow into Yelahanka colony", 13.1150, 77.6000, "Puttenahalli lake, Yelahanka", "high", "acknowledged"),
]

_seeded = False


def _ensure_seed() -> None:
    global _seeded
    if _seeded:
        return
    _seeded = True
    c = _pg()
    if c is not None:
        with c:
            if c.execute("SELECT count(*) FROM complaints").fetchone()[0]:
                return
    else:
        with _lock:
            if _file().exists():
                return
            _save_file([])
    base = datetime.now(timezone.utc)
    for i, (cat, title, lat, lon, addr, sev, st) in enumerate(SEED):
        t0 = (base - timedelta(hours=3 + i * 7.5)).isoformat(timespec="seconds")
        hist = [{"at": t0, "status": "new", "note": "Reported by citizen (demo)"}]
        if st != "new":
            hist.append({"at": (base - timedelta(hours=1 + i * 3)).isoformat(timespec="seconds"), "status": st,
                         "note": "Demo triage update"})
        row = {"id": f"CR-DEMO-{i + 1:03d}", "created_at": t0, "updated_at": hist[-1]["at"], "category": cat,
               "title": title, "description": f"{title}. Reported near {addr}.", "lat": lat, "lon": lon,
               "address": addr, "ward": None, "severity": sev, "photos": [], "reporter_name": None,
               "reporter_phone": None, "status": st, "priority": compute_priority(sev, cat, 0),
               "assigned_agency": AGENCY[cat], "upvotes": (i * 7) % 23, "history": hist,
               "duplicate_of": "CR-DEMO-006" if st == "duplicate" else None, "demo": True}
        _put(row)


# ---------------------------------------------------------------- photos
def _sniff(b: bytes) -> Optional[str]:
    if b[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "webp"
    return None


def _store_photo(data: bytes) -> str:
    from PIL import Image, ImageOps

    kind = _sniff(data)
    if not kind:
        raise HTTPException(422, "photos must be JPEG, PNG or WebP")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "each photo must be ≤ 5 MB")
    try:
        im = Image.open(io.BytesIO(data))
        im = ImageOps.exif_transpose(im)
        im.thumbnail((MAX_PX, MAX_PX))
        has_alpha = im.mode in ("RGBA", "LA", "P")
        im = im.convert("RGBA" if has_alpha else "RGB")
    except Exception:
        raise HTTPException(422, "photo could not be decoded")
    ext = "png" if has_alpha else "jpg"
    name = secrets.token_hex(16) + "." + ext
    out = io.BytesIO()
    im.save(out, "PNG" if has_alpha else "JPEG", **({} if has_alpha else {"quality": 85}))  # no exif written
    (_uploads() / name).write_bytes(out.getvalue())
    return "/uploads/" + name


# ---------------------------------------------------------------- endpoints
@router.post("/api/complaints", status_code=201)
async def create_complaint(
    category: str = Form(...), title: str = Form(..., min_length=3, max_length=120),
    description: str = Form("", max_length=2000), lat: float = Form(...), lon: float = Form(...),
    severity: str = Form("medium"), address: Optional[str] = Form(None, max_length=200),
    ward: Optional[str] = Form(None, max_length=80), reporter_name: Optional[str] = Form(None, max_length=80),
    reporter_phone: Optional[str] = Form(None, max_length=20),
    photos: list[UploadFile] = File(default=[]),
):
    if category not in CATEGORIES:
        raise HTTPException(422, f"category must be one of {CATEGORIES}")
    if severity not in SEVERITIES:
        raise HTTPException(422, f"severity must be one of {SEVERITIES}")
    if not (math.isfinite(lat) and math.isfinite(lon)) or not _in_bbox(lat, lon):
        raise HTTPException(422, "location is outside the Bengaluru study area")
    phone = None
    if reporter_phone and reporter_phone.strip():
        m = PHONE_RE.match(reporter_phone.strip().replace(" ", ""))
        if not m:
            raise HTTPException(422, "phone must be a valid Indian 10-digit mobile number")
        phone = m.group(1)
    photos = [p for p in photos if p.filename]
    if len(photos) > MAX_PHOTOS:
        raise HTTPException(422, f"at most {MAX_PHOTOS} photos")
    blobs = []
    for p in photos:
        b = await p.read(MAX_BYTES + 1)
        if len(b) > MAX_BYTES:
            raise HTTPException(413, "each photo must be ≤ 5 MB")
        blobs.append(b)
    urls = [_store_photo(b) for b in blobs]
    _ensure_seed()
    near_open = sum(1 for _, r in _nearby_rows(lat, lon, 300) if r["status"] in OPEN)
    now = _now()
    row = {"id": _new_id(), "created_at": now, "updated_at": now, "category": category, "title": title.strip(),
           "description": description.strip(), "lat": round(lat, 6), "lon": round(lon, 6),
           "address": (address or "").strip() or None, "ward": (ward or "").strip() or None, "severity": severity,
           "photos": urls, "reporter_name": (reporter_name or "").strip() or None, "reporter_phone": phone,
           "status": "new", "priority": compute_priority(severity, category, near_open),
           "assigned_agency": AGENCY[category], "upvotes": 0,
           "history": [{"at": now, "status": "new", "note": "Reported by citizen"}], "duplicate_of": None,
           "demo": False}
    _put(row)
    return public(row)


@router.get("/api/complaints")
def list_complaints(status: Optional[str] = None, category: Optional[str] = None, priority: Optional[str] = None,
                    bbox: Optional[str] = Query(None, description="lat_min,lon_min,lat_max,lon_max"),
                    q: Optional[str] = None, sort: str = "newest", limit: int = Query(100, ge=1, le=1000),
                    offset: int = Query(0, ge=0)):
    box = None
    if bbox:
        try:
            box = tuple(float(x) for x in bbox.split(","))
            assert len(box) == 4
        except Exception:
            raise HTTPException(422, "bbox must be lat_min,lon_min,lat_max,lon_max")
    rows = _all(box)
    if status:
        want = set()
        for s in status.split(","):
            want |= OPEN if s == "open" else {s}
        rows = [r for r in rows if r["status"] in want]
    if category:
        cats = set(category.split(","))
        rows = [r for r in rows if r["category"] in cats]
    if priority:
        ps = set(priority.split(","))
        rows = [r for r in rows if r["priority"] in ps]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in (r["title"] + " " + r.get("description", "") + " " + (r.get("address") or "")
                                          + " " + r["id"]).lower()]
    if sort == "priority":
        rows.sort(key=lambda r: r["created_at"], reverse=True)
        rows.sort(key=lambda r: (r["priority"], -r["upvotes"]))
    elif sort == "upvotes":
        rows.sort(key=lambda r: (r["upvotes"], r["created_at"]), reverse=True)
    else:
        rows.sort(key=lambda r: r["created_at"], reverse=True)
    return {"total": len(rows), "items": [public(r) for r in rows[offset:offset + limit]]}


@router.get("/api/complaints/stats")
def complaint_stats():
    rows = _all()
    def count(k, keys):
        d = {x: 0 for x in keys}
        for r in rows:
            d[r[k]] = d.get(r[k], 0) + 1
        return d
    now = datetime.now(timezone.utc)
    ages = [(now - datetime.fromisoformat(r["created_at"])).total_seconds() / 3600 for r in rows if r["status"] in OPEN]
    return {"total": len(rows), "open": len(ages), "by_status": count("status", STATUSES),
            "by_category": count("category", CATEGORIES), "by_priority": count("priority", ["P1", "P2", "P3"]),
            "by_agency": count("assigned_agency", AGENCIES),
            "open_p1": sum(1 for r in rows if r["status"] in OPEN and r["priority"] == "P1"),
            "median_age_hours": round(statistics.median(ages), 1) if ages else 0.0,
            "meta": {"categories": CATEGORIES, "agencies": AGENCIES, "statuses": STATUSES, "severities": SEVERITIES,
                     "transitions": {k: sorted(v) for k, v in TRANSITIONS.items()}, "default_agency": AGENCY}}


@router.get("/api/complaints/nearby")
def nearby(lat: float, lon: float, radius_m: float = Query(300, gt=0, le=5000), category: Optional[str] = None,
           limit: int = Query(10, ge=1, le=50)):
    rows = _nearby_rows(lat, lon, radius_m, category)
    return {"items": [{**public(r), "distance_m": round(d)} for d, r in rows if r["status"] in OPEN][:limit]}


@router.get("/api/complaints/{cid}")
def get_complaint(cid: str):
    r = _get(cid)
    if not r:
        raise HTTPException(404, "complaint not found")
    return public(r)


class Patch(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = Field(None, pattern="^P[123]$")
    assigned_agency: Optional[str] = None
    duplicate_of: Optional[str] = None
    note: Optional[str] = Field(None, max_length=500)


@router.patch("/api/complaints/{cid}")
def patch_complaint(cid: str, body: Patch):
    if body.assigned_agency is not None and body.assigned_agency not in AGENCIES:
        raise HTTPException(422, f"assigned_agency must be one of {AGENCIES}")
    if body.status is not None and body.status not in STATUSES:
        raise HTTPException(422, f"status must be one of {STATUSES}")
    if body.status == "duplicate":
        if not body.duplicate_of or body.duplicate_of == cid or not _get(body.duplicate_of):
            raise HTTPException(422, "duplicate_of must reference another existing complaint")

    def apply(row):
        now, changes = _now(), []
        if body.status and body.status != row["status"]:
            if body.status not in TRANSITIONS[row["status"]]:
                raise HTTPException(409, f"cannot move from {row['status']} to {body.status}")
            row["status"] = body.status
            row["duplicate_of"] = body.duplicate_of if body.status == "duplicate" else None
            changes.append(f"status → {body.status}")
        if body.priority and body.priority != row["priority"]:
            row["priority"] = body.priority
            changes.append(f"priority → {body.priority}")
        if body.assigned_agency and body.assigned_agency != row["assigned_agency"]:
            row["assigned_agency"] = body.assigned_agency
            changes.append(f"assigned → {body.assigned_agency}")
        if not changes and not body.note:
            raise HTTPException(422, "nothing to update")
        note = "; ".join(changes + ([body.note.strip()] if body.note else []))
        row["history"].append({"at": now, "status": row["status"], "note": note})
        row["updated_at"] = now

    return public(_update(cid, apply))


_voters: dict[str, set] = {}


@router.post("/api/complaints/{cid}/upvote")
def upvote(cid: str, request: Request):
    voter = request.headers.get("x-client-id") or (request.client.host if request.client else "anon")
    seen = _voters.setdefault(cid, set())
    if voter in seen:
        r = _get(cid)
        if not r:
            raise HTTPException(404, "complaint not found")
        return {"id": cid, "upvotes": r["upvotes"], "already": True}
    row = _update(cid, lambda r: r.__setitem__("upvotes", r["upvotes"] + 1))
    seen.add(voter)
    return {"id": cid, "upvotes": row["upvotes"], "already": False}


_NAME_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|png)$")


@router.get("/uploads/{name}")
def get_upload(name: str):
    if not _NAME_RE.match(name):
        raise HTTPException(404, "not found")
    base = _uploads().resolve()
    p = (base / name).resolve()
    if p.parent != base or not p.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(p, media_type="image/png" if name.endswith(".png") else "image/jpeg",
                        headers={"Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff"})
