/* Port of legacy openRep() (main situation report) and openDomainReport() into <div id="rep">. */
import { CN, D, GR, M, MT, domainRisk, eta, pad, plan, selectedDomain, sev } from '../engine';
import { useStore, useTick } from '../store';

function Head({ children, title, sub, close }: any) {
  return <div className="nu" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
    <div>{title}{sub}</div>{children}
    <div className="noprint" style={{ display: 'grid', gap: 10 }}><button className="nb" onClick={() => window.print()}>Print / PDF</button><button className="nb" onClick={close}>Close</button></div>
  </div>;
}

function MainReport({ close }: { close: () => void }) {
  const Q = plan(), n = new Date(), sim = M.mode == 'sim', kp = [...MT[0], MT[1][0]].map(([l, f]: any) => [l, f()]),
    cols = ['Trigger', 'Primary', 'Secondary', 'Cascade', 'Human impact'], ev = ({ none: 'None', match: 'Cricket match', rally: 'Rally', parade: 'Parade' } as any)[M.ev];
  return <div className="w">
    <Head close={close} title={<><small>ARKHAM · CITY DIGITAL TWIN</small><h1>Situation &amp; Response Report — Bengaluru</h1></>} sub={<small>{n.toLocaleString('en-IN')} IST · {sim ? 'Simulation (user inputs)' : 'Live (backend feed)'}</small>}>
      <div className="in" style={{ textAlign: 'center' }}><small>THREAT LEVEL</small><div className="big" style={{ color: Q.lv == 'Critical' ? '#d9432c' : Q.lv == 'High' ? '#d9731f' : '#2f9e63' }}>{Q.lv}</div></div>
    </Head>
    <div className="nu"><h2>Key indicators</h2><div className="g6">{kp.map(([l, v]) => <div key={l} className="in"><small>{l}</small><div className="big">{v}</div></div>)}</div></div>
    <div className="nu"><h2>Conditions {sim ? '(simulation inputs)' : 'at time of report'}</h2><div className="g6">
      {[['Rainfall', M.rain + ' mm / 6 h'], ['Drain capacity', M.cap + '%'], ['Forecast horizon', '+' + M.d + ' d'], ['Hour of day', pad(M.h) + ':00'], ['Event', ev], ['Disease focus', M.dz]].map(([l, v]) => <div key={l} className="in"><small>{l}</small><div style={{ fontWeight: 600 }}>{v}</div></div>)}
    </div></div>
    <div className="nu"><h2>Cascading chain reaction</h2><div className="g5">{cols.map((c, i) => <div key={c} className="in"><small>{c.toUpperCase()}</small><div style={{ marginTop: 8 }}>
      {CN.filter((x: any) => x[1] == i).map(([id, , lb]: any) => { const v = Q.N.V[id]; return <div key={id} className="cn"><span>{lb}</span><b style={{ color: sev(v) }}>{Math.round(v * 100)}%</b><div className="tr"><i style={{ width: v * 100 + '%', background: sev(v) }} /></div><small>{v > .15 && Q.N.E[id] ? 'ETA ' + eta(Q.N.E[id]) : '—'}</small></div>; })}
    </div></div>)}</div><p style={{ marginTop: 14 }}><b>Critical path:</b> {Q.N.path.join(' → ')}</p></div>
    <div className="nu"><h2>Top hotspots</h2>{Q.A.slice(0, 6).map(([p, r]: any) => <div key={p[5]} className="ln"><b style={{ flex: 1 }}>{p[1]}<br /><small>{GR[p[0]][0]}</small></b><div style={{ width: 140 }}><div className="tr"><i style={{ width: r * 100 + '%', background: sev(r) }} /></div></div><span className="tg2">{Math.round(r * 100)}%</span></div>)}</div>
    <div className="g3" style={{ alignItems: 'start' }}>
      <div className="nu"><h2>Priority actions</h2>{Q.acts.map((a: any) => <div key={a.k} className="ln"><span className="tg2">{a.t}</span><div><b>{a.loc}</b><br />{a.a}<br /><small>{a.o} · {a.u}</small></div></div>)}</div>
      <div className="nu"><h2>Alternate routes</h2>{Q.routes.length ? Q.routes.map((r: any) => <div key={r.n} className="ln"><div><b>{r.n}</b> <small>+{r.delay} min</small><br />↪ {r.alt}<br /><small>saves ~{r.save} min</small></div></div>) : <small>All corridors flowing.</small>}</div>
      <div className="nu"><h2>Quick measures</h2>{Q.quick.map((q: any) => <div key={q.k} className="ln"><div><b>{q.loc}</b>{q.m.map((m: string) => <span key={m}><br />• {m}</span>)}</div></div>)}</div>
    </div>
    <small style={{ textAlign: 'center' }}>Synthetic data until backend APIs are wired. Figures are modelled estimates for planning, not official advisories.</small>
  </div>;
}

function DomainReport({ close }: { close: () => void }) {
  const d = selectedDomain(), risk = domainRisk(d);
  return <div className="w">
    <Head close={close} title={<><small>ARKHAM · CITY DIGITAL TWIN · SYNTHETIC DEMO</small><h1>Resilience outlook — {d.name}</h1></>} sub={<small>Bengaluru · Forecast horizon {d.horizon}</small>}>
      <div className="in"><small>CASCADE RISK</small><div className="big">{risk}%</div></div>
    </Head>
    <div className="nu"><h2>Scenario</h2><div className="in">{d.scenario} · Intensity {D.driver}/100 · Modelled estimate</div></div>
    <div className="nu"><h2>Cascading impact</h2>{d.chain.map((x: any, i: number) => <div key={i} className="ln"><span className="tg2">{x[0]}</span><div><b>{x[1]}</b><br /><small>{x[2]} · {Math.round(risk * Math.max(.42, 1 - i * .12))}% modelled likelihood</small></div></div>)}</div>
    <div className="g3">{([['Indicators', d.metrics.map((x: any) => x[0] + ': ' + x[1])], ['Data sources', d.sources], ['Early measures', d.actions]] as [string, string[]][]).map(([h, ls]) =>
      <div key={h} className="nu"><h2>{h}</h2>{ls.map((t, i) => <span key={i}>{i ? <br /> : null}{t}</span>)}</div>)}</div>
    <small style={{ textAlign: 'center' }}>Synthetic planning scenario. Not an official advisory; no live feeds or operational dispatch are connected.</small>
  </div>;
}

export default function ReportModal() {
  useTick();
  const report = useStore(s => s.report), nv = useStore(s => s.nv), openReport = useStore(s => s.openReport);
  const close = () => openReport(null);
  // legacy override: openRep() shows the domain report when the Resilience Domains nav item (S.nv===4) is active
  const kind = report && (report === 'domain' || nv === 4) ? 'domain' : report;
  return <div id="rep" className={report ? 'on' : ''}>
    {kind === 'main' && <MainReport close={close} />}
    {kind === 'domain' && <DomainReport close={close} />}
  </div>;
}
