"""Cascade engine: flood depth -> road failures -> hospital access -> people cut off.

Road rule (build spec 13.2): depth >= 0.7 m closes a segment, 0.3-0.7 m slows it to 25% speed.
Hospitals whose own cell is flooded > 0.3 m are treated as non-functional.
A road node is "cut off" when its fastest trip to any functioning hospital exceeds CUTOFF_MINUTES.
People are allocated to road nodes with a modelled density gradient (no census grid yet) -> provenance: Modelled.
"""
from __future__ import annotations

from functools import lru_cache

import networkx as nx
import numpy as np
from scipy.spatial import cKDTree

from .. import config as C
from ..data import grid_spec, hospitals, haversine_km

SPEED_KMH = {"motorway": 50, "trunk": 40, "primary": 30, "secondary": 25, "tertiary": 20}
SLOW_FACTOR = 4.0


def _hw(v):
    v = v[0] if isinstance(v, list) else v
    return str(v).replace("_link", "")


@lru_cache
def network():
    if not C.ROADS_GRAPHML.exists():
        raise FileNotFoundError("roads.graphml missing (run scripts/fetch_data.py)")
    import osmnx as ox

    M = ox.load_graphml(C.ROADS_GRAPHML)
    # collapse multi-edges to the fastest, keep the largest weakly connected component
    G = nx.DiGraph()
    for n, d in M.nodes(data=True):
        G.add_node(n, lat=d["y"], lon=d["x"])
    for u, v, d in M.edges(data=True):
        hw = _hw(d.get("highway", "tertiary"))
        t = d["length"] / 1000 / SPEED_KMH.get(hw, 20) * 60  # minutes
        if G.has_edge(u, v) and G[u][v]["t0"] <= t:
            continue
        geom = d.get("geometry")
        coords = list(geom.coords) if geom is not None else [(M.nodes[u]["x"], M.nodes[u]["y"]), (M.nodes[v]["x"], M.nodes[v]["y"])]
        step = max(1, len(coords) // 6)
        sample = coords[::step] + [coords[-1]]
        name = d.get("name")
        G.add_edge(u, v, t0=t, length=d["length"], hw=hw, name=name[0] if isinstance(name, list) else name,
                   sample=sample, coords=[coords[0], coords[len(coords) // 2], coords[-1]])
    big = max(nx.weakly_connected_components(G), key=len)
    G = G.subgraph(big).copy()

    nodes = list(G.nodes)
    lat = np.array([G.nodes[n]["lat"] for n in nodes])
    lon = np.array([G.nodes[n]["lon"] for n in nodes])
    w = np.exp(-haversine_km(lat, lon, *C.CENTER) / 9.0)
    pop = w / w.sum() * C.CITY_POPULATION
    for n, p in zip(nodes, pop):
        G.nodes[n]["pop"] = float(p)

    tree = cKDTree(np.c_[lat, lon * np.cos(np.radians(13))])
    hs = []
    for h in hospitals():
        dist, i = tree.query([h["lat"], h["lon"] * np.cos(np.radians(13))])
        if dist * 111 < 1.5:  # within 1.5 km of the major road network
            hs.append(h | {"node": nodes[i]})

    edges = list(G.edges)
    g = grid_spec()
    samples = [G.edges[e]["sample"] for e in edges]
    flat_lon = np.array([p[0] for s in samples for p in s])
    flat_lat = np.array([p[1] for s in samples for p in s])
    seg = np.repeat(np.arange(len(edges)), [len(s) for s in samples])
    rr, cc = g.rc(flat_lat, flat_lon)
    node_rc = g.rc(lat, lon)
    return {"G": G, "nodes": nodes, "node_rc": node_rc, "node_pop": pop, "edges": edges, "hospitals": hs, "seg": seg, "rr": rr, "cc": cc,
            "total_pop": float(pop.sum())}


def _times_to_hospital(G, sources, weight):
    if not sources:
        return {}
    return nx.multi_source_dijkstra_path_length(G.reverse(copy=False), sources, weight=weight)


@lru_cache
def baseline():
    net = network()
    G = net["G"]
    t = _times_to_hospital(G, {h["node"] for h in net["hospitals"]}, lambda u, v, d: d["t0"])
    cut = [n for n in net["nodes"] if t.get(n, np.inf) > C.CUTOFF_MINUTES]
    return {"times": t, "cut_pop": sum(G.nodes[n]["pop"] for n in cut)}


def run(depth: np.ndarray, detail: bool = True) -> dict:
    net = network()
    G, edges = net["G"], net["edges"]
    d = depth[net["rr"], net["cc"]]
    edge_depth = np.zeros(len(edges))
    np.maximum.at(edge_depth, net["seg"], d)
    closed = edge_depth >= C.DEPTH_CLOSED
    slowed = (edge_depth >= C.DEPTH_SLOW) & ~closed
    factor = {edges[i]: (None if closed[i] else SLOW_FACTOR) for i in np.flatnonzero(closed | slowed)}

    def weight(u, v, data):
        f = factor.get((u, v), 1.0)
        return None if f is None else data["t0"] * f

    g = grid_spec()
    hosp_out, live = [], set()
    for h in net["hospitals"]:
        r, c = g.rc(h["lat"], h["lon"])
        hd = float(depth[r, c])
        ok = hd < C.DEPTH_SLOW
        if ok:
            live.add(h["node"])
        hosp_out.append({"name": h["name"], "lat": h["lat"], "lon": h["lon"], "depth_m": round(hd, 2), "functional": ok})

    t = _times_to_hospital(G, live, weight)
    base = baseline()
    cut_nodes = [n for n in net["nodes"] if t.get(n, np.inf) > C.CUTOFF_MINUTES]
    cut_pop = sum(G.nodes[n]["pop"] for n in cut_nodes) - base["cut_pop"]
    unreachable = [n for n in net["nodes"] if n not in t]
    delays = [t[n] - base["times"][n] for n in net["nodes"] if n in t and n in base["times"]]

    km = lambda m: round(float(sum(G.edges[edges[i]]["length"] for i in np.flatnonzero(m))) / 1000 / 2, 1)  # /2: two-way
    node_depth = depth[net["node_rc"]]
    exposed = float(net["node_pop"][node_depth > C.DEPTH_SLOW].sum())
    out = {
        "people_exposed": int(exposed),
        "people_cut_off": int(max(0, cut_pop)),
        "people_unreachable": int(sum(G.nodes[n]["pop"] for n in unreachable)),
        "roads_closed_km": km(closed),
        "roads_slowed_km": km(slowed),
        "hospitals_total": len(hosp_out),
        "hospitals_flooded": sum(not h["functional"] for h in hosp_out),
        "median_extra_minutes": round(float(np.median(delays)), 1) if delays else 0.0,
        "p90_extra_minutes": round(float(np.percentile(delays, 90)), 1) if delays else 0.0,
    }
    if detail:
        names: dict[str, float] = {}
        for i in np.flatnonzero(closed):
            nm = G.edges[edges[i]]["name"]
            if nm:
                names[nm] = names.get(nm, 0) + G.edges[edges[i]]["length"] / 2000
        out["closed_roads_top"] = [{"name": k, "km": round(v, 2)} for k, v in sorted(names.items(), key=lambda kv: -kv[1])[:12]]
        out["hospitals"] = [h for h in hosp_out if not h["functional"]] + [h for h in hosp_out if h["functional"]][:0]
        out["segments"] = [
            {"coords": [[round(y, 5), round(x, 5)] for x, y in G.edges[edges[i]]["coords"]],
             "state": "closed" if closed[i] else "slowed", "depth_m": round(float(edge_depth[i]), 2)}
            for i in np.flatnonzero(closed | slowed)
        ]
        cut_pts = [(G.nodes[n]["lat"], G.nodes[n]["lon"], G.nodes[n]["pop"]) for n in cut_nodes
                   if base["times"].get(n, np.inf) <= C.CUTOFF_MINUTES]
        out["cut_off_nodes"] = [{"lat": round(a, 5), "lon": round(b, 5), "pop": int(p)} for a, b, p in cut_pts[:2000]]
    return out
