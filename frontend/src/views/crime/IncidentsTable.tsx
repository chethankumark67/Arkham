/* Paginated, searchable incidents table (server-side paging via /api/v1/incidents). Row click -> onPick (fly on map). */
import { useEffect, useState } from 'react';
import { dashApi, STATUS_COLORS, typeColor, type CrimeFilters, type IncidentRow } from '../../crimeApi';

export default function IncidentsTable({ filters, online, onPick, pageSize = 12 }: { filters: CrimeFilters; online: boolean | null; onPick: (r: IncidentRow) => void; pageSize?: number }) {
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(0), [qd, filters]);
  useEffect(() => {
    if (!online) return;
    dashApi.incidents(filters, { limit: pageSize, offset: page * pageSize, q: qd })
      .then(r => { setRows(r.data); setTotal(r.total); setErr(null); }).catch(e => setErr(e.message));
  }, [filters, page, qd, online, pageSize]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="cr-inc">
      <div className="cr-row">
        <input className="cr-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search FIR text, ID, suspect, plate, locality, station, MO…" />
        <small className="muted">{total.toLocaleString()} matching</small>
      </div>
      {err && <div className="cr-err">⚠ {err}</div>}
      <table className="cr-table cr-inc-t"><thead><tr><th>ID</th><th>When</th><th>Type</th><th>Locality / station</th><th>Status</th><th>Suspect</th><th>Plate</th></tr></thead>
        <tbody>
          {rows.map(r => [
            <tr key={r.incident_id} onClick={() => { onPick(r); setOpen(open === r.incident_id ? null : r.incident_id); }} className={open === r.incident_id ? 'sel' : ''} style={{ cursor: 'pointer' }}>
              <td className="mono">{r.incident_id}</td><td className="mono">{r.timestamp.slice(0, 16)}</td>
              <td><i className="sw" style={{ background: typeColor(r.crime_type) }} />{r.crime_type}</td>
              <td>{r.locality || r.city}<small className="muted"> · {r.police_station}</small></td>
              <td><i className="sw" style={{ background: STATUS_COLORS[r.status] || '#666' }} />{r.status}</td>
              <td>{r.suspect_alias === 'Unknown' ? <span className="muted">Unknown</span> : r.suspect_alias.replace(/_/g, ' ')}</td>
              <td className="mono">{r.vehicle_plate}</td>
            </tr>,
            open === r.incident_id && <tr key={r.incident_id + '-d'} className="cr-inc-d"><td colSpan={7}>
              <div>{r.fir_text}</div>
              <small className="muted">MO: {r.mo.replace(/_/g, ' ')} · {r.city} · {r.ward}{r.gang ? ` · gang: ${r.gang}` : ''}{r.is_festival ? ' · festival day' : ''}{r.is_payday ? ' · payday' : ''} · {r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}</small>
            </td></tr>,
          ])}
          {!rows.length && <tr><td colSpan={7} className="muted">No incidents match</td></tr>}
        </tbody></table>
      <div className="cr-row cr-pager">
        <button className="btn cr-mini" disabled={page === 0} onClick={() => setPage(0)}>«</button>
        <button className="btn cr-mini" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
        <span className="mono">Page {page + 1} / {pages}</span>
        <button className="btn cr-mini" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Next ›</button>
        <button className="btn cr-mini" disabled={page + 1 >= pages} onClick={() => setPage(pages - 1)}>»</button>
      </div>
    </div>
  );
}
