/* Transparent priority scoring for Response Planning. Pure: no engine/store imports, so it is unit-testable.

   priority_score = 100 × Severity × Exposure × Urgency × Confidence      (each factor in 0–1)

   Severity   – how bad the hazard is where it acts (signal-specific, see signals.ts):
                synthetic asset → modelled risk r; physics hotspot → 0.5·probability + 0.5·min(1, depth/1.5 m);
                flooded hospital → min(1, 0.5 + depth/2); complaint → low .30 / medium .55 / high .80 / critical 1.0.
   Exposure   – who/what is hit: 0.45·Criticality + 0.55·PeopleFactor,
                Criticality by asset class (hospital 1.0 > radiation .8 > substation .85 > water .75 > flood/disease .7 …),
                PeopleFactor = min(1, log10(1 + people) / 6)  (1 person → .05, 1k → .5, 1M → 1.0);
                unknown people count → PeopleFactor 0.5 (≈1 000 people assumed).
   Urgency    – time-to-impact from the cascade ETA (hours): U = 24 / (24 + ETA)  (now → 1.0, 3 h → .89, 12 h → .67, 72 h → .25).
   Confidence – physics-backed 1.0; synthetic model 0.7; citizen complaint 0.5, +0.1 per corroborating complaint and
                +0.05·log2(1 + upvotes), capped 0.95. Merged actions take the best source, +0.1 if ≥2 source types agree (cap 1).

   Tiers: P1 ≥ 70 (respond within 1 h) · P2 ≥ 45 (3 h) · P3 ≥ 25 (12 h) · otherwise Monitor. */

export type Source = 'physics' | 'model' | 'citizen';
export type Tier = 'P1' | 'P2' | 'P3' | 'Monitor';
export interface Signal {
  id: string;
  source: Source;
  title: string;          // short label of what was detected
  loc: string;
  lat?: number; lon?: number;
  agency: string;
  measure: string;
  severity: number;       // 0–1
  criticality: number;    // 0–1 asset-class weight
  people?: number;        // people affected, if known
  etaH: number;           // hours until impact
  prevents?: string[];    // downstream cascade chain this action interrupts
  count?: number;         // complaints in a cluster
  upvotes?: number;
}
export interface Evidence { source: Source; label: string; count: number }
export interface Factors { severity: number; exposure: number; urgency: number; confidence: number }
export interface Action extends Factors {
  key: string;
  loc: string; lat?: number; lon?: number;
  agency: string;
  measure: string;
  title: string;
  people: number;
  etaH: number;
  prevents: string[];
  evidence: Evidence[];
  sources: Source[];
  score: number;
  tier: Tier;
  slaH: number | null;
  deadline: number | null; // epoch ms
}

export const TIERS: { t: Tier; min: number; slaH: number | null; label: string }[] = [
  { t: 'P1', min: 70, slaH: 1, label: 'Respond within 1 h' },
  { t: 'P2', min: 45, slaH: 3, label: 'Respond within 3 h' },
  { t: 'P3', min: 25, slaH: 12, label: 'Respond within 12 h' },
  { t: 'Monitor', min: 0, slaH: null, label: 'Watch, no dispatch' },
];
export const CRITICALITY: Record<string, number> = {
  hospital: 1, rd: 0.8, pw: 0.85, wq: 0.75, pl: 0.75, fl: 0.7, cs: 0.7, cr: 0.65, tr: 0.6, in: 0.6, road: 0.6, wh: 0.45, other: 0.5,
};
export const COMPLAINT_SEVERITY: Record<string, number> = { low: 0.3, medium: 0.55, high: 0.8, critical: 1 };
export const COMPLAINT_ETA: Record<string, number> = { low: 24, medium: 6, high: 2, critical: 0 };
export const BASE_CONF: Record<Source, number> = { physics: 1, model: 0.7, citizen: 0.5 };

const clp = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
export const peopleFactor = (n?: number) => (n == null ? 0.5 : clp(Math.log10(1 + Math.max(0, n)) / 6));
export const exposureOf = (crit: number, people?: number) => clp(0.45 * clp(crit) + 0.55 * peopleFactor(people));
export const urgencyOf = (etaH: number) => clp(24 / (24 + Math.max(0, etaH)));
export function confidenceOf(source: Source, count = 1, upvotes = 0) {
  if (source !== 'citizen') return BASE_CONF[source];
  return Math.min(0.95, 0.5 + 0.1 * Math.max(0, count - 1) + 0.05 * Math.log2(1 + Math.max(0, upvotes)));
}
export const scoreOf = (f: Factors) => 100 * clp(f.severity) * clp(f.exposure) * clp(f.urgency) * clp(f.confidence);
export const tierOf = (score: number): Tier => TIERS.find(t => score >= t.min)!.t;
export const slaOf = (t: Tier) => TIERS.find(x => x.t === t)!.slaH;

export function factorsOf(s: Signal): Factors {
  return { severity: clp(s.severity), exposure: exposureOf(s.criticality, s.people), urgency: urgencyOf(s.etaH), confidence: confidenceOf(s.source, s.count, s.upvotes) };
}

export function kmBetween(a: { lat?: number; lon?: number }, b: { lat?: number; lon?: number }) {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return Infinity;
  const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Same agency AND (same normalised place name OR within `km` of each other). */
export const sameTarget = (a: { agency: string; loc: string; lat?: number; lon?: number }, b: typeof a, km = 1.5) =>
  a.agency === b.agency && (norm(a.loc) === norm(b.loc) || kmBetween(a, b) <= km);

/** Score signals, merge duplicates (same agency + location) and rank. `now` = epoch ms for SLA deadlines. */
export function buildActions(signals: Signal[], now = Date.now()): Action[] {
  const groups: Signal[][] = [];
  // Physics first so merged actions keep the most authoritative title/location.
  const order = [...signals].sort((a, b) => BASE_CONF[b.source] - BASE_CONF[a.source]);
  for (const s of order) {
    const g = groups.find(g => sameTarget(g[0], s));
    g ? g.push(s) : groups.push([s]);
  }
  const acts = groups.map(g => {
    const head = g[0], fs = g.map(factorsOf);
    const sources = [...new Set(g.map(s => s.source))];
    const cit = g.filter(s => s.source === 'citizen');
    const citN = cit.reduce((a, s) => a + (s.count ?? 1), 0), citUp = cit.reduce((a, s) => a + (s.upvotes ?? 0), 0);
    const best = Math.max(...sources.filter(s => s !== 'citizen').map(s => BASE_CONF[s]), citN ? confidenceOf('citizen', citN, citUp) : 0);
    const f: Factors = {
      severity: Math.max(...fs.map(x => x.severity)),
      exposure: Math.max(...fs.map(x => x.exposure)),
      urgency: Math.max(...fs.map(x => x.urgency)),
      confidence: Math.min(1, best + (sources.length > 1 ? 0.1 : 0)),
    };
    const score = Math.round(scoreOf(f) * 10) / 10, tier = tierOf(score), slaH = slaOf(tier);
    const ev: Evidence[] = [];
    for (const s of g) {
      const lb = s.title, e = ev.find(e => e.source === s.source);
      if (e) { e.count += s.count ?? 1; if (!e.label.includes(lb)) e.label += '; ' + lb; } else ev.push({ source: s.source, label: lb, count: s.count ?? 1 });
    }
    const a: Action = {
      ...f, key: 'rsp-' + g.map(s => s.id).sort()[0], loc: head.loc, lat: head.lat, lon: head.lon, agency: head.agency,
      measure: head.measure, title: head.title, people: Math.max(0, ...g.map(s => s.people ?? 0)),
      etaH: Math.min(...g.map(s => s.etaH)), prevents: g.find(s => s.prevents?.length)?.prevents ?? [],
      evidence: ev, sources, score, tier, slaH, deadline: slaH == null ? null : now + slaH * 3600e3,
    };
    return a;
  });
  return acts.sort((a, b) => b.score - a.score);
}

/** Overall threat = mean score of the top-5 actions: ≥60 Critical, ≥45 High, ≥25 Elevated, else Normal. */
export function threatOf(acts: Action[]) {
  const top = acts.slice(0, 5), v = top.length ? top.reduce((a, x) => a + x.score, 0) / top.length : 0;
  return { value: Math.round(v), level: v >= 60 ? 'Critical' : v >= 45 ? 'High' : v >= 25 ? 'Elevated' : 'Normal' };
}
