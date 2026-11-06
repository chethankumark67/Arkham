/* Response Planning: transparent, scored priority queue (see response/priority.ts for the formula). */
import { useEffect, useMemo, useState } from 'react';
import { M, eta } from '../engine';
import { bump, useStore, useTick } from '../store';
import { fetchModel } from '../backend';
import { fetchComplaints } from '../api';
import Dbtn from './modelling/Dbtn';
import { TIERS, buildActions, threatOf, type Action, type Source, type Tier } from './response/priority';
import { collectSignals, type Complaint } from './response/signals';
import './response/response.css';

const SRC: Record<Source, string> = { physics: 'Physics', model: 'Model', citizen: 'Citizen' };
const FC = [['severity', 'S', '#e5533d'], ['exposure', 'E', '#FBC246'], ['urgency', 'U', '#FE9135'], ['confidence', 'C', '#4c8dd6']] as const;
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const left = (t: number, now: number) => { const m = Math.round((t - now) / 60000); return m <= 0 ? 'overdue' : m < 60 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`; };
const fmt = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));

function Row({ a, now, onDone }: { a: Action; now: number; onDone: () => void }) {
  return (
    <div className="rs-act" data-key={a.key}>
      <span className={'rs-tier ' + a.tier}>{a.tier}</span>
      <div className="rs-main">
        <div className="rs-l1"><b>{a.loc}</b><span className="rs-ag">{a.agency}</span></div>
        <div>{a.measure}</div>
        <div className="rs-why">{a.title}{a.people ? ` · ~${fmt(a.people)} people` : ''} · impact {eta(Math.round(a.etaH))}</div>
        {a.prevents.length > 0 && <div className="rs-why">prevents: {a.prevents.join(' → ')}</div>}
        <div className="rs-chips">{a.evidence.map((e, i) => <span key={i} className={'rs-chip ' + e.source} title={e.label}>{SRC[e.source]}{e.count > 1 ? ' ×' + e.count : ''}</span>)}</div>
      </div>
      <div className="rs-score">
        <b>{Math.round(a.score)}</b>
        <div className="rs-bar" title={FC.map(([k, l]) => `${l} ${a[k].toFixed(2)}`).join(' × ')}>
          {FC.map(([k, l, c]) => <i key={k} style={{ flexGrow: a[k], background: c }}>{l}</i>)}
        </div>
        <small>{FC.map(([k, l]) => `${l}${a[k].toFixed(2)}`).join(' ')}</small>
        {a.deadline && <small className={a.deadline < now ? 'rs-late' : ''}>by {clock(a.deadline)} · {left(a.deadline, now)}</small>}
        <div className="rs-btns"><Dbtn k={a.key} /><button className="btn" onClick={onDone}>Mark done</button></div>
      </div>
    </div>
  );
}

export default function ResponseView() {
  useTick();
  const bk = useStore(s => s.bk);
  const [cmp, setCmp] = useState<Complaint[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [fAg, setFAg] = useState('all'), [fTier, setFTier] = useState('all'), [fSrc, setFSrc] = useState('all');
  const [sort, setSort] = useState<'score' | 'deadline'>('score');
  const [how, setHow] = useState(false);
  useEffect(() => { const id = setInterval(() => { if (M.mode === 'live') bump(); }, 2000); return () => clearInterval(id); }, []);
  useEffect(() => { fetchModel(); });
  useEffect(() => {
    let on = true;
    const go = () => fetchComplaints().then(r => on && setCmp(r));
    go(); const id = setInterval(go, 15000);
    return () => { on = false; clearInterval(id); };
  }, []);

  const now = Date.now();
  const { signals, routes, mode } = collectSignals(bk, cmp, !!M.leak);
  const all = buildActions(signals, now);
  // SLA deadlines are anchored to first sighting so the countdown doesn't reset every recompute.
  const seen = useMemo(() => new Map<string, number>(), []);
  for (const a of all) { if (!seen.has(a.key)) seen.set(a.key, now); if (a.slaH != null) a.deadline = seen.get(a.key)! + a.slaH * 3600e3; }
  const active = all.filter(a => !done.has(a.key));
  const threat = threatOf(active);
  const cnt = (t: Tier) => active.filter(a => a.tier === t).length;
  const protectedPeople = active.filter(a => a.tier === 'P1').reduce((s, a) => s + a.people, 0);
  const agencies = [...new Set(all.map(a => a.agency))].sort();
  const shown = active.filter(a => (fAg === 'all' || a.agency === fAg) && (fTier === 'all' || a.tier === fTier) && (fSrc === 'all' || a.sources.includes(fSrc as Source)))
    .sort(sort === 'score' ? (a, b) => b.score - a.score : (a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity) || b.score - a.score);
  const work = agencies.map(g => ({ g, n: TIERS.map(t => active.filter(a => a.agency === g && a.tier === t.t).length) })).filter(w => w.n.some(Boolean))
    .sort((a, b) => b.n[0] - a.n[0] || b.n[1] - a.n[1] || b.n[2] - a.n[2]);
  const maxW = Math.max(1, ...work.map(w => w.n.reduce((a, b) => a + b, 0)));

  return (
    <main id="resp" className="rs" style={{ display: 'grid' }}>
      <div className="card rs-card rs-head">
        <div className="ttl"><small>RESPONSE PLANNING · <span id="rdl">{M.mode == 'sim' ? 'SIMULATION' : 'LIVE'}</span></small><div>Priority queue</div></div>
        <div className="rs-kpis">
          <div className={'m rs-threat ' + threat.level} title="Mean priority score of the top-5 active actions: ≥60 Critical, ≥45 High, ≥25 Elevated, else Normal">
            <span>Threat level</span><b>{threat.level}</b><small>top-5 mean score {threat.value}</small></div>
          {TIERS.map(t => <div key={t.t} className="m"><span>{t.t === 'Monitor' ? 'Monitor' : t.t + ' actions'}</span><b className={'rs-c ' + t.t}>{cnt(t.t)}</b><small>{t.label}</small></div>)}
          <div className="m"><span>People protected if all P1 done</span><b>{fmt(protectedPeople)}</b><small>sum of people at P1 actions</small></div>
          <div className="m"><span>Data mode</span><b className="rs-mode">{mode}</b><small>{cmp.length} open complaints · updated {clock(now)}</small></div>
        </div>
      </div>

      <div className="card rs-card rs-how">
        <div className="t rs-toggle" onClick={() => setHow(!how)}>{how ? '▾' : '▸'} How priority is calculated <span className="tg M">Formula</span></div>
        {how && <div className="rs-body">
          <code className="rs-formula">priority = 100 × Severity × Exposure × Urgency × Confidence</code>
          <ul>
            <li><b style={{ color: FC[0][2] }}>Severity</b> (0–1): modelled risk of the asset; physics hotspot 0.5·probability + 0.5·min(1, depth/1.5 m); flooded hospital 0.5 + depth/2 (assumed catchment 20k people); complaint low .30 · medium .55 · high .80 · critical 1.0.</li>
            <li><b style={{ color: FC[1][2] }}>Exposure</b>: 0.45·criticality + 0.55·people factor. Criticality: hospital 1.0, substation .85, radiation .8, water .75, flood/disease .70, crowd .65, corridor/road .60, warehouse .45. People factor = log10(1+people)/6 (1k → .5, 1M → 1); synthetic assets use an assumed catchment × risk (e.g. flood spot 40k, substation 60k, corridor 80k); unknown → .5. Synthetic-only signals (confidence .7) top out around P2 — P1 needs physics backing or corroboration.</li>
            <li><b style={{ color: FC[2][2] }}>Urgency</b> = 24 / (24 + ETA h) from the cascade time-to-impact (now 1.0, 3 h .89, 12 h .67, 3 d .25). Complaints: critical 0 h, high 2 h, medium 6 h, low 24 h.</li>
            <li><b style={{ color: FC[3][2] }}>Confidence</b>: physics backend 1.0, synthetic model 0.7, single complaint 0.5 (+0.1 per corroborating complaint, +0.05·log2(1+upvotes), max .95); +0.1 when two source types agree.</li>
            <li>Duplicates (same agency, same place or within 1.5 km) merge: max of each factor, evidence combined.</li>
          </ul>
          <div className="rs-tiers">{TIERS.map(t => <span key={t.t}><span className={'rs-tier ' + t.t}>{t.t}</span> {t.t === 'Monitor' ? '< 25' : '≥ ' + t.min} · {t.label}</span>)}</div>
          <div className="rs-why">Threat level = mean score of top-5 active actions (≥60 Critical, ≥45 High, ≥25 Elevated).</div>
        </div>}
      </div>

      <div className="card rs-card rs-queue">
        <div className="t">Priority actions <span className="tg M">{shown.length} shown</span></div>
        <div className="rs-filters">
          <select aria-label="agency" value={fAg} onChange={e => setFAg(e.target.value)}><option value="all">All agencies</option>{agencies.map(a => <option key={a}>{a}</option>)}</select>
          <select aria-label="tier" value={fTier} onChange={e => setFTier(e.target.value)}><option value="all">All tiers</option>{TIERS.map(t => <option key={t.t}>{t.t}</option>)}</select>
          <select aria-label="source" value={fSrc} onChange={e => setFSrc(e.target.value)}><option value="all">All sources</option>{(Object.keys(SRC) as Source[]).map(s => <option key={s} value={s}>{SRC[s]}</option>)}</select>
          <select aria-label="sort" value={sort} onChange={e => setSort(e.target.value as any)}><option value="score">Sort: score</option><option value="deadline">Sort: deadline</option></select>
          {done.size > 0 && <button className="btn" onClick={() => setDone(new Set())}>Restore {done.size} done</button>}
        </div>
        {shown.length === 0 && <div className="pad" style={{ color: 'var(--mu)' }}>No actions match.</div>}
        {TIERS.map(t => {
          const xs = shown.filter(a => a.tier === t.t);
          if (!xs.length) return null;
          return <div key={t.t} className="rs-group"><div className="rs-gh"><span className={'rs-tier ' + t.t}>{t.t}</span> {t.label} · {xs.length}</div>
            {xs.map(a => <Row key={a.key} a={a} now={now} onDone={() => setDone(new Set(done).add(a.key))} />)}</div>;
        })}
      </div>

      <div className="rs-side">
        <div className="card rs-card">
          <div className="t">Agency workload <span className="tg S">Active</span></div>
          <div className="rs-body">{work.map(w => <div key={w.g} className="rs-wl"><span>{w.g}</span>
            <div className="rs-wbar">{w.n.map((n, i) => n ? <i key={i} className={TIERS[i].t} style={{ width: (n / maxW) * 100 + '%' }}>{n}</i> : null)}</div></div>)}
            {!work.length && <span style={{ color: 'var(--mu)' }}>No active actions.</span>}</div>
        </div>
        <div className="card rs-card">
          <div className="t">Alternate routes <span className="tg O">Traffic</span></div>
          {routes.length ? routes.map((r, i) => <div key={r.n} className="rt"><div><b>{r.n}</b><span className="chip">{Math.round(r.r * 100)}% · +{r.delay} min</span><br /><span className="alt">↪ {r.alt}</span><br /><small>Saves ~{r.save} min delay · push via VMS and app</small></div><Dbtn k={'rt' + i} /></div>)
            : <div className="pad" style={{ color: 'var(--mu)' }}>All corridors flowing.</div>}
        </div>
      </div>
    </main>
  );
}
