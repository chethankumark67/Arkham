/* Collects response signals from the engine (synthetic + cascade), backend physics and citizen complaints. */
import { CE, CN, GR, M, MS, OWN, P, TR, casc, risk, syncLive } from '../../engine';
import type { Backend } from '../../store';
import { COMPLAINT_ETA, COMPLAINT_SEVERITY, CRITICALITY, type Signal } from './priority';

const G2N: Record<string, string> = { fl: 'wl', pw: 'fd', tr: 'gl', cs: 'cs', wq: 'wq', pl: 'pp' };
const label = (id: string) => (CN as any[]).find(c => c[0] === id)?.[2] ?? id;
/** Assumed people served/affected per synthetic asset class at risk 1.0 (scaled by risk). */
export const CATCHMENT: Record<string, number> = { fl: 40000, pw: 60000, tr: 80000, cs: 30000, wq: 50000, pl: 100000, cr: 30000, in: 5000, wh: 1000, rd: 20000 };
const DENSITY = 12000; // people per km² (Bengaluru urban average, used for hotspot area → people)

/** Strongest downstream chain from a cascade node (what the action prevents). */
function chain(V: Record<string, number>, from: string): string[] {
  const out = [label(from)];
  let cur = from;
  for (let i = 0; i < 5; i++) {
    const nx = (CE as any[]).filter(e => e[0] === cur).sort((a, b) => V[b[1]] * b[2] - V[a[1]] * a[2])[0];
    if (!nx) break;
    cur = nx[1]; out.push(label(cur));
  }
  return out;
}

export interface Complaint { id: string | number; category?: string; title?: string; lat?: number; lon?: number; severity?: string; upvotes?: number; status?: string; assigned_agency?: string }
const CAT: [RegExp, string, string, string][] = [
  [/flood|water ?log|drain|rain/i, 'BBMP / NDRF', 'Deploy pumps; clear storm-drain inlets', 'fl'],
  [/power|electric|outage|transformer|streetlight/i, 'BESCOM', 'Send line crew; restore feeder', 'pw'],
  [/traffic|signal|pothole|road/i, 'Traffic Police', 'Deploy marshals; adaptive signal timing', 'tr'],
  [/sewage|water|supply|contamin/i, 'BWSSB', 'Inspect line; tanker supply; test water', 'wq'],
  [/health|disease|dengue|mosquito|fever/i, 'Health Dept', 'Fogging and fever survey in ward', 'cs'],
  [/crime|theft|safety|harass/i, 'Bengaluru Police', 'Increase patrol presence', 'cr'],
  [/fire|hazard|chemical/i, 'Fire & Emergency', 'Inspect and stage fire tender', 'in'],
];
const catOf = (c: Complaint) => CAT.find(x => x[1] && x[0].test(`${c.category ?? ''} ${c.title ?? ''}`)) ?? [/./, 'BBMP', 'Inspect and resolve on site', 'other'] as const;

/** Complaint agencies use short names (BBMP, BTP); the engine uses OWN labels. Map them so signals merge. */
const AGENCY_ALIAS: Record<string, string> = { BBMP: OWN.fl, BTP: OWN.tr, 'Traffic Police': OWN.tr };
const normAgency = (a: string) => AGENCY_ALIAS[a] || a;

export function collectSignals(bk: Backend, complaints: Complaint[], leak: boolean) {
  syncLive();
  const N = casc(), V = N.V as Record<string, number>, E = N.E as Record<string, number>, sig: Signal[] = [];
  // 1. synthetic / physics-backed engine assets (fl risk comes from physics samples when the backend is up)
  for (const p of P as any[]) {
    if (p[0] === 'rd' && !leak) continue;
    const r = risk(p);
    if (r < 0.3) continue;
    const g = p[0], node = G2N[g], phys = bk.ok && g === 'fl' && !!bk.samp[p[1]];
    sig.push({
      id: 'a' + p[5], source: phys ? 'physics' : 'model', title: `${GR[g][0]} · risk ${Math.round(r * 100)}%`, loc: p[1], lat: p[2], lon: p[3],
      agency: OWN[g], measure: MS[g][0], severity: r, criticality: CRITICALITY[g] ?? 0.5,
      people: phys ? Math.round(bk.samp[p[1]].probability * 1.5 * DENSITY) : Math.round((CATCHMENT[g] ?? 10000) * r),
      etaH: node ? E[node] : 0, prevents: node ? chain(V, node) : [],
    });
  }
  // 2. cascade aggregate: hospital access
  const cs = bk.ok ? bk.ms?.cascade : null;
  if (V.hc > 0.4 || (cs && cs.hospitals_flooded > 0))
    sig.push({
      id: 'hc', source: cs ? 'physics' : 'model', title: cs ? `${cs.hospitals_flooded} hospitals flooded · ${Math.round(cs.people_cut_off).toLocaleString()} cut off` : `Cascade: hospital access ${Math.round(V.hc * 100)}%`,
      loc: 'Hospital approaches (city-wide)', agency: 'Traffic Police + Health', measure: 'Keep ambulance corridors open; hold alternate routes to major hospitals',
      severity: cs ? Math.min(1, 0.5 + cs.hospitals_flooded / 100) : V.hc, criticality: CRITICALITY.hospital, people: cs?.people_cut_off,
      etaH: E.hc, prevents: [label('rb'), label('hc')],
    });
  if (cs) {
    // 3. physics: individual flooded hospitals, top hotspots, top closed roads
    for (const h of (cs.hospitals ?? []).filter((h: any) => !h.functional).sort((a: any, b: any) => b.depth_m - a.depth_m).slice(0, 4))
      sig.push({ id: 'hosp-' + h.name, source: 'physics', title: `Hospital flooded ${h.depth_m} m`, loc: h.name, lat: h.lat, lon: h.lon,
        agency: 'Health Dept', measure: 'Evacuate ground floor; stage mobile DG set and pumps', severity: Math.min(1, 0.5 + h.depth_m / 2),
        criticality: CRITICALITY.hospital, people: 20000, etaH: E.wl, prevents: [label('hc')] });
    for (const h of (bk.ms.hotspots ?? []).slice(0, 6))
      sig.push({ id: `hs-${h.lat}-${h.lon}`, source: 'physics', title: `Hotspot ${h.max_depth_m} m · p ${Math.round(h.probability * 100)}%`,
        loc: h.nearest_bbmp?.ward || h.nearest_bbmp?.name || `${h.lat.toFixed(3)}, ${h.lon.toFixed(3)}`, lat: h.lat, lon: h.lon,
        agency: OWN.fl, measure: MS.fl[0], severity: 0.5 * h.probability + 0.5 * Math.min(1, h.max_depth_m / 1.5),
        criticality: CRITICALITY.fl, people: Math.round(h.area_km2 * DENSITY), etaH: E.wl, prevents: chain(V, 'wl') });
    for (const r of (cs.closed_roads_top ?? []).slice(0, 3))
      sig.push({ id: 'road-' + r.name, source: 'physics', title: `${r.km} km closed`, loc: r.name, agency: OWN.tr, measure: MS.tr[1],
        severity: Math.min(1, r.km / 8), criticality: CRITICALITY.road, people: Math.round(r.km * 2000), etaH: E.rb, prevents: [label('rb'), label('hc')] });
  }
  // 4. citizen complaints, clustered by agency within ~1 km
  const cl: (Signal & { _n: number })[] = [];
  for (const c of complaints) {
    if (c.status && !/open|new|pending|progress/i.test(c.status)) continue;
    const [, ag, ms, g] = catOf(c), agency = normAgency(c.assigned_agency || ag), sv = (c.severity || 'medium').toLowerCase();
    const s: Signal & { _n: number } = { id: 'c' + c.id, source: 'citizen', title: c.title || c.category || 'Complaint', loc: c.title || c.category || 'Citizen report',
      lat: c.lat, lon: c.lon, agency, measure: ms, severity: COMPLAINT_SEVERITY[sv] ?? 0.55, criticality: CRITICALITY[g] ?? 0.5,
      etaH: COMPLAINT_ETA[sv] ?? 6, count: 1, upvotes: c.upvotes ?? 0, people: undefined, _n: 1 };
    const near = cl.find(x => x.agency === s.agency && x.lat != null && s.lat != null && Math.hypot(x.lat - s.lat!, (x.lon! - s.lon!) * 0.97) < 0.009);
    if (near) { near.count! += 1; near.upvotes! += s.upvotes!; near.severity = Math.max(near.severity, s.severity); near.etaH = Math.min(near.etaH, s.etaH); }
    else cl.push(s);
  }
  for (const s of cl) { if (s.count! > 1) s.loc = `${s.loc} (+${s.count! - 1} nearby)`; sig.push(s); }
  // routes (legacy TR)
  const routes = Object.entries(TR as Record<string, any[]>).map(([n, t]) => {
    const r = risk((P as any[]).find(q => q[0] === 'tr' && q[1] === n));
    return { n, alt: t[2] as string, r, delay: Math.round(r * 55), save: Math.round(r * 55 * 0.55) };
  }).filter(x => x.r > 0.35).sort((a, b) => b.r - a.r);
  return { signals: sig, routes, N, mode: (M.mode === 'sim' ? 'Simulation' : 'Live') + (bk.ok && bk.ms ? ' · physics' : ' · synthetic') };
}
