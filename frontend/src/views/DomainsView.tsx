/* Port of legacy renderDomain() (script0_main.js) + backend domain metrics (script1_arkham-backend.js). */
import { Fragment, useEffect, useRef, useState } from 'react';
import { D, DOMAINS, M, selectedDomain, domainRisk, domainMetricText } from '../engine';
import { bump, useStore, useTick } from '../store';
import { api } from '../api';
import DispatchButton from './domains/DispatchButton';

const LIVE_DOM = ['climate', 'economy', 'transport'];
const EXTRA_SOURCES = ['Copernicus DEM', 'OSM roads & hospitals', 'BBMP flood points'];
/** Backend metrics per domain, keyed like the legacy BK.dom cache (id|rain|cap). Module-level so it survives remounts. */
const live: Record<string, { key: string; metrics?: [string, string][] }> = {};

export default function DomainsView() {
  useTick();
  const ok = useStore(s => s.bk.ok);
  const [, force] = useState(0);
  const [ran, setRan] = useState(false);
  const runT = useRef<number | undefined>(undefined);
  const d: any = selectedDomain();
  const risk: number = domainRisk(d);
  const level = risk > 75 ? 'CRITICAL' : risk > 60 ? 'HIGH' : risk > 42 ? 'ELEVATED' : 'GUARDED';

  useEffect(() => {
    if (!ok || !LIVE_DOM.includes(d.id)) return;
    const key = d.id + '|' + M.rain + '|' + M.cap;
    if (live[d.id]?.key === key) return;
    live[d.id] = { key, metrics: live[d.id]?.metrics };
    api.domain(d.id, M.rain, M.cap).then((x: any) => {
      if (live[d.id]?.key !== key) return;
      live[d.id].metrics = x.metrics.map(([l, v]: [string, unknown]) => [l, String(v)]);
      force(n => n + 1);
    }).catch((e) => { console.warn('ARKHAM backend error', e); useStore.getState().setBk({ ok: false }); live[d.id].key = ''; });
  }, [ok, d.id, M.rain, M.cap]);
  useEffect(() => () => clearTimeout(runT.current), []);

  const bkm = ok && LIVE_DOM.includes(d.id) ? live[d.id]?.metrics : undefined;
  const metrics: [string, string][] = bkm ?? d.metrics.map((m: [string, string]) => [m[0], domainMetricText(m[1], risk, d.base)]);
  const sources: string[] = bkm ? [...new Set([...d.sources, ...EXTRA_SOURCES])] : d.sources;

  const pick = (id: string) => { D.id = id; D.driver = selectedDomain().base; D.scenarioIndex = 0; bump(); };
  const recalc = () => { bump(); setRan(true); clearTimeout(runT.current); runT.current = window.setTimeout(() => setRan(false), 1200); };

  return (
    <main id="domains" style={{ display: 'grid' }}>
      <div className="dhead"><div><div className="eyebrow">ARKHAM · RESILIENCE INTELLIGENCE</div><div className="dtitle">See the cascade before it spreads.</div><div className="dsubtitle">Choose a city system to inspect risk, downstream impacts, and early response options.</div>
        <div className="engine-flow">{['DATA SOURCES', 'DIGITAL TWIN', 'RISK DETECTION', 'CASCADE MODEL', 'IMPACT ASSESSMENT', 'RESILIENCE ACTIONS', 'WHAT-IF', 'DECISION DASHBOARD'].map((s, i) => <Fragment key={s}>{i > 0 && <b>→</b>}<span>{s}</span></Fragment>)}</div></div>
        <div className="dmeta"><span className="dstatus">● MODEL ACTIVE</span> &nbsp; BENGALURU · SYNTHETIC SCENARIO</div></div>
      <section className="card dlist"><div className="dlabel">12 RESILIENCE DOMAINS</div><div id="domainNav">
        {DOMAINS.map((x: any) => <button key={x.id} className={'domain-pick ' + (x.id === d.id ? 'on' : '')} data-domain={x.id} onClick={() => pick(x.id)}><span className="di">{x.icon}</span><span className="dn">{x.name}</span><span className="drisk">{x.base}%</span></button>)}
      </div></section>
      <section className="dmain" id="domainDetail">
        <section className="card dscenario"><div><div className="eyebrow">{d.name} · {d.scenario}</div><h2>{d.scenario}</h2><p>Risk outlook: {level} · Forecast horizon {d.horizon} · Confidence band ±20% (modelled)</p></div><div className="risk-badge">{risk}%<small>CASCADE RISK</small></div></section>
        <section className="dmetrics">{metrics.map(m => <div key={m[0]} className="card dmetric"><span>{m[0]}</span><b>{m[1]}</b></div>)}</section>
        <section className="card dcascade"><div className="dcascade-head"><b>Impact cascade</b><span className="tg M">PRIMARY → SECONDARY → LONG-TERM</span></div>
          <div className="chain">{d.chain.map((step: string[], i: number) => <div key={i} className="chain-step"><span className="stage">{step[0]}</span><b>{step[1]}</b><small>{step[2]} · {Math.round(risk * Math.max(.42, 1 - i * .12))}% likelihood</small></div>)}</div>
          <div className="eyebrow" style={{ marginTop: 7 }}>ILLUSTRATIVE DATA SOURCES</div>
          <div className="dsource">{sources.map(x => <span key={x} className="source-chip">{x}</span>)}</div></section>
      </section>
      <aside className="dside">
        <section className="card dcontrol"><div className="t">What-if scenario <span className="tg M">Modelled</span></div><div className="ctl">
          <label>Scenario intensity <b id="domainIntensity">{D.driver} / 100</b></label>
          <input type="range" min="0" max="100" value={D.driver} id="domainSlider" onChange={e => { D.driver = +e.target.value; bump(); }} />
          <label>Forecast horizon <b id="domainHorizon">{d.horizon}</b></label>
          <button className="run" id="domainRun" onClick={recalc}>{ran ? '✓ Cascade recalculated' : '↻ Recalculate cascade'}</button></div></section>
        <section className="card"><div className="t">Recommended resilience actions</div><div className="dactions" id="domainActions">
          {d.actions.map((a: string, i: number) => <div key={i} className="daction"><span>{a}</span><DispatchButton k={'domain-' + d.id + '-' + i} /></div>)}</div></section>
        <div className="dfoot">Demo planning aid. Data sources are represented as examples; predictions and risk scores are synthetic estimates, not official advisories or live agency feeds.</div>
      </aside>
    </main>
  );
}
