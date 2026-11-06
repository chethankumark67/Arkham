/* Port of legacy script4_arkham-impact.js — Impact Analysis view driven by /api/impact. */
import { useEffect, useRef, useState } from 'react';
import { INT, S } from '../engine';
import { bump, useStore, useTick } from '../store';
import { api, ivq, IV } from '../api';
import { applyInterventions } from '../actions';
import ImpactChart from './impact/ImpactChart';

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
const ivName = (k: string) => INT[IV.indexOf(k as any)][0];
/** Per-key response cache + drain capacity, module-level like the legacy closure `st`. */
const cache = new Map<string, any>();
let drainPct = 100;

function Bar({ v, max, c }: { v: number; max: number; c: string }) {
  return <div className="bar"><i style={{ width: Math.min(100, v / (max || 1) * 100) + '%', background: c }} /></div>;
}

export default function ImpactView() {
  useTick();
  const ok = useStore(s => s.bk.ok);
  const [drain, setDrain] = useState(drainPct);
  const [qKey, setQKey] = useState<string | null>(null); // debounced request key
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState('');
  const latest = useRef('');
  const key = `rain=${S.v}&drain=${drain}&iv=${ivq(S.sel)}&budget=${S.budget}`;

  // Debounce slider changes (350 ms); chip/apply changes load immediately via `now`.
  const now = useRef(true);
  useEffect(() => {
    if (now.current) { now.current = false; setQKey(key); return; }
    const t = setTimeout(() => setQKey(key), 350);
    return () => clearTimeout(t);
  }, [key]);

  useEffect(() => {
    if (qKey == null) return;
    if (!ok) { setStatus('Physics backend offline — start the API to compute impacts.'); return; }
    latest.current = qKey;
    const hit = cache.get(qKey);
    if (hit) { setData(hit); setStatus(''); return; }
    setStatus('Computing flood → cascade → interventions…');
    const p = new URLSearchParams(qKey);
    api.impact(+p.get('rain')!, +p.get('drain')!, p.get('iv') || '', +p.get('budget')!).then(d => {
      cache.set(qKey, d);
      if (latest.current !== qKey) return;
      setData(d); setStatus('');
    }).catch(() => { if (latest.current === qKey) setStatus('Backend error'); });
  }, [qKey, ok]);

  const toggle = (i: number) => { const s = new Set<number>(S.sel); s.has(i) ? s.delete(i) : s.add(i); now.current = true; applyInterventions(s); };
  const k = data?.kpis, I = data?.interventions;
  const below = data && k.flooded_km2_gt_0_3m == 0;

  return (
    <main id="impact" style={{ display: 'flex' }}>
      <section className="card span"><h3><span>Impact analysis · who and what is affected</span><span className="tag">MODELLED · PHYSICS BACKEND</span></h3>
        <div className="ctl">
          <label>Rainfall <input type="range" id="iaRain" min="20" max="200" step="5" value={S.v} onChange={e => { S.v = +e.target.value; bump(); }} /><b id="iaRainV">{S.v}</b> mm / 6 h</label>
          <label>Drain capacity <input type="range" id="iaDrain" min="60" max="140" step="5" value={drain} onChange={e => { drainPct = +e.target.value; setDrain(drainPct); }} /><b id="iaDrainV">{drain}</b>%</label>
          <label>Budget <input type="range" id="iaBud" min="50" max="400" step="10" value={S.budget} onChange={e => { S.budget = +e.target.value; bump(); }} /><b id="iaBudV">{S.budget}</b> ₹ cr</label>
          <span id="iaIv">{INT.map((x: any, i: number) => <span key={i} className={'chip ' + (S.sel.has(i) ? 'on' : '')} data-i={i} onClick={() => toggle(i)}>{x[0]} · ₹{x[2]}</span>)}</span>
          <span id="iaStatus" className="muted">{status || (below && <span style={{ color: '#9be0b8' }}>✓ Below flooding threshold: drains ({data.inputs.drain_pct}%) absorb a {data.inputs.rain_mm} mm storm. Raise rainfall or lower drain capacity.</span>)}</span>
        </div></section>
      <section className="card span"><div className="kp" id="iaKpi">{k && ([
        ['People cut off from care', fmt(k.people_cut_off), '#e5533d'], ['People in flooded cells', fmt(k.people_exposed), '#FE9135'],
        ['Hospitals flooded', `${k.hospitals_flooded}`, '#e5533d'], ['Roads closed', k.roads_closed_km + ' km', '#FE9135'],
        ['Area > 0.3 m', k.flooded_km2_gt_0_3m + ' km²', '#4c8dd6'],
        ['BBMP validation', k.lift == null ? '—' : Math.round(k.bbmp_hit_rate * 100) + '% · ' + k.lift + '×', '#2f9e63']] as string[][])
        .map(([l, v, c]) => <div key={l} style={{ borderLeft: '3px solid ' + c }}><span>{l}</span><b>{v}</b></div>)}</div></section>
      <section className="card"><h3><span>Impact over the storm</span><span className="muted" id="iaPeak">{data && `peak harm at t+${data.peak_hour} h`}</span></h3>
        {data ? <ImpactChart tl={data.timeline} peak={data.peak_hour} /> : <svg id="iaChart" viewBox="0 0 620 220" style={{ width: '100%', height: 220 }} />}
        <div className="muted"><span style={{ color: '#e5533d' }}>━</span> people cut off from care &nbsp; <span style={{ color: '#4c8dd6' }}>━</span> flooded area (km²) &nbsp; <span style={{ color: '#FE9135' }}>┅</span> roads closed (km)</div></section>
      <section className="card"><h3><span>Sector impacts</span></h3><div id="iaSec">
        {data?.sectors.map((s: any) => <div key={s.sector} style={{ display: 'flex', gap: 10, padding: '5px 0', borderBottom: '1px solid #22282e' }}><b style={{ minWidth: 150 }}>{s.sector}</b><span className="muted" style={{ color: 'var(--tx)' }}>{s.metric}</span></div>)}</div>
        <h3 style={{ marginTop: 14 }}><span>Interventions · people protected</span></h3><div id="iaInt">{I && (() => {
          const mx = Math.max(1, ...I.ranked.map((r: any) => r.people_protected));
          return <>
            {I.ranked.map((r: any) => <div key={r.interventions[0]} style={{ display: 'grid', gridTemplateColumns: '190px 1fr 90px', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 12.5 }}><span>{ivName(r.interventions[0])}</span><Bar v={r.people_protected} max={mx} c="#2f9e63" /><span className="num">{fmt(r.people_protected)}</span></div>)}
            <div style={{ marginTop: 8, padding: '8px 10px', background: '#0f1215', borderRadius: 8, fontSize: 12.5 }}>Best within ₹{data.inputs.budget_cr} cr: <b>{I.best.interventions.map(ivName).join(' + ') || 'no action'}</b> (₹{I.best.cost_cr} cr)<br />
              <span className="muted">Protects {fmt(I.people_protected)} people · cut-off {fmt(I.baseline_cut_off)} → {fmt(I.best.people_cut_off)}</span>{' '}
              <button className="btn" id="iaApply" style={{ marginLeft: 8 }} onClick={() => { now.current = true; applyInterventions(I.best.interventions.map((i: string) => IV.indexOf(i as any))); }}>Apply</button></div></>;
        })()}</div></section>
      <section className="card"><h3><span>BBMP zones affected</span><span className="muted">flagged / recorded flood points</span></h3><table id="iaZones"><tbody>{data && (() => {
        const zm = Math.max(...data.zones.map((z: any) => z.points));
        return <><tr><th>Zone</th><th>Flagged</th><th></th><th className="num">Max depth</th></tr>
          {data.zones.map((z: any) => <tr key={z.zone} title={z.wards.join(', ')}><td>{z.zone}<br /><span className="muted">{z.wards.slice(0, 3).join(', ')}</span></td><td className="num">{z.flagged}/{z.points}</td><td style={{ width: '30%' }}><Bar v={z.flagged} max={zm} c={z.share > .6 ? '#e5533d' : z.share > .35 ? '#FE9135' : '#FBC246'} /></td><td className="num">{z.max_depth_m} m</td></tr>)}</>;
      })()}</tbody></table></section>
      <section className="card"><h3><span>Hospitals losing function</span><span className="muted" id="iaHn">{k && `${k.hospitals_flooded} of ${k.hospitals_total} OSM hospitals`}</span></h3><table id="iaHosp"><tbody>{data && <>
        <tr><th>Hospital</th><th className="num">Depth</th></tr>
        {data.hospitals.length ? data.hospitals.map((h: any, i: number) => <tr key={i}><td>✚ {h.name}</td><td className="num" style={{ color: '#e5533d' }}>{h.depth_m} m</td></tr>) : <tr><td className="muted">No hospitals flooded</td></tr>}</>}</tbody></table></section>
      <section className="card"><h3><span>Roads closed (≥ 0.7 m)</span></h3><table id="iaRoads"><tbody>{data && (() => {
        const rm = Math.max(1, ...data.roads.map((r: any) => r.km));
        return <><tr><th>Road</th><th></th><th className="num">km</th></tr>
          {data.roads.length ? data.roads.map((r: any, i: number) => <tr key={i}><td>{r.name}</td><td style={{ width: '35%' }}><Bar v={r.km} max={rm} c="#e5533d" /></td><td className="num">{r.km}</td></tr>) : <tr><td className="muted">No closures</td></tr>}</>;
      })()}</tbody></table></section>
      <section className="card"><h3><span>Flood hotspots</span></h3><table id="iaHot"><tbody>{data && <>
        <tr><th>#</th><th>Near (BBMP)</th><th className="num">Depth</th><th className="num">Area</th><th className="num">P(flood)</th></tr>
        {data.hotspots.length ? data.hotspots.map((h: any, i: number) => <tr key={i}><td>{i + 1}</td><td>{h.nearest_bbmp ? <>{h.nearest_bbmp.name}<br /><span className="muted">{(h.nearest_bbmp.ward || '') + ' · ' + h.nearest_bbmp.km + ' km'}</span></> : h.lat + ', ' + h.lon}</td><td className="num">{h.max_depth_m} m</td><td className="num">{h.area_km2} km²</td><td className="num">{Math.round((h.probability || 0) * 100)}%</td></tr>) : <tr><td className="muted">No hotspots</td></tr>}</>}</tbody></table></section>
    </main>
  );
}
