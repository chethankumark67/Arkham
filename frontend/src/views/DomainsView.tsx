/* Resilience Planning Studio: build an intervention plan within a budget, stress-test it across storm sizes on the
   physics backend, see the cost frontier and phased roadmap, and read its effect across the 12 city domains. */
import { useEffect, useMemo, useState } from 'react';
import { D, DOMAINS, selectedDomain } from '../engine';
import { bump, useStore, useTick } from '../store';
import { api } from '../api';
import DispatchButton from './domains/DispatchButton';
import { StressCurve, Frontier } from './domains/Charts';
import { FUNCTION_LOSS, IV_FALLBACK, META, PHASES, STORMS, breakingPoint, curve, fmt, type Iv, type Outcome } from './domains/plan';
import './domains/domains.css';

/** Domains the physics core measures directly, and how; the rest are illustrative. */
const MODELLED: Record<string, { k: string; v: (o: Outcome) => number; u: string }> = {
  climate: { k: 'Flooded > 0.3 m', v: o => o.km2, u: 'km²' },
  healthcare: { k: 'Hospitals flooded', v: o => o.hosp, u: '' },
  health: { k: 'People in flood water', v: o => o.exposed, u: '' },
  transport: { k: 'Roads closed', v: o => o.roads, u: 'km' },
  economy: { k: 'Freight network lost', v: o => Math.round(o.roads + .25 * o.slowed), u: 'km-eq' },
};
const CO_DOMAIN: Record<string, string> = { 'Public health': 'health', Transport: 'transport', 'Urban heat': 'environment', 'Water security': 'water', Environment: 'environment' };

export default function DomainsView() {
  useTick();
  const ok = useStore(s => s.bk.ok);
  const [ivs, setIvs] = useState<Iv[]>(IV_FALLBACK);
  const [plan, setPlan] = useState<string[]>(['desilt', 'permeable']);
  const [budget, setBudget] = useState(200);
  const [design, setDesign] = useState(110);
  const [base, setBase] = useState<Outcome[] | null>(null);
  const [planC, setPlanC] = useState<Outcome[] | null>(null);
  const [opt, setOpt] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { if (ok) api.meta().then((m: any) => m?.interventions && setIvs(m.interventions)).catch(() => {}); }, [ok]);
  useEffect(() => { if (!ok) return; curve([]).then(setBase).catch(e => setErr(String(e))); }, [ok]);
  useEffect(() => { if (!ok) return; let on = true; curve(plan).then(c => on && setPlanC(c)).catch(e => setErr(String(e))); return () => { on = false; }; }, [ok, plan]);
  useEffect(() => { if (!ok) return; let on = true; api.optimize(design, budget).then((o: any) => on && setOpt(o)).catch(() => {}); return () => { on = false; }; }, [ok, design, budget]);

  const label = useMemo(() => Object.fromEntries(ivs.map(i => [i.id, i.label])), [ivs]);
  const cost = plan.reduce((s, id) => s + (ivs.find(i => i.id === id)?.cost ?? 0), 0);
  const over = cost > budget;
  const di = STORMS.indexOf(design);
  const b = base?.[di], p = planC?.[di];
  const bpB = base ? breakingPoint(base) : null, bpP = planC ? breakingPoint(planC) : null;
  const protectedN = b && p ? b.cut - p.cut : 0;
  const perCr: Record<string, number> = Object.fromEntries((opt?.ranked_single_interventions ?? []).map((r: any) => [r.interventions[0], r.protected_per_cr]));
  const best: string[] | undefined = opt?.best?.interventions;
  const isBest = best && best.length === plan.length && best.every(x => plan.includes(x));
  const toggle = (id: string) => setPlan(pl => pl.includes(id) ? pl.filter(x => x !== id) : [...pl, id]);
  const coHit = new Set(plan.flatMap(id => META[id]?.co ?? []).map(c => CO_DOMAIN[c]));
  const pickDomain = (id: string) => { setOpen(o => o === id ? null : id); D.id = id; D.driver = selectedDomain().base; bump(); };
  const bpTxt = (v: number | null) => v == null ? '200+' : String(v);

  return (
    <main id="domains" className="rz" style={{ display: 'grid' }}>
      <div className="rz-head">
        <div>
          <div className="rz-eye">ARKHAM · URBAN RESILIENCE PLANNING</div>
          <h1 className="rz-title">How big a storm can Bengaluru take, and what makes it stronger?</h1>
          <div className="rz-sub">Build a plan within a budget. Every number below is a live run of the flood + cascade model across eight storm sizes.</div>
        </div>
        <div className={'rz-mode ' + (ok ? 'ok' : 'off')}>{ok ? '● PHYSICS BACKEND · real terrain, roads, hospitals, population' : '○ Backend offline: planning studio needs the API'}</div>
      </div>

      <section className="rz-kpis" aria-live="polite">
        <div className="card rz-kpi hero">
          <span>Breaking point · storm before 10,000 people lose hospital access</span>
          <b><em>{bpTxt(bpB)}</em> → {bpTxt(bpP)} <small>mm in 6 h</small></b>
          <small>{bpB != null && bpP != null && bpP > bpB ? `Plan lets the city absorb ${bpP - bpB} mm more rain before it breaks` : bpP == null && planC ? 'Plan holds across every storm tested' : 'Add interventions to raise the breaking point'}</small>
        </div>
        <div className="card rz-kpi"><span>People kept within 30 min of care</span><b>{p ? fmt(protectedN) : '…'}</b><small>at the {design} mm design storm · {b ? fmt(b.cut) : '…'} cut off today</small></div>
        <div className="card rz-kpi"><span>Hospitals kept dry · roads reopened</span><b>{b && p ? `${b.hosp - p.hosp} · ${Math.round(b.roads - p.roads)} km` : '…'}</b><small>{p ? `${p.hosp} hospitals, ${p.roads} km still affected` : ''}</small></div>
        <div className={'card rz-kpi' + (over ? ' warn' : '')}><span>Plan cost</span><b>₹{cost} cr <small>of ₹{budget} cr</small></b>
          <small>{over ? 'Over budget' : protectedN > 0 ? `₹${(cost * 100 / protectedN).toFixed(2)} lakh per person protected` : 'No one protected yet at this storm'}</small></div>
      </section>

      <section className="card rz-builder">
        <div className="t">1 · Build the plan <span className="tg O">Real costs ₹ cr</span></div>
        <div className="rz-body">
          <label className="rz-ctl">Budget <b>₹{budget} crore</b>
            <input type="range" min={0} max={410} step={5} value={budget} onChange={e => setBudget(+e.target.value)} aria-label="Budget in crore rupees" /></label>
          <div className="rz-ctl"><span>Design storm <b>{design} mm in 6 h</b></span>
            <div className="rz-chips" role="radiogroup" aria-label="Design storm">{STORMS.map(r => <button key={r} role="radio" aria-checked={design === r} className={design === r ? 'on' : ''} onClick={() => setDesign(r)}>{r}</button>)}</div></div>
          <div className="rz-ivs">
            {ivs.map(iv => {
              const on = plan.includes(iv.id), m = META[iv.id];
              return (
                <button key={iv.id} role="switch" aria-checked={on} className={'rz-iv' + (on ? ' on' : '')} onClick={() => toggle(iv.id)}>
                  <span className="rz-ivi" aria-hidden="true">{m?.icon}</span>
                  <span className="rz-ivt"><b>{iv.label}</b><small>{m?.when} · {m?.owner}</small>
                    {m && <span className="rz-co">{m.co.map(c => <i key={c}>+ {c}</i>)}</span>}</span>
                  <span className="rz-ivc"><b>₹{iv.cost} cr</b><small>{perCr[iv.id] ? `${fmt(perCr[iv.id])} people / ₹cr` : 'roads & hospitals only'}</small></span>
                </button>
              );
            })}
          </div>
          <div className="rz-budget" aria-hidden="true"><i style={{ width: Math.min(100, cost / Math.max(budget, 1) * 100) + '%' }} className={over ? 'over' : ''} /></div>
          <button className="run" disabled={!best || isBest} onClick={() => best && setPlan(best)}>
            {isBest ? '✓ This is the optimal plan for this budget' : best ? `⚡ Auto-plan: best of 32 portfolios (${best.map(x => label[x]?.split(' ')[0]).join(' + ') || 'nothing'})` : 'Optimiser loading…'}</button>
          <div className="rz-note">People / ₹cr is measured at the design storm. Interventions that protect no one from cut-off can still keep roads and hospitals dry; the stress test shows both.</div>
        </div>
      </section>

      <section className="rz-center">
        <div className="card">
          <div className="t">2 · Stress test across storms <span className="rz-legend"><i style={{ background: '#8b949e' }} />Today <i style={{ background: '#FE9135' }} />With plan</span></div>
          <div className="rz-body">{base ? <StressCurve base={base} plan={planC} bpBase={bpB} bpPlan={bpP} design={design} /> : <div className="rz-empty">{err ? 'Model unavailable: ' + err : ok ? 'Running 16 storm scenarios…' : 'Connect the physics backend to stress-test plans.'}</div>}
            {base && planC && <table className="rz-tab"><caption className="rz-sr">People cut off by storm size</caption><thead><tr><th>Storm, mm</th>{STORMS.map(r => <th key={r} className={r === design ? 'd' : ''}>{r}</th>)}</tr></thead>
              <tbody><tr><td>Today</td>{base.map(o => <td key={o.rain} className={o.cut > FUNCTION_LOSS ? 'bad' : ''}>{fmt(o.cut).replace(' lakh', 'L')}</td>)}</tr>
                <tr><td>With plan</td>{planC.map(o => <td key={o.rain} className={o.cut > FUNCTION_LOSS ? 'bad' : 'good'}>{fmt(o.cut).replace(' lakh', 'L')}</td>)}</tr></tbody></table>}
          </div>
        </div>
        <div className="rz-two">
          <div className="card">
            <div className="t">3 · Best plan for every budget <span className="tg O">32 portfolios tested</span></div>
            <div className="rz-body">{opt?.pareto_frontier ? <Frontier pts={opt.pareto_frontier} plan={p ? { cost, cut: p.cut } : null} budget={budget} labels={label} /> : <div className="rz-empty">…</div>}
              <div className="rz-note">Green steps are the cheapest way to reach each level of protection at {design} mm. A plan above the line is overpaying.</div></div>
          </div>
          <div className="card">
            <div className="t">4 · Phased roadmap <span className="tg M">Indicative timing</span></div>
            <div className="rz-body rz-road">
              {PHASES.map((ph, i) => {
                const items = plan.filter(id => META[id]?.phase === i);
                const upto = plan.filter(id => (META[id]?.phase ?? 9) <= i).reduce((s, id) => s + (ivs.find(x => x.id === id)?.cost ?? 0), 0);
                return <div key={ph} className={'rz-ph' + (items.length ? ' on' : '')}><div className="rz-phh"><b>{ph}</b><small>₹{upto} cr cumulative</small></div>
                  {items.length ? items.map(id => <div key={id} className="rz-phi"><span>{label[id]}</span><DispatchButton k={'plan-' + id} /></div>) : <small className="rz-muted">nothing scheduled</small>}</div>;
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="card rz-domains">
        <div className="t">5 · Effect across 12 city domains</div>
        <div className="rz-body">
          <div className="rz-note">Measured = flood + cascade model at {design} mm. Illustrative = demo values, shown for platform scope.</div>
          {DOMAINS.map((d: any) => {
            const m = MODELLED[d.id], isOpen = open === d.id;
            const before = m && b ? m.v(b) : null, after = m && p ? m.v(p) : null;
            const better = before != null && after != null && after < before;
            return (
              <div key={d.id} className={'rz-dom' + (isOpen ? ' open' : '')}>
                <button className="rz-domh" aria-expanded={isOpen} onClick={() => pickDomain(d.id)}>
                  <span className="rz-di" aria-hidden="true">{d.icon}</span>
                  <span className="rz-dn">{d.name}<small>{m ? m.k : d.scenario}</small></span>
                  {m ? <span className="rz-dv"><s>{before != null ? fmt(before) : '…'}</s> → <b className={better ? 'good' : ''}>{after != null ? fmt(after) : '…'}</b> <small>{m.u}</small><i className="tg O">Measured</i></span>
                    : <span className="rz-dv">{coHit.has(d.id) ? <b className="good">co-benefit</b> : <b className="rz-muted">{d.base}% risk</b>}<i className="tg S">Illustrative</i></span>}
                </button>
                {isOpen && <div className="rz-domb">
                  <div className="rz-chain">{d.chain.map((s: string[], i: number) => <div key={i}><small>{s[0]}</small><b>{s[1]}</b><small>{s[2]}</small></div>)}</div>
                  {d.actions.map((a: string, i: number) => <div key={i} className="rz-act"><span>{a}</span><DispatchButton k={'domain-' + d.id + '-' + i} /></div>)}
                </div>}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
