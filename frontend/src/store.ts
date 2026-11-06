/* Reactive bridge. The ported engine keeps the legacy mutable state objects (S, M, D in engine/legacy.ts);
   components subscribe to `tick` and call `bump()` after mutating them. App-level UI + backend state lives here. */
import { create } from 'zustand';
import { S } from './engine';

export type View = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 overview, 1 modelling, 2 response, 3 domains, 4 impact, 5 crime, 6 citizen reports
export interface Backend {
  ok: boolean;
  health: any | null;
  ov: any | null;          // /scenario for the overview (rain = S.v, interventions = S.sel)
  ms: any | null;          // /scenario for hazard modelling (rain = M.rain, drain = M.cap)
  samp: Record<string, { depth_m: number; probability: number }>;
  live: any | null;        // /rainfall when it is an observed forecast
  opt: any | null;         // last /optimize result (+ rain)
}
interface St {
  tick: number;
  bump: () => void;
  hero: boolean;
  view: View;
  nv: number;
  report: null | 'main' | 'domain';
  sent: Set<string>;
  bk: Backend;
  setBk: (p: Partial<Backend>) => void;
  go: (view: View, nv: number) => void;
  dispatch: (k: string) => void;
  setHero: (v: boolean) => void;
  openReport: (r: St['report']) => void;
}
export const useStore = create<St>((set) => ({
  tick: 0,
  bump: () => set(s => ({ tick: s.tick + 1 })),
  hero: true,
  view: 0,
  nv: 0,
  report: null,
  sent: new Set(),
  bk: { ok: false, health: null, ov: null, ms: null, samp: {}, live: null, opt: null },
  setBk: (p) => set(s => ({ bk: { ...s.bk, ...p } })),
  go: (view, nv) => { S.view = view; S.nv = nv; set(s => ({ view, nv, tick: s.tick + 1 })); },
  dispatch: (k) => set(s => ({ sent: new Set(s.sent).add(k) })),
  setHero: (hero) => set({ hero }),
  openReport: (report) => set({ report }),
}));
/** Re-render on any engine mutation. */
export const useTick = () => useStore(s => s.tick);
export const bump = () => useStore.getState().bump();
