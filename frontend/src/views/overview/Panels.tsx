/* Overview panels: KPI strip, impact summary, recommended actions, forecast chart, scenario controls, tabs card, gauges.
   Includes the backend overrides of the legacy arkham-backend script (applyOverview / _tab). */
import { useEffect, useRef, useState } from 'react';
import { HZ, INT, S, fmtN, fv, pad } from '../../engine';
import { bump, useStore, useTick } from '../../store';
import { applyInterventions, setIntensity } from '../../actions';
import { api, IV } from '../../api';
import { offline } from '../../backend';

export const HZ_LABEL: Record<string, string> = { flood: 'Flood', heat: 'Urban heat', water: 'Water stress', epi: 'Epidemic outbreak', grid: 'Power grid', traffic: 'Traffic', rad: 'Radiation (drill)', crowd: 'Crowd & civil' };
const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
/** Backend overview result, only when it applies (backend OK + flood). */
export function useOv() {
  const bk = useStore(s => s.bk);
  return bk.ok && S.hz === 'flood' ? bk.ov : null;
}

/** Legacy num(): eases from the previous value to the new one over 500 ms. */
function Num({ to, dec, fmt: f, id }: { to: number; dec: number; fmt?: ((v: number) => string) | null; id: string }) {
  const ref = useRef<HTMLElement>(null);
  const from = useRef(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const a = from.current, t0 = performance.now(); from.current = to; let raf = 0;
    const s = (n: number) => { const p = Math.min(1, (n - t0) / 500), v = a + (to - a) * (1 - Math.pow(1 - p, 3)); el.textContent = f ? f(v) : v.toFixed(dec); if (p < 1) raf = requestAnimationFrame(s); };
    s(t0);
    return () => { cancelAnimationFrame(raf); from.current = to; };
  }, [to, dec, f]);
  return <u ref={ref} id={id} style={{ textDecoration: 'none' }} />;
}

export function Kpis() {
  useTick();
  const h = HZ[S.hz], m = fv() * S.m, r = useOv();
  let vals = [Math.round(h.k[0] * m), +(h.k[1] * m).toFixed(1), Math.round(h.k[2] * m), Math.round(h.k[3] * m), Math.round(h.k[4] * m)];
  let L: string[] = h.L;
  if (r) {
    const c = r.cascade, f = r.flood;
    vals = [r.hotspots.length, f.flooded_km2_gt_0_3m, c.people_exposed, c.hospitals_flooded, Math.round(c.roads_closed_km)];
    L = ['Flood clusters', 'Area > 0.3 m', 'People in flooded cells', 'Hospitals flooded', 'Roads closed (km)'];
  }
  return (
    <div className="card kp"><div className="ttl"><small>HAZARD STATUS</small><div id="hn">{h.n}</div></div>
      <div id="mets" style={{ display: 'flex', flex: 1 }}>
        {L.map((l, i) => (
          <div className="m" key={i}><span>{l}</span>
            <b><Num id={'m' + i} to={vals[i]} dec={i === 1 ? 1 : 0} fmt={i === 2 ? fmtN : null} />{i === 1 && <> <small style={{ fontSize: 11, color: 'var(--mu)' }}>km²</small></>}</b>
            <i>{S.m < 1 ? '▼ ' + Math.round((1 - S.m) * 100) + '% mitigated' : '▲ vs baseline'}</i></div>))}
      </div>
    </div>
  );
}

export function Impact() {
  useTick();
  const h = HZ[S.hz], f = fv(), m = f * S.m, r = useOv();
  if (r) {
    const c = r.cascade, fl = r.flood, v = r.validation;
    const rows: [string, any][] = [['Roads closed ≥ 0.7 m', c.roads_closed_km + ' km'], ['Roads slowed 0.3–0.7 m', c.roads_slowed_km + ' km'], ['Hospitals flooded', c.hospitals_flooded + ' / ' + c.hospitals_total], ['Extra travel (p90)', '+' + c.p90_extra_minutes + ' min'], ['People cut off from care (>30 min)', fmt(c.people_cut_off)], ['Max modelled depth', fl.max_depth_m + ' m']];
    return (
      <div id="imp">
        {rows.map(x => <div className="row" key={x[0]}><span>{x[0]}</span><b>{x[1]}</b></div>)}
        <div className="row"><span style={{ color: 'var(--mu)' }}>Validation vs {v.points} BBMP points</span><span style={{ fontFamily: 'var(--mono)' }}>{Math.round(v.hit_rate * 100)}% hit · {Math.round(v.area_flagged_share * 100)}% area · {v.lift_over_random}×</span></div>
        {c.closed_roads_top?.length ? <div className="row"><span style={{ color: 'var(--mu)' }}>Worst closures</span><span style={{ fontSize: 11 }}>{c.closed_roads_top.slice(0, 3).map((x: any) => x.name).join(', ')}</span></div> : null}
      </div>
    );
  }
  const rows: [string, number][] = h.I.map((l: string, i: number) => [l, Math.round(h.ik[i] * m)]);
  rows.push(['People cut off from care', Math.round(h.k[2] * .31 * m)]);
  return (
    <div id="imp">
      {rows.map(x => <div className="row" key={x[0]}><span>{x[0]}</span><b>{x[1].toLocaleString('en-IN')}</b></div>)}
      <div className="row"><span style={{ color: 'var(--mu)' }}>Ensemble ±20%</span><span style={{ fontFamily: 'var(--mono)' }}>{Math.round(h.k[2] * .31 * Math.max(0, Math.min(1, f * .8)) * S.m).toLocaleString('en-IN')}–{Math.round(h.k[2] * .31 * Math.min(1, f * 1.2) * S.m).toLocaleString('en-IN')}</span></div>
    </div>
  );
}

export function Actions() {
  useTick();
  const sent = useStore(s => s.sent), dispatch = useStore(s => s.dispatch);
  return (
    <div id="acts">{HZ[S.hz].A.map((a: string) => { const k = 'ov|' + S.hz + '|' + a, ok = sent.has(k);
      return <div className="act" key={a}><span style={{ flex: 1 }}>{a}</span><button className={'btn' + (ok ? ' ok' : '')} onClick={() => dispatch(k)}>{ok ? 'Sent ✓' : 'Dispatch'}</button></div>; })}</div>
  );
}

export function ForecastChart() {
  useTick();
  const f = fv(), h = HZ[S.hz]; const p: number[] = [];
  for (let i = 0; i <= 24; i++) p.push(Math.exp(-Math.pow((i - 13) / 4, 2)) * f);
  const X = (i: number) => 10 + i * 11.4, Y = (v: number) => 120 - v * 95, pts = (a: number[], s: number) => a.map((v, i) => X(i) + ',' + Y(Math.min(1, v * s))).join(' ');
  return (
    <svg id="ch" viewBox="0 0 300 140" preserveAspectRatio="none" style={{ flex: 1, width: '100%', minHeight: 0 }}>
      <polygon points={`${pts(p, 1.2)} ${[...p].reverse().map((v, i) => X(24 - i) + ',' + Y(v * .8)).join(' ')}`} fill={`rgba(${h.col},.22)`} />
      <polyline points={pts(p, 1)} fill="none" stroke={`rgb(${h.col})`} strokeWidth="1.6" />
      <line x1="10" x2="290" y1="120" y2="120" stroke="#2b3138" />
      <line x1={X(S.t + 6)} x2={X(S.t + 6)} y1="10" y2="120" stroke="#FBC246" strokeDasharray="3" />
      <text x="10" y="134">now</text><text x="130" y="134">+12 h</text><text x="262" y="134">+24 h</text>
      <text x="12" y="16">{h.c.split(' (')[0]} · band = ±20%</text>
    </svg>
  );
}

export function Controls() {
  useTick();
  const h = HZ[S.hz];
  const [pr, setPr] = useState(0);
  const iv = useRef<any>(null);
  useEffect(() => () => { if (iv.current) { clearInterval(iv.current); S.t = 6; } }, []);
  const run = () => {
    if (iv.current) clearInterval(iv.current);
    let p = 0;
    iv.current = setInterval(() => {
      p += 2.5; setPr(Math.min(p, 100)); S.t = Math.round(Math.min(p, 100) * .12); bump();
      if (p >= 105) { clearInterval(iv.current); iv.current = null; setPr(0); S.t = 6; bump(); }
    }, 120);
  };
  return (
    <div className="card"><div className="t">Scenario controls</div><div className="ctl">
      <label>Hazard<b id="hl">{HZ_LABEL[S.hz]}</b></label>
      <label><span id="cl">{h.c}</span><b id="cv">{S.v}</b></label>
      <input type="range" id="sl" min={h.a} max={h.b} value={S.v} onChange={e => setIntensity(+e.target.value)} />
      <label>Ensemble spread<b>±20%</b></label>
      <button className="run" id="run" onClick={run}>▶ Run simulation</button>
      <div className="bar"><i id="pr" style={{ width: pr + '%' }} /></div>
    </div></div>
  );
}

export function PlayButton() {
  useTick();
  return <button className="btn" id="play" onClick={() => {
    if (S.play) { clearInterval(S.play); S.play = null; bump(); return; }
    S.t = 0; S.play = setInterval(() => { S.t = (S.t + 1) % 13; bump(); }, 450); bump();
  }}>{S.play ? '❚❚ Pause' : '▶ Play'}</button>;
}

const T = ['Live event feed', 'Ensemble probability', 'Response status', 'Scenario planner'];
function Feed() {
  const [ev, setEv] = useState<{ id: number; t: string; s: string }[]>([]);
  const hz = S.hz;
  useEffect(() => {
    setEv([]); let n = 0;
    const i = setInterval(() => {
      if (S.tab) return;
      const d = new Date(), e = HZ[S.hz].E;
      setEv(a => [{ id: n++, t: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, s: e[Math.floor(Math.random() * e.length)] }, ...a].slice(0, 9));
    }, 2600);
    return () => clearInterval(i);
  }, [hz]);
  return <>{ev.map(e => <div className="ev" key={e.id}><u>{e.t}</u>{e.s}</div>)}</>;
}
function Bars({ d, note }: { d: [string, number][]; note: string }) {
  return <>{d.map(([l, v]) => <div key={l}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{l}</span><b style={{ fontFamily: 'var(--mono)' }}>{Math.round(v * 100)}%</b></div><div className="bar"><i style={{ width: v * 100 + '%' }} /></div></div>)}<span style={{ color: 'var(--mu)' }}>{note}</span></>;
}
function Planner() {
  const bk = useStore(s => s.bk);
  const [busy, setBusy] = useState(false);
  const cost = [...S.sel].reduce((a: number, i: number) => a + INT[i][2], 0);
  const pick = (i: number, on: boolean) => {
    if (on && cost + INT[i][2] > S.budget) return;
    const s = new Set<number>(S.sel); if (on) s.add(i); else s.delete(i); applyInterventions(s);
  };
  const o = bk.opt, ok = o && o.budget_cr == S.budget && o.rain == S.v;
  return (
    <>
      <label style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--mu)' }}>Budget (₹ crore)<b style={{ color: 'var(--tx)' }}>{S.budget}</b></label>
      <input type="range" min="50" max="400" step="10" value={S.budget} onChange={e => { S.budget = +e.target.value; bump(); }} />
      {INT.map((x: any[], i: number) => <label key={i} style={{ display: 'flex', gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={S.sel.has(i)} onChange={e => pick(i, e.target.checked)} /><span style={{ flex: 1 }}>{x[0]}</span><span style={{ fontFamily: 'var(--mono)', color: 'var(--mu)' }}>₹{x[2]}</span></label>)}
      <div className="row" style={{ padding: '4px 0' }}><span>Spend</span><b style={cost > S.budget ? { background: '#5a1a10' } : { background: '#173a28', color: '#9be0b8' }}>₹{cost} / {S.budget}</b></div>
      <div style={{ color: 'var(--mu)' }}>Impact reduced by <b style={{ color: 'var(--gr)' }}>{Math.round((1 - S.m) * 100)}%</b></div>
      {bk.ok && S.hz === 'flood' && (
        <div style={{ borderTop: '1px solid #2b3138', marginTop: 8, paddingTop: 8 }}>
          <button className="btn" id="bkOpt" onClick={() => {
            setBusy(true); const rain = S.v;
            api.optimize(rain, S.budget).then(r => {
              useStore.getState().setBk({ opt: { ...r, rain } });
              applyInterventions(r.best.interventions.map((i: string) => IV.indexOf(i as any)));
            }).catch(offline).finally(() => setBusy(false));
          }}>{busy ? 'Optimising 32 portfolios…' : `⚙ Optimise within ₹${S.budget} cr (backend)`}</button>
          {ok && <div style={{ marginTop: 6 }}>Best: <b>{o.best.interventions.map((i: string) => INT[IV.indexOf(i as any)][0]).join(' + ') || 'no action'}</b> · ₹{o.best.cost_cr} cr<br />
            <small>Protects {fmt(o.people_protected)} people from hospital cut-off · roads closed {o.baseline.roads_closed_km} → {o.best.roads_closed_km} km</small></div>}
        </div>)}
    </>
  );
}
export function TabsCard() {
  useTick();
  const f = fv(), r = useOv();
  let body: React.ReactNode = null;
  if (S.tab === 0) body = <Feed />;
  else if (S.tab === 1) {
    const p = r?.probabilities;
    body = p
      ? <Bars d={[['P(flood > 0.3 m)', p.p_flood_gt_0_3m], ['P(roads blocked > 0.7 m)', p.p_roads_blocked_gt_0_7m], ['P(>1,000 people cut off)', p.p_hospital_cut_off]]}
        note={`${p.members}-member rainfall ensemble (${Math.min(...p.member_rain_mm)}–${Math.max(...p.member_rain_mm)} mm) · physics backend`} />
      : <Bars d={[['P(flood > 0.3 m)', f * .95], ['P(roads blocked > 0.7 m)', f * .7], ['P(hospital cut-off)', f * .55]]} note="Ensemble of rainfall −20% / base / +20%." />;
  } else if (S.tab === 2) body = ['NDRF teams staged|4/6', 'Ambulances re-routed|12', 'Shelters open|9/14', 'Pumps active|31/40'].map(s => { const [a, b] = s.split('|'); return <div className="row" key={a} style={{ padding: '3px 0' }}><span>{a}</span><span style={{ fontFamily: 'var(--mono)' }}>{b}</span></div>; });
  else body = <Planner />;
  return <div className="card" style={{ flex: 1 }}><div className="t" id="tt">{T[S.tab]}</div><div id="tc" className="pad">{body}</div></div>;
}

/** Legacy gauges(): two jittering readouts refreshed every second. */
export function Gauges() {
  useTick();
  const [, set] = useState(0);
  useEffect(() => { const i = setInterval(() => set(x => x + 1), 1000); return () => clearInterval(i); }, []);
  const f = fv(), G = HZ[S.hz].G;
  const g = (i: number) => { const [l, u, b, s, d] = G[i]; return [l, (b + f * s + (Math.random() - .5) * Math.abs(s) * .05).toFixed(d) + ' ' + u]; };
  const [l1, v1] = g(0), [l2, v2] = g(1);
  return <div className="ov" style={{ left: 10, top: 10 }}><i className="live" /><span id="gl1">{l1}</span> <b id="g1">{v1}</b><br /><span id="gl2">{l2}</span> <b id="g2">{v2}</b> <span style={{ color: 'var(--c2)' }}>Synthetic feed</span></div>;
}
