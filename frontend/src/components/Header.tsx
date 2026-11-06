import { useEffect, useRef, useState } from 'react';
import { GR, HZ, LAYERS, M, NAV, S, SUBS, pad } from '../engine';
import { bump, useStore, useTick } from '../store';
import { hzSet, navigate, setMode } from '../actions';
import { fetchModel } from '../backend';

const HAZARDS: [string, string][] = [['flood', 'Flood'], ['heat', 'Urban heat'], ['water', 'Water stress'], ['epi', 'Epidemic outbreak'],
  ['grid', 'Power grid'], ['traffic', 'Traffic'], ['rad', 'Radiation (drill)'], ['crowd', 'Crowd & civil']];

function Dropdown({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);
  return (
    <div className={'dd' + (open ? ' open' : '')} ref={ref}>
      <button className="ddb" onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>{label}</button>
      <div className={'menu ' + (className || '')} onClick={e => { if ((e.target as HTMLElement).closest('.nav button')) setOpen(false); }}>{children}</div>
    </div>
  );
}

function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return <span id="clk" style={{ fontFamily: 'var(--mono)' }}>{pad(t.getHours())}:{pad(t.getMinutes())}:{pad(t.getSeconds())} IST</span>;
}

function Badge() {
  const bk = useStore(s => s.bk);
  const v = bk.ov?.validation;
  return (
    <span title={bk.ok ? 'Flood depth: modelled (Tier 1 terrain screen on Copernicus DSM). Validation: BBMP/KGIS flood points. Roads & hospitals: OpenStreetMap. Population: modelled.' : 'Start the API: cd backend && uvicorn app.main:app --port 8000'}
      style={{ marginLeft: 12, font: '600 11px var(--mono,monospace)', padding: '3px 8px', borderRadius: 10, border: '1px solid #2b3138', cursor: 'help',
        color: bk.ok ? '#9be0b8' : '#b7bec7', background: bk.ok ? '#173a28' : 'transparent' }}>
      {bk.ok ? '● PHYSICS BACKEND' + (v ? ` · BBMP hit ${Math.round(v.hit_rate * 100)}% · ${v.lift_over_random}× lift` : '') : '○ OFFLINE · synthetic model'}
    </span>
  );
}

/** Legacy NAV plus views added in the React app. Index 6 = Crime Intelligence (Suraksha-Grid). */
const NAV_ALL: string[] = [...NAV, 'Crime Intelligence', 'Citizen Reports'];

export default function Header({ scenario }: { scenario: string }) {
  useTick();
  const view = useStore(s => s.view);
  const nv = useStore(s => s.nv);
  const openReport = useStore(s => s.openReport);
  const [cur, setCur] = useState('Cursor: —');
  useEffect(() => { const h = (e: Event) => setCur((e as CustomEvent).detail); window.addEventListener('arkham:cursor', h); return () => window.removeEventListener('arkham:cursor', h); }, []);
  return (
    <header>
      <div className="logo"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#FE9135" strokeWidth="1.4"><path d="M2 18V8h5v10M7 18V3h6v15M13 18v-7h5v7M1 18h18" /></svg>ARKHAM <small>· CITY DIGITAL TWIN</small></div>
      <div className="bar2">
        <Dropdown label={<>City Operations <small id="navl">{NAV_ALL[nv]}</small> ▾</>}>
          <div className="nav" id="nav">{NAV_ALL.map((n: string, i: number) => <button key={n} className={i === nv ? 'on' : ''} onClick={() => navigate(i)}><i />{n}</button>)}</div>
        </Dropdown>
        <Dropdown label="Layers ▾" className="lay">
          {view === 1
            ? SUBS[M.sub].slice(1).map((g: string) => (
              <label key={g}><input type="checkbox" checked={M.gv[g] !== false} onChange={e => { M.gv[g] = e.target.checked; bump(); }} />{GR[g][0]}<span className="tg" style={{ color: GR[g][1] }}>●</span></label>))
            : LAYERS.map((l: any[], i: number) => (
              <label key={l[0]}><input type="checkbox" checked={!!S.layers[i]} onChange={e => { S.layers[i] = e.target.checked ? 1 : 0; bump(); }} />{l[0]}<span className={'tg ' + l[1]}>{l[1] === 'O' ? 'OBS' : 'MOD'}</span></label>))}
        </Dropdown>
        {(view === 1 || view === 2) && (
          <div className="seg" id="modeSeg" style={{ display: 'flex' }}>
            <button className={M.mode === 'live' ? 'on' : ''} onClick={() => setMode('live')}><i className="live" />Live</button>
            <button className={M.mode === 'sim' ? 'on' : ''} onClick={() => { setMode('sim'); fetchModel(); }}>Simulation</button>
          </div>)}
      </div>
      <div className="mid"><b>Bengaluru</b>/<span>Scenario:</span><b id="scn">{scenario}</b>
        {view === 0 && <select id="hz" value={S.hz} onChange={e => hzSet(e.target.value)}>{HAZARDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>}
        <Badge />
      </div>
      <div className="ic"><span id="cur">{cur}</span><button className="btn rb" id="repb" onClick={() => openReport(view === 3 ? 'domain' : 'main')}>▤ Report</button><Clock /><span><i className="live" />Live</span><div className="av">AK</div></div>
    </header>
  );
}
export { HZ };
