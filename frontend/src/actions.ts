/* Shared user actions (ports of the legacy global handlers). */
import { HZ, M, S } from './engine';
import { bump, useStore, type View } from './store';
import { fetchModel, fetchOverview } from './backend';

/** Legacy hzSet(): switch the overview hazard and reset its slider/interventions. */
export function hzSet(k: string) {
  S.hz = k; const h = HZ[k]; S.v = h.v; S.m = 1; S.sel.clear(); S.tab = 0;
  bump(); fetchOverview();
}
/** Overview slider. */
export function setIntensity(v: number) { S.v = v; bump(); fetchOverview(); }
/** Recompute the legacy mitigation factor after interventions change. */
import { INT } from './engine';
export function applyInterventions(sel: Iterable<number>) {
  S.sel = new Set(sel);
  S.m = Math.max(0.35, 1 - [...S.sel].reduce((a: number, j: number) => a + INT[j][1], 0) * 1.5);
  bump(); fetchOverview();
}
/** Navigation menu (NAV index -> view). Mirrors the legacy handler incl. the Impact Analysis view. */
export function navigate(n: number) {
  const { go, bk } = useStore.getState();
  let v: View = 0;
  if (n === 0) { S.tab = 0; v = 0; }
  else if (n === 1) { S.tab = 0; v = 1; }
  else if (n === 2) { if (bk.ok) v = 4; else { S.tab = 1; v = 0; } }
  else if (n === 3) v = 2;
  else if (n === 4) v = 3;
  else if (n === 6) v = 5; // Crime Intelligence (Suraksha-Grid service)
  else if (n === 7) v = 6; // Citizen Reports (complaints)
  else { // Scenarios: planner tab on the overview, presets on hazard modelling
    const cur = useStore.getState().view;
    if (cur === 1) v = 1; else { S.tab = 3; v = 0; }
  }
  go(v, n);
  if (v === 1) fetchModel(); else if (v === 0) fetchOverview();
}
export function setMode(mode: 'live' | 'sim') { M.mode = mode; if (mode === 'live') M.leak = 0; bump(); fetchModel(); }
