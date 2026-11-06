/* Officials' board: stats, filters, map + priority-sorted list, detail drawer with triage actions. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import CMap, { type Pt } from './CMap';
import {
  AGENCIES, CATS, PRIO_RGB, STATUSES, TRANSITIONS, ago, cApi, catOf, label, photoUrl, prioCss,
  type Complaint, type Stats, type Status,
} from './api';

export default function Board({ online, onOffline }: { online: boolean | null; onOffline: (b: boolean) => void }) {
  const [items, setItems] = useState<Complaint[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [f, setF] = useState({ status: 'open', category: '', priority: '', q: '', sort: 'priority' });
  const [sel, setSel] = useState<Complaint | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, s] = await Promise.all([cApi.list({ ...f, limit: 300 }), cApi.stats()]);
      setItems(l.items); setTotal(l.total); setStats(s); setErr(null); onOffline(false);
    } catch (e) { setErr((e as Error).message); if ((e as Error).message.includes('fetch')) onOffline(true); }
    finally { setLoading(false); }
  }, [f, onOffline]);
  useEffect(() => { const t = setTimeout(load, f.q ? 300 : 0); return () => clearTimeout(t); }, [load, f.q]);

  const refreshOne = (c: Complaint) => { setSel(c); setItems(xs => xs.map(x => (x.id === c.id ? c : x))); cApi.stats().then(setStats).catch(() => {}); };

  const pts: Pt[] = useMemo(() => items.map(c => ({ id: c.id, lat: c.lat, lon: c.lon, rgb: PRIO_RGB[c.priority], sel: sel?.id === c.id,
    r: c.priority === 'P1' ? 8 : c.priority === 'P2' ? 6.5 : 5, tip: `<b>${c.priority}</b> · ${c.id}<br>${escapeHtml(c.title)}<br>${label(c.status)} · ${c.assigned_agency}` })), [items, sel]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="cm-board">
      <div className="card cm-card cm-stats">
        <Stat k="Open" v={stats?.open} /><Stat k="Open P1" v={stats?.open_p1} c={prioCss('P1')} />
        <Stat k="Median open age" v={stats ? `${stats.median_age_hours} h` : undefined} />
        <Stat k="New" v={stats?.by_status.new} /><Stat k="In progress" v={stats?.by_status.in_progress} />
        <Stat k="Resolved" v={stats?.by_status.resolved} c="var(--gr)" />
        <div className="cm-agencies">{stats && Object.entries(stats.by_agency).filter(([, n]) => n).map(([a, n]) => <span key={a}>{a} <b>{n}</b></span>)}</div>
      </div>

      <div className="card cm-card cm-filters">
        <select aria-label="Status" value={f.status} onChange={set('status')}>
          <option value="open">Open (new · ack · in progress)</option><option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <select aria-label="Category" value={f.category} onChange={set('category')}>
          <option value="">All categories</option>{CATS.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
        </select>
        <select aria-label="Priority" value={f.priority} onChange={set('priority')}>
          <option value="">All priorities</option><option>P1</option><option>P2</option><option>P3</option>
        </select>
        <select aria-label="Sort" value={f.sort} onChange={set('sort')}>
          <option value="priority">Sort: priority</option><option value="newest">Sort: newest</option><option value="upvotes">Sort: upvotes</option>
        </select>
        <input aria-label="Search" placeholder="Search title, place, ID…" value={f.q} onChange={set('q')} />
        <button className="btn" onClick={load}>{loading ? '…' : '↻ Refresh'}</button>
        <span className="cm-muted">{total} shown</span>
        <span className="cm-legend">{(['P1', 'P2', 'P3'] as const).map(p => <span key={p}><i style={{ background: prioCss(p) }} />{p}</span>)}</span>
      </div>

      {(err || online === false) && <div className="cm-err cm-wide">Backend unavailable ({err ?? 'offline'}). Start the API on :8000 and press Refresh.</div>}

      <div className="card cm-card cm-bmap"><div className="cm-map"><CMap points={pts} onPointClick={id => setSel(items.find(i => i.id === id) ?? null)} focus={sel} /></div></div>

      <div className="card cm-card cm-list">
        <div className="t">Complaints <span className="cm-muted">{f.sort === 'priority' ? 'by priority' : f.sort}</span></div>
        <div className="cm-rows">
          {items.length === 0 && !loading && <div className="cm-muted cm-pad">No complaints match these filters.</div>}
          {items.map(c => (
            <button key={c.id} className={'cm-item' + (sel?.id === c.id ? ' on' : '')} onClick={() => setSel(c)}>
              <span className="cm-p" style={{ background: prioCss(c.priority) }}>{c.priority}</span>
              <span className="cm-it"><b>{catOf(c.category).icon} {c.title}</b>
                <small>{c.id} · {c.address ?? `${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}`} · {ago(c.created_at)}</small></span>
              <span className="cm-im"><span className={'cm-st ' + c.status}>{label(c.status)}</span><small>{c.assigned_agency} · ▲{c.upvotes}{c.photos.length ? ` · 📷${c.photos.length}` : ''}</small></span>
            </button>
          ))}
        </div>
      </div>

      {sel && <Drawer key={sel.id} c={sel} onClose={() => setSel(null)} onChange={refreshOne} />}
    </div>
  );
}

function Stat({ k, v, c }: { k: string; v?: number | string; c?: string }) {
  return <div className="ttl"><small>{k.toUpperCase()}</small><div style={c ? { color: c } : undefined}>{v ?? '—'}</div></div>;
}

function escapeHtml(s: string) { return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!)); }

function Drawer({ c, onClose, onChange }: { c: Complaint; onClose: () => void; onChange: (c: Complaint) => void }) {
  const [status, setStatus] = useState<Status | ''>('');
  const [agency, setAgency] = useState(c.assigned_agency);
  const [prio, setPrio] = useState(c.priority);
  const [dup, setDup] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lb, setLb] = useState<number | null>(null);

  const save = async () => {
    const body: Record<string, unknown> = {};
    if (status) body.status = status;
    if (status === 'duplicate') body.duplicate_of = dup.trim();
    if (agency !== c.assigned_agency) body.assigned_agency = agency;
    if (prio !== c.priority) body.priority = prio;
    if (note.trim()) body.note = note.trim();
    if (!Object.keys(body).length) { setErr('Nothing to update.'); return; }
    setBusy(true); setErr(null);
    try { onChange(await cApi.patch(c.id, body)); setStatus(''); setNote(''); setDup(''); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const upvote = async () => { try { const r = await cApi.upvote(c.id); onChange({ ...c, upvotes: r.upvotes }); } catch (e) { setErr((e as Error).message); } };

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') (lb !== null ? setLb(null) : onClose()); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [lb, onClose]);

  return (
    <aside className="card cm-drawer" data-testid="drawer">
      <div className="t"><span><span className="cm-p" style={{ background: prioCss(c.priority) }}>{c.priority}</span> {c.id}{c.demo ? <em className="cm-demo">demo</em> : null}</span>
        <button className="btn" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="cm-body">
        <h3>{catOf(c.category).icon} {c.title}</h3>
        <div className="cm-kv"><span>Status</span><b className={'cm-st ' + c.status}>{label(c.status)}</b></div>
        <div className="cm-kv"><span>Category</span><b>{catOf(c.category).label}</b></div>
        <div className="cm-kv"><span>Reported severity</span><b className={'cm-sevt ' + c.severity}>{c.severity}</b></div>
        <div className="cm-kv"><span>Agency</span><b>{c.assigned_agency}</b></div>
        <div className="cm-kv"><span>Location</span><b>{c.address ?? '—'} <small className="cm-mono">{c.lat.toFixed(5)}, {c.lon.toFixed(5)}</small></b></div>
        <div className="cm-kv"><span>Reported</span><b>{new Date(c.created_at).toLocaleString()} ({ago(c.created_at)})</b></div>
        {(c.reporter_name || c.reporter_phone) && <div className="cm-kv"><span>Reporter</span><b>{c.reporter_name} {c.reporter_phone}</b></div>}
        {c.duplicate_of && <div className="cm-kv"><span>Duplicate of</span><b>{c.duplicate_of}</b></div>}
        <div className="cm-kv"><span>Upvotes</span><b>▲ {c.upvotes} <button className="btn" onClick={upvote}>+1</button></b></div>
        {c.description && <p className="cm-desc">{c.description}</p>}
        {c.photos.length > 0 && <div className="cm-thumbs">{c.photos.map((u, i) => (
          <button key={u} className="cm-thumb" onClick={() => setLb(i)}><img src={photoUrl(u)} alt={`photo ${i + 1}`} /></button>
        ))}</div>}

        <div className="cm-sub">Triage</div>
        <div className="cm-grid2">
          <label><b>Change status</b><select value={status} onChange={e => setStatus(e.target.value as Status)} aria-label="New status">
            <option value="">— keep ({label(c.status)}) —</option>{TRANSITIONS[c.status].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></label>
          <label><b>Assign agency</b><select value={agency} onChange={e => setAgency(e.target.value)}>{AGENCIES.map(a => <option key={a}>{a}</option>)}</select></label>
          <label><b>Priority</b><select value={prio} onChange={e => setPrio(e.target.value as Complaint['priority'])}><option>P1</option><option>P2</option><option>P3</option></select></label>
          {status === 'duplicate' && <label><b>Duplicate of (ID)</b><input value={dup} onChange={e => setDup(e.target.value)} placeholder="CR-…" /></label>}
        </div>
        <label><b>Note</b><textarea rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="Action taken, crew dispatched…" /></label>
        {err && <div className="cm-err">{err}</div>}
        <button className="run" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Update complaint'}</button>

        <div className="cm-sub">History</div>
        <ol className="cm-tl">{[...c.history].reverse().map((h, i) => (
          <li key={i}><i className={'cm-st ' + h.status} /><div><b>{label(h.status)}</b> <small>{new Date(h.at).toLocaleString()}</small><p>{h.note}</p></div></li>
        ))}</ol>
      </div>
      {lb !== null && (
        <div className="cm-lightbox" onClick={() => setLb(null)} role="dialog">
          <img src={photoUrl(c.photos[lb])} alt="" onClick={e => e.stopPropagation()} />
          {c.photos.length > 1 && <div className="cm-lbnav" onClick={e => e.stopPropagation()}>
            <button className="btn" onClick={() => setLb((lb + c.photos.length - 1) % c.photos.length)}>‹</button>
            <span>{lb + 1}/{c.photos.length}</span>
            <button className="btn" onClick={() => setLb((lb + 1) % c.photos.length)}>›</button></div>}
        </div>
      )}
    </aside>
  );
}
