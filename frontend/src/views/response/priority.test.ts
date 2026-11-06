import { describe, expect, it } from 'vitest';
import { buildActions, confidenceOf, exposureOf, factorsOf, scoreOf, tierOf, urgencyOf, type Signal } from './priority';

const base: Signal = { id: 'x', source: 'physics', title: 't', loc: 'Bellandur', lat: 12.93, lon: 77.67, agency: 'BBMP / NDRF', measure: 'm', severity: 0.9, criticality: 0.7, people: 20000, etaH: 2 };
const score = (s: Partial<Signal>) => scoreOf(factorsOf({ ...base, ...s }));

describe('tiers', () => {
  it('uses thresholds 70/45/25', () => {
    expect(tierOf(70)).toBe('P1'); expect(tierOf(69.9)).toBe('P2');
    expect(tierOf(45)).toBe('P2'); expect(tierOf(44.9)).toBe('P3');
    expect(tierOf(25)).toBe('P3'); expect(tierOf(24.9)).toBe('Monitor'); expect(tierOf(0)).toBe('Monitor');
  });
  it('sets SLA deadlines', () => {
    const [a] = buildActions([{ ...base, severity: 1, criticality: 1, people: 1e6, etaH: 0 }], 0);
    expect(a.tier).toBe('P1'); expect(a.deadline).toBe(3600e3);
  });
});

describe('monotonicity', () => {
  it('more people → higher score', () => {
    expect(score({ people: 100 })).toBeLessThan(score({ people: 10000 }));
    expect(score({ people: 10000 })).toBeLessThan(score({ people: 1e6 }));
    expect(exposureOf(0.7, 1e9)).toBeLessThanOrEqual(1);
  });
  it('closer ETA → higher score', () => {
    expect(score({ etaH: 0 })).toBeGreaterThan(score({ etaH: 3 }));
    expect(score({ etaH: 3 })).toBeGreaterThan(score({ etaH: 24 }));
    expect(urgencyOf(0)).toBe(1); expect(urgencyOf(24)).toBe(0.5);
  });
  it('higher severity → higher score', () => expect(score({ severity: 0.4 })).toBeLessThan(score({ severity: 0.8 })));
});

describe('confidence', () => {
  it('physics > synthetic > single complaint', () => {
    expect(score({ source: 'physics' })).toBeGreaterThan(score({ source: 'model' }));
    expect(confidenceOf('physics')).toBe(1); expect(confidenceOf('model')).toBe(0.7); expect(confidenceOf('citizen')).toBe(0.5);
  });
  it('rises with corroborating complaints and upvotes, capped', () => {
    expect(confidenceOf('citizen', 3)).toBeGreaterThan(confidenceOf('citizen', 1));
    expect(confidenceOf('citizen', 1, 10)).toBeGreaterThan(confidenceOf('citizen', 1, 0));
    expect(confidenceOf('citizen', 100, 1e6)).toBe(0.95);
  });
});

describe('dedupe', () => {
  it('merges same agency + nearby location and keeps evidence', () => {
    const acts = buildActions([
      { ...base, id: 'a', source: 'model', severity: 0.6 },
      { ...base, id: 'b', source: 'citizen', loc: 'Pothole near lake', lat: 12.931, lon: 77.671, count: 2, upvotes: 3 },
      { ...base, id: 'c', agency: 'BESCOM' },
      { ...base, id: 'd', loc: 'Hebbal', lat: 13.03, lon: 77.59 },
    ]);
    expect(acts).toHaveLength(3);
    const m = acts.find(a => a.sources.length === 2)!;
    expect(m.sources.sort()).toEqual(['citizen', 'model']);
    expect(m.confidence).toBeCloseTo(0.8);
    expect(m.evidence.find(e => e.source === 'citizen')!.count).toBe(2);
  });
  it('merges by name when coordinates are missing', () => {
    const acts = buildActions([{ ...base, id: 'r1', lat: undefined, lon: undefined, loc: 'Outer Ring Road' }, { ...base, id: 'r2', lat: undefined, lon: undefined, loc: 'outer ring road' }]);
    expect(acts).toHaveLength(1);
  });
  it('is sorted by score descending', () => {
    const acts = buildActions([{ ...base, id: 'lo', loc: 'A', lat: 13.1, lon: 77.5, severity: 0.3 }, { ...base, id: 'hi', loc: 'B', lat: 12.8, lon: 77.8 }]);
    expect(acts[0].score).toBeGreaterThanOrEqual(acts[1].score);
  });
});
