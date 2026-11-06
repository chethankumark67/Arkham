/* Connects the synthetic engine to the physics backend (port of the legacy "arkham-backend" integration):
   - flood assets ('fl') take their risk from modelled depth/probability at their location
   - live mode uses the Open-Meteo 48 h total as rainfall
   - the overview / modelling scenarios are fetched and cached in the store */
import { api, ivq } from './api';
import { HOOKS, M, P, S, clp, rainE } from './engine';
import { bump, useStore } from './store';

const st = () => useStore.getState();
const keys: Record<string, string | null> = {};
const timers: Record<string, any> = {};
const later = (k: string, fn: () => void, ms = 300) => { clearTimeout(timers[k]); timers[k] = setTimeout(fn, ms); };

HOOKS.risk = (p: any[], d: number) => {
  const b = st().bk;
  const s = b.ok && p[0] === 'fl' && b.samp[p[1]];
  if (!s) return null;
  const base = clp(0.55 * s.probability + 0.45 * Math.min(1, s.depth_m / 1.2));
  const tw = rainE(M.d) > 0 ? rainE(d) / rainE(M.d) : 1;
  return clp(base * tw);
};
HOOKS.afterSync = () => {
  const b = st().bk;
  if (b.ok && M.mode === 'live' && b.live) M.rain = Math.round(Math.max(20, Math.min(150, b.live.total_mm)));
};

export function offline(e?: unknown) {
  if (st().bk.ok) console.warn('ARKHAM backend error', e);
  st().setBk({ ok: false });
}

/** Overview scenario (flood only): rain = S.v, interventions = S.sel. */
export function fetchOverview() {
  if (!st().bk.ok || S.hz !== 'flood') return;
  const k = `${S.v}|${ivq(S.sel)}`;
  if (keys.ov === k) return;
  later('ov', () => api.scenario(S.v, 100, ivq(S.sel), { probabilities: true })
    .then(r => { keys.ov = k; st().setBk({ ov: r }); bump(); }).catch(offline));
}

/** Modelling scenario: rain = M.rain, drain = M.cap, plus point samples for the flood assets. */
export function fetchModel() {
  if (!st().bk.ok) return;
  const k = `${M.rain}|${M.cap}`;
  if (keys.ms === k) return;
  keys.ms = k;
  const fl = P.filter((p: any) => p[0] === 'fl');
  later('ms', () => Promise.all([
    api.scenario(M.rain, M.cap),
    api.sample(M.rain, M.cap, [], fl.map((p: any) => ({ id: p[1], lat: p[2], lon: p[3] }))),
  ]).then(([sc, sm]) => {
    const samp: Record<string, any> = {};
    sm.points.forEach((p: any) => (samp[p.id] = p));
    st().setBk({ ms: sc, samp });
    bump();
  }).catch(e => { keys.ms = null; offline(e); }), 400);
}

export function connect() {
  api.health().then(h => {
    if (!h.terrain || !h.roads) throw new Error('backend data missing');
    st().setBk({ ok: true, health: h });
    api.rainfall().then(r => { if (String(r.provenance).startsWith('Observed')) st().setBk({ live: r }); }).catch(() => {});
    fetchOverview(); fetchModel(); bump();
  }).catch(() => { st().setBk({ ok: false }); setTimeout(connect, 15000); });
}
