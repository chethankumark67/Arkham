/* Port of the legacy hazard-modelling view (<main id="mod">): mrender/insight/detail/ops/ctl/mmap/chartM/cascRender. */
import { useEffect } from 'react';
import { CT, DT, DZ, FE, GR, L, M, MS, MT, P, PRE, SUBS, TR, av, by, casc, hx, pad, pk, rainE, risk, syncLive } from '../engine';
import { bump, useStore, useTick } from '../store';
import { fetchModel } from '../backend';
import HazardMap from './modelling/HazardMap';
import './modelling/hazard.css';
import CascadeGraph, { cascPath } from './modelling/CascadeGraph';
import ForecastChart from './modelling/ForecastChart';
import Dbtn from './modelling/Dbtn';

/* legacy: Open-Meteo hourly precipitation sets the first data feed to Live */
let feedStarted = false;
function startFeed() {
  if (feedStarted) return; feedStarted = true;
  fetch('https://api.open-meteo.com/v1/forecast?latitude=12.97&longitude=77.59&hourly=precipitation&forecast_days=2')
    .then(r => r.json()).then(j => { FE[0][3] = 'Live'; M.live = Math.max(...j.hourly.precipitation); bump(); }).catch(() => {});
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
const update = () => { bump(); fetchModel(); };
const Row = ({ k, v, c }: { k: string; v: any; c?: string }) => <div className="hm-row"><span>{k}</span><b style={c ? { color: c } : undefined}>{v}</b></div>;

/* KPIs trimmed to the most relevant per sub tab (indices into MT[sub]) */
const KPI = [[0, 1, 2, 4], [0, 4, 1, 2], [0, 2, 3, 4]];
/* inputs per sub tab: CT indices (0 rain, 1 drain cap, 2 horizon, 3 hour) */
const INP = [[0, 1, 2], [2, 0], [3]];
const PRESETS = ['Monsoon cloudburst', 'Cricket match in rain', 'Rally at Freedom Park', 'Post-flood outbreak', 'Radiation-leak drill'];
function preset(i: number) { Object.assign(M, PRE[i]); M.mode = 'sim'; M.sel = null; update(); }

function Summary({ ms, bkOk }: { ms: any; bkOk: boolean }) {
  const x = rainE(M.d) * (1.35 - .35 * M.cap / 100);
  if (M.sub == 0) {
    const c = ms?.cascade;
    return <div className="card hm-card"><div className="t">What happens {bkOk && ms ? <span className="tg O">Physics core</span> : <span className="tg M">Modelled</span>}</div><div className="hm-body">
      {bkOk && ms ? <>
        <Row k="Flooded > 0.3 m" v={ms.flood.flooded_km2_gt_0_3m + ' km²'} />
        <Row k="→ Roads closed / slowed" v={c.roads_closed_km + ' / ' + c.roads_slowed_km + ' km'} />
        <Row k="→ Hospitals flooded" v={c.hospitals_flooded} />
        <Row k="→ People cut off (>30 min)" v={fmt(c.people_cut_off)} />
      </> : <>
        <Row k="Drain overload" v={Math.round(60 + x * 90) + '%'} />
        <Row k="→ Roads blocked" v={Math.round(27 * x)} />
        <Row k="→ Feeders tripped" v={Math.round(7 * x)} />
        <Row k="→ Cut off from hospitals" v={L(24000 * x)} />
      </>}
    </div></div>;
  }
  if (M.sub == 1) {
    const cs = by('cs'), hot = M.pts.filter(([p, r]: any) => p[0] == 'cs' && r > .6).map(([p]: any) => p[1].replace(' ward', ''));
    const reff = .8 + av(cs) * 1.2;
    return <div className="card hm-card"><div className="t">Outbreak summary · {M.dz}</div><div className="hm-body">
      <Row k="Est. active cases" v={MT[1][0][1]()} />
      <Row k="R_eff (est.)" v={reff.toFixed(2)} c={reff > 1 ? '#e5533d' : '#4fae78'} />
      <Row k="Hotspot wards" v={hot.length ? hot.slice(0, 2).join(', ') + (hot.length > 2 ? ' +' + (hot.length - 2) : '') : 'none'} />
      <div className="hm-note">Flood → contaminated supply → cases rise 3–10 days later.</div>
    </div></div>;
  }
  return null;
}

function Inputs() {
  const ins = INP[M.sub].map(i => CT[i]);
  return <div className="card hm-card"><div className="t">Simulation inputs <button className="btn hm-mini" onClick={() => { M.mode = 'live'; M.leak = 0; update(); }}>↺ Live</button></div><div className="hm-body hm-ctl">
    {M.sub == 1 && <label>Disease<select value={M.dz} onChange={e => { M.dz = e.target.value; update(); }}>{Object.keys(DZ).map(k => <option key={k}>{k}</option>)}</select></label>}
    {ins.map((c: any) => <label key={c[0]}><span>{c[1]} <b>{c[4] == 'h' ? pad(M.h) + ':00' : M[c[4]]}</b></span>
      <input type="range" id={c[0]} min={c[2]} max={c[3]} value={M[c[4]]} onChange={e => { M[c[4]] = +e.target.value; update(); }} /></label>)}
    {M.sub == 2 && <>
      <label>Event<select id="mev" value={M.ev} onChange={e => { M.ev = e.target.value; update(); }}><option value="none">None</option><option value="match">Cricket match (Chinnaswamy)</option><option value="rally">Rally / protest (Freedom Park)</option><option value="parade">Victory parade (Vidhan Soudha)</option></select></label>
      <label className="hm-check"><input type="checkbox" checked={!!M.leak} onChange={() => { M.leak = 1 - M.leak; update(); }} />Radiation-leak drill</label>
      <div className="hm-note">Peak-hour factor {Math.round(pk(M.h) * 100)}%</div>
    </>}
  </div></div>;
}

function Selected() {
  const rk = M.pts.slice().sort((a: any, b: any) => b[1] - a[1]), cur = (M.sel != null && M.pts.find((q: any) => q[0][5] == M.sel)) || rk[0];
  if (!cur) return null;
  const [p, r] = cur, t = TR[p[1]], rows = DT[p[0]](r).slice(0, t && r > .5 ? 3 : 4);
  return <div className="card hm-card"><div className="t"><span className="hm-ell">{p[1]}</span><b className="hm-badge" style={{ background: hx(r) }}>{Math.round(r * 100)}%</b></div><div className="hm-body">
    <div className="hm-note">{GR[p[0]][0]}{M.sel == null ? ' · top risk' : ''}</div>
    {rows.map((a: any) => <Row key={a[0]} k={a[0]} v={a[1]} />)}
    {t && r > .5 && <Row k="Alternate" v={t[2]} c="var(--gr)" />}
    <div className="hm-act"><span>{MS[p[0]][0]}</span><Dbtn k={'d' + p[5] + '-0'} /></div>
  </div></div>;
}

export default function ModellingView() {
  const tick = useTick();
  const nv = useStore(s => s.nv);
  const bk = useStore(s => s.bk);
  useEffect(() => { startFeed(); const id = setInterval(bump, 2000); return () => clearInterval(id); }, []);
  // refresh the backend scenario whenever rain / drain capacity may have changed (fetchModel dedupes)
  useEffect(() => { fetchModel(); });

  syncLive();
  const gs = SUBS[M.sub].slice(1).filter((g: string) => M.gv[g] !== false);
  M.pts = P.filter((p: any) => gs.includes(p[0])).map((p: any) => [p, risk(p)]);
  const rk = M.pts.slice().sort((a: any, b: any) => b[1] - a[1]);
  const N = casc();
  const sim = M.mode == 'sim';

  return (
    <main id="mod" className="hm" style={{ display: 'grid' }}>
      <div className="card kp">
        <div className="ttl"><small>HAZARD MODELLING · <span id="mdl">{sim ? 'SIMULATION' : 'LIVE · BACKEND FEED'}</span></small><div id="mt">{['Natural hazards', 'Epidemics', 'Artificial hazards'][M.sub]}</div></div>
        <div className="tabs" id="sub" style={{ padding: '0 8px', borderRight: '1px solid var(--bd)' }}>
          {SUBS.map((s: any, i: number) => <button key={s[0]} className={M.sub === i ? 'on' : ''} onClick={() => { M.sub = i; M.sel = null; update(); }}>{s[0]}</button>)}
        </div>
        <div id="mm" style={{ display: 'flex', flex: 1 }}>{KPI[M.sub].map(i => MT[M.sub][i]).map(([l, fn]: any) => <div key={l} className="m"><span>{l}</span><b>{fn()}</b></div>)}</div>
      </div>
      <div className="card mapc"><HazardMap tick={tick} /></div>
      <div className="bot" style={{ gridTemplateColumns: '1.7fr 1fr' }}>
        <div className="card"><div className="t">Cascading chain reaction <span id="cpath" style={{ fontSize: 10.5, color: 'var(--c2)', fontWeight: 400, textAlign: 'right' }}>{cascPath(N)}</span></div><CascadeGraph N={N} /></div>
        <div className="card"><div className="t">Forecast: past data + prediction <span className="tg M">Modelled</span></div><ForecastChart gs={gs} /></div>
      </div>
      <div className="side hm-side">
        {nv === 5 && <div className="card hm-card"><div className="t">Scenarios</div><div className="hm-body">
          {PRESETS.map((a, i) => <div key={a} className="hm-row"><span>{a}</span><button className="btn hm-mini" onClick={() => preset(i)}>Load</button></div>)}
        </div></div>}
        {sim ? <Inputs /> : <div className="card hm-card hm-live"><span><i className="hm-dot" />Live · rainfall {M.rain} mm{FE[0][3] == 'Live' ? ' from Open-Meteo' : ''}</span>
          <button className="btn hm-mini" onClick={() => { M.mode = 'sim'; update(); }}>Simulate</button></div>}
        <Summary ms={bk.ms} bkOk={bk.ok} />
        <div className="card hm-card"><div className="t">Top hotspots</div><div className="hm-body" id="mrk">
          {rk.slice(0, 3).map(([p, r]: any) => <div key={p[5]} className={'hm-hot' + (M.sel == p[5] ? ' on' : '')} onClick={() => { M.sel = p[5]; bump(); }}>
            <span className="hm-ell">{p[1]}</span><div className="bar"><i style={{ width: r * 100 + '%', background: hx(r) }} /></div><b>{Math.round(r * 100)}%</b></div>)}
        </div></div>
        <Selected />
        <details className="card hm-card hm-src"><summary>Data sources · {FE.filter((f: any) => f[3] == 'Live').length}/{FE.length} live</summary><div className="hm-body">
          {FE.map((f: any) => <div key={f[0]} className="hm-row"><span>{f[0]}</span><span className={'tg ' + (f[3] == 'Live' ? 'O' : 'S')}>{f[3]}{f[3] == 'Live' && f[0].startsWith('Open') ? ' ' + M.live + ' mm/h' : ''}</span></div>)}
          <div className="hm-note">Government adapters are stubs; route them through the FastAPI backend.</div>
        </div></details>
      </div>
    </main>
  );
}
