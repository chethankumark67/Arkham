"""Budgeted intervention optimiser.

With 5 candidate interventions there are only 32 portfolios, so we evaluate all of them exactly
(each evaluation = Tier 1 flood screen + full cascade) and return the best within budget.
Objective: minimise people cut off from hospitals, tie-break on flooded area.
"""
from __future__ import annotations

from itertools import combinations

from .. import config as C
from . import cascade, flood


def evaluate(rain_mm: float, drain_pct: float, ivs: list[str]) -> dict:
    d = flood.depth_field(flood.Scenario(rain_mm, drain_pct, ivs))
    cas = cascade.run(d, detail=False)
    return {"interventions": ivs, "cost_cr": sum(C.INTERVENTIONS[i]["cost"] for i in ivs),
            "people_cut_off": cas["people_cut_off"], "roads_closed_km": cas["roads_closed_km"],
            "hospitals_flooded": cas["hospitals_flooded"], **flood.summary(d)}


def optimise(rain_mm: float, drain_pct: float, budget_cr: float) -> dict:
    ids = list(C.INTERVENTIONS)
    results = [evaluate(rain_mm, drain_pct, list(combo))
               for k in range(len(ids) + 1) for combo in combinations(ids, k)]
    base = next(r for r in results if not r["interventions"])
    feasible = [r for r in results if r["cost_cr"] <= budget_cr]
    best = min(feasible, key=lambda r: (r["people_cut_off"], r["flooded_km2_gt_0_3m"], r["cost_cr"]))
    singles = sorted(
        [r | {"people_protected": base["people_cut_off"] - r["people_cut_off"],
              "protected_per_cr": round((base["people_cut_off"] - r["people_cut_off"]) / r["cost_cr"])}
         for r in results if len(r["interventions"]) == 1],
        key=lambda r: -r["protected_per_cr"])
    frontier = []
    for r in sorted(results, key=lambda r: r["cost_cr"]):
        if not frontier or r["people_cut_off"] < frontier[-1]["people_cut_off"]:
            frontier.append(r)
    return {"budget_cr": budget_cr, "baseline": base, "best": best,
            "people_protected": base["people_cut_off"] - best["people_cut_off"],
            "ranked_single_interventions": singles, "pareto_frontier": frontier,
            "catalogue": [{"id": k, **v} for k, v in C.INTERVENTIONS.items()]}
