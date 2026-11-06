"""Historical replay: re-run the Tier 1 screen hour by hour through a real past event.

For each hour t the screen is driven by the rain of the trailing STORM_H hours (the screen's design storm)
and sampled at named sites. A site is "flagged" when its depth exceeds DEPTH_SLOW. Lead time is the first
reported flooding minus the first flagged hour.

Rainfall: Open-Meteo hourly (reanalysis / archived model output) for timing. Gridded products miss
convective cells badly (Open-Meteo has ~10-20 mm/day for 4-5 Sep 2022, against 129 mm at the KSNDMC
Marathahalli gauge), so hours inside each gauge window are rescaled to match the published gauge total.
Both the raw and the gauge-corrected runs are returned, so the correction is always visible.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from .. import config as C
from ..data import grid_spec
from . import flood, rainfall

EVENTS = json.loads((Path(__file__).resolve().parent.parent / "replays.json").read_text())
ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"


def _hours(a: str, b: str) -> float:
    return (datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() / 3600


def fetch_rain(ev: dict) -> tuple[list[str], list[float], str]:
    lat, lon = ev["rain_point"]
    d = rainfall._get(ARCHIVE, {"latitude": lat, "longitude": lon, "start_date": ev["start"], "end_date": ev["end"],
                                "hourly": "precipitation", "timezone": "Asia/Kolkata", "models": ev.get("model", "best_match")})
    return d["hourly"]["time"], [float(x or 0) for x in d["hourly"]["precipitation"]], f"Open-Meteo archive ({ev.get('model', 'best_match')})"


def gauge_correct(times: list[str], mm: list[float], gauges: list[dict]) -> list[float]:
    """Scale hours in [from, to) so their sum equals the gauge total; spread evenly if the model has ~no rain there."""
    out = list(mm)
    for g in gauges:
        idx = [i for i, t in enumerate(times) if g["from"] <= t < g["to"]]
        if not idx:
            continue
        model = sum(mm[i] for i in idx)
        for i in idx:
            out[i] = mm[i] * g["mm"] / model if model > 1 else g["mm"] / len(idx)
    return out


def _run(times, mm, sites, drain):
    g = grid_spec()
    win = int(flood.STORM_H)
    cells = {s["id"]: g.rc(s["lat"], s["lon"]) for s in sites}
    series, first = [], {s["id"]: None for s in sites}
    cache: dict[float, object] = {}
    for i, t in enumerate(times):
        r6 = round(sum(mm[max(0, i - win + 1): i + 1]), 1)
        if r6 not in cache:
            cache[r6] = flood.depth_field(flood.Scenario(r6, drain))
        d = cache[r6]
        depths = {}
        for sid, (r, c) in cells.items():
            depths[sid] = round(float(d[max(0, r - 3): r + 4, max(0, c - 3): c + 4].max()), 2)
            if first[sid] is None and depths[sid] > C.DEPTH_SLOW:
                first[sid] = t
        series.append({"time": t, "rain_mm": round(mm[i], 1), "rain_6h_mm": r6, "depth_m": depths})
    flagged = [t for t in first.values() if t]
    return {"series": series, "first_flag": first, "first_any": min(flagged) if flagged else None}


def replay(event_id: str, drain: float = 100.0) -> dict:
    ev = next((e for e in EVENTS if e["id"] == event_id), None)
    if ev is None:
        raise KeyError(event_id)
    times, raw, src = fetch_rain(ev)
    corrected = gauge_correct(times, raw, ev["gauges"])
    rep = ev["reported"]["time"]
    out = {}
    for name, mm in (("gauge_corrected", corrected), ("raw", raw)):
        r = _run(times, mm, ev["sites"], drain)
        r["lead_hours"] = round(_hours(r["first_any"], rep), 1) if r["first_any"] else None
        r["total_mm"] = round(sum(mm), 1)
        out[name] = r
    lead = out["gauge_corrected"]["lead_hours"]
    if lead is None:
        headline = f"ARKHAM would not have flagged {ev['area']} with this rainfall."
    elif lead > 0:
        headline = f"ARKHAM would have flagged {ev['area']} {lead:g} hours before flooding was first reported."
    else:
        headline = f"ARKHAM flagged {ev['area']} {-lead:g} hours after flooding was first reported (no early warning)."
    return {"event": {k: ev[k] for k in ("id", "name", "area", "start", "end", "sites", "gauges", "reported", "sources")},
            "headline": headline, "threshold_m": C.DEPTH_SLOW, "window_hours": flood.STORM_H, "drain_pct": drain,
            "rain_source": src, **out,
            "caveats": ["Rain timing is gridded model output; totals inside each gauge window are rescaled to the published "
                        "KSNDMC gauge reading. Those gauges report every 15 min, so this is a nowcast, not a forecast.",
                        "The reported time is the earliest public report we found, not an official inundation timestamp.",
                        "The Tier 1 screen is a terrain screen, not a hydrodynamic model, and ignores the lake levels from earlier in the week."]}
