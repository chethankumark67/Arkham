/* Historical replay: the Tier 1 screen re-run hour by hour through the 4-5 Sep 2022 Bengaluru floods. */
import { useState } from 'react';
import { API } from '../../api';

interface Pt { time: string; rain_mm: number; rain_6h_mm: number; depth_m: Record<string, number> }
interface Run { series: Pt[]; first_any: string | null; lead_hours: number | null; total_mm: number; first_flag: Record<string, string | null> }
interface Rep {
  headline: string; threshold_m: number; rain_source: string; caveats: string[];
  event: { name: string; area: string; sites: { id: string; name: string }[]; reported: { time: string; what: string }; gauges: { station: string; mm: number; note?: string }[]; sources: { label: string; url: string }[] };
  gauge_corrected: Run; raw: Run;
}

const W = 300, PADL = 26, PADR = 6;
const hhmm = (t: string) => `${t.slice(8, 10)} Sep ${t.slice(11, 16)}`;

function Charts({ r }: { r: Rep }) {
  const s = r.gauge_corrected.series;
  const n = s.length, bw = (W - PADL - PADR) / n, X = (i: number) => PADL + i * bw;
  const maxR = Math.max(10, ...s.map(p => p.rain_mm));
  const ids = r.event.sites.map(x => x.id);
  const dep = s.map(p => Math.max(...ids.map(k => p.depth_m[k] ?? 0)));
  const maxD = Math.max(r.threshold_m * 2, ...dep);
  const iOf = (t: string | null) => (t ? s.findIndex(p => p.time === t) : -1);
  const fi = iOf(r.gauge_corrected.first_any), ri = iOf(r.event.reported.time);
  const days = s.map((p, i) => [p, i] as const).filter(([p]) => p.time.endsWith('T00:00'));
  const RH = 54, DH = 70, DY = RH + 14, Yd = (v: number) => DY + DH - (v / maxD) * DH;
  const line = dep.map((v, i) => `${X(i) + bw / 2},${Yd(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${DY + DH + 16}`} className="rp-svg" role="img"
      aria-label={`Hourly rain and modelled depth. First flagged ${r.gauge_corrected.first_any ? hhmm(r.gauge_corrected.first_any) : 'never'}; flooding reported ${hhmm(r.event.reported.time)}.`}>
      <text x={PADL} y={8} className="rp-ax">Rain, mm/h (gauge-corrected) · max {Math.round(maxR)}</text>
      <text x={PADL} y={DY - 3} className="rp-ax">Max modelled depth at ORR/Bellandur sites, m</text>
      {s.map((p, i) => <rect key={'r' + i} x={X(i) + 0.5} y={10 + RH - 10 - (p.rain_mm / maxR) * (RH - 10)} width={Math.max(0.5, bw - 1)} height={(p.rain_mm / maxR) * (RH - 10)} fill="#4c8dd6" />)}
      <line x1={PADL} x2={W - PADR} y1={Yd(r.threshold_m)} y2={Yd(r.threshold_m)} stroke="#8b949e" strokeDasharray="3 3" />
      <text x={W - PADR} y={Yd(r.threshold_m) - 2} textAnchor="end" className="rp-ax">{r.threshold_m} m flag</text>
      <line x1={PADL} x2={W - PADR} y1={DY + DH} y2={DY + DH} stroke="#2b3138" />
      <polyline points={line} fill="none" stroke="#FE9135" strokeWidth={2} strokeLinejoin="round" />
      {fi >= 0 && <><line x1={X(fi) + bw / 2} x2={X(fi) + bw / 2} y1={10} y2={DY + DH} stroke="#FE9135" />
        <text x={X(fi) + bw / 2 - 2} y={DY + DH + 12} textAnchor="end" className="rp-lb">flagged</text></>}
      {ri >= 0 && <><line x1={X(ri) + bw / 2} x2={X(ri) + bw / 2} y1={10} y2={DY + DH} stroke="#e8ebee" strokeDasharray="2 2" />
        <text x={X(ri) + bw / 2 + 2} y={DY + DH + 12} className="rp-lb">reported</text></>}
      {days.map(([p, i]) => <text key={p.time} x={X(i)} y={DY + DH + 12} className="rp-ax" opacity={Math.abs(i - fi) < 24 || Math.abs(i - ri) < 14 ? 0 : 1}>{p.time.slice(8, 10)} Sep</text>)}
      {/* hover layer: full-height hit target per hour */}
      {s.map((p, i) => <rect key={'h' + i} x={X(i)} y={0} width={bw} height={DY + DH} fill="transparent" className="rp-hit">
        <title>{`${hhmm(p.time)}\nrain ${p.rain_mm} mm/h · last 6 h ${p.rain_6h_mm} mm\n` + r.event.sites.map(x => `${x.name}: ${p.depth_m[x.id]} m`).join('\n')}</title></rect>)}
    </svg>
  );
}

export default function ReplayCard() {
  const [r, setR] = useState<Rep | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = () => {
    setBusy(true); setErr(null);
    fetch(API + '/replays/blr-2022-09').then(async x => { if (!x.ok) throw new Error((await x.json().catch(() => null))?.detail ?? `HTTP ${x.status}`); return x.json() as Promise<Rep>; }).then(setR).catch(e => setErr(String(e?.message ?? e))).finally(() => setBusy(false));
  };
  const lead = r?.gauge_corrected.lead_hours;
  return (
    <div className="card hm-card rp"><div className="t">Historical replay <span className="tg O">Real event</span></div><div className="hm-body">
      {!r && <>
        <div className="hm-row"><span>Bengaluru floods, 4–5 Sep 2022</span><button className="btn hm-mini" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Replay'}</button></div>
        <div className="hm-note">Re-runs the flood screen hour by hour through the actual rainfall of that week (Open-Meteo), corrected to KSNDMC gauge totals.</div>
        {err && <div className="hm-note" role="alert" style={{ color: 'var(--rd)' }}>Replay unavailable: {err}</div>}
      </>}
      {r && <>
        <div className="rp-head" aria-live="polite">{lead != null && lead > 0 ? <><b>{lead} h earlier</b><span>{r.headline}</span></> : <span>{r.headline}</span>}</div>
        <Charts r={r} />
        <div className="hm-row"><span>Gauge-corrected ({r.gauge_corrected.total_mm} mm)</span><b>{r.gauge_corrected.first_any ? 'flagged ' + hhmm(r.gauge_corrected.first_any) : 'not flagged'}</b></div>
        <div className="hm-row"><span>Raw Open-Meteo ({r.raw.total_mm} mm)</span><b>{r.raw.first_any ? 'flagged ' + hhmm(r.raw.first_any) : 'not flagged'}</b></div>
        <div className="hm-row"><span>First reported</span><b>{hhmm(r.event.reported.time)}</b></div>
        <details><summary>Per site, method & sources</summary>
          <table className="rp-tab"><thead><tr><th>Site</th><th>First flagged</th></tr></thead><tbody>
            {r.event.sites.map(x => <tr key={x.id}><td>{x.name}</td><td>{r.gauge_corrected.first_flag[x.id] ? hhmm(r.gauge_corrected.first_flag[x.id]!) : 'never'}</td></tr>)}
          </tbody></table>
          <div className="hm-note">{r.event.reported.what}</div>
          <div className="hm-note">Gauges: {r.event.gauges.map(g => `${g.station} ${g.mm} mm${g.note ? ` (${g.note})` : ''}`).join('; ')}. Timing: {r.rain_source}.</div>
          <ul className="rp-cav">{r.caveats.map(c => <li key={c}>{c}</li>)}</ul>
          <div className="hm-note">{r.event.sources.map((x, i) => <span key={x.url}>{i ? ' · ' : ''}<a href={x.url} target="_blank" rel="noreferrer">{x.label}</a></span>)}</div>
        </details>
      </>}
    </div></div>
  );
}
