/* Resilience planning: intervention catalogue metadata, storm ladder and data fetching for the Domains tab. */
import { api } from '../../api';

export const STORMS = [50, 70, 90, 110, 130, 150, 175, 200];       // event rain, mm in 6 h
export const FUNCTION_LOSS = 10_000;                                 // people cut off from care => city "breaks"

export interface Iv { id: string; label: string; cost: number }
export const IV_FALLBACK: Iv[] = [
  { id: 'desilt', label: 'Desilt primary drains', cost: 60 }, { id: 'pumps', label: 'Add 12 pump stations', cost: 45 },
  { id: 'permeable', label: 'Permeable pavements, 8 wards', cost: 35 }, { id: 'bellandur', label: 'Widen Bellandur outfall', cost: 90 },
  { id: 'lakes', label: 'Restore 3 lost lakes', cost: 180 },
];

/** Indicative delivery phase, owner and qualitative co-benefits per intervention (planning metadata, not model output). */
export const META: Record<string, { phase: number; when: string; owner: string; co: string[]; icon: string }> = {
  desilt: { phase: 0, when: '0–3 months', owner: 'BBMP Storm Water Drains', co: ['Public health', 'Transport'], icon: '⛏' },
  pumps: { phase: 0, when: '0–6 months', owner: 'BBMP Storm Water Drains', co: ['Transport'], icon: '⚙' },
  permeable: { phase: 1, when: '6–18 months', owner: 'BBMP Roads / wards', co: ['Urban heat', 'Water security'], icon: '▦' },
  bellandur: { phase: 2, when: '1–2 years', owner: 'BBMP SWD + BDA', co: ['Environment'], icon: '⇶' },
  lakes: { phase: 3, when: '3–5 years', owner: 'BBMP Lakes + KTCDA', co: ['Water security', 'Urban heat', 'Environment'], icon: '◍' },
};
export const PHASES = ['Before this monsoon', 'Next 18 months', '1–2 years', '3–5 years'];

export interface Outcome { rain: number; cut: number; roads: number; slowed: number; hosp: number; exposed: number; km2: number }

const cache = new Map<string, Promise<Outcome>>();
export function outcome(rain: number, iv: string[], drain = 100): Promise<Outcome> {
  const k = `${rain}|${drain}|${[...iv].sort().join(',')}`;
  if (!cache.has(k)) {
    const p = api.scenario(rain, drain, [...iv].sort().join(',')).then((s: any) => ({
      rain, cut: s.cascade.people_cut_off, roads: s.cascade.roads_closed_km, slowed: s.cascade.roads_slowed_km,
      hosp: s.cascade.hospitals_flooded, exposed: s.cascade.people_exposed, km2: s.flood.flooded_km2_gt_0_3m,
    }));
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return cache.get(k)!;
}
export const curve = (iv: string[], drain = 100) => Promise.all(STORMS.map(r => outcome(r, iv, drain)));

/** Storm size (mm / 6 h) at which people cut off first exceed FUNCTION_LOSS, linearly interpolated. */
export function breakingPoint(c: Outcome[]): number | null {
  for (let i = 0; i < c.length; i++) {
    if (c[i].cut > FUNCTION_LOSS) {
      if (i === 0) return c[0].rain;
      const a = c[i - 1], b = c[i];
      return Math.round(a.rain + (FUNCTION_LOSS - a.cut) / (b.cut - a.cut) * (b.rain - a.rain));
    }
  }
  return null; // holds across the whole ladder
}

export const fmt = (n: number) => n >= 1e5 ? (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' lakh' : Math.round(n).toLocaleString('en-IN');
