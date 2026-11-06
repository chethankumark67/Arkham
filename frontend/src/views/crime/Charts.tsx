/* Crime dashboard charts (recharts + small SVG/HTML pieces). Colours follow the crime type (crimeApi.TYPE_COLORS). */
import { useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { STATUS_COLORS, typeColor, type CrimeSummary, type CrimeTrend, type HeatMatrix, type NameCount } from '../../crimeApi';

const AX = { stroke: '#5b636c', fontSize: 10.5, tickLine: false } as const;
const TT = {
  contentStyle: { background: '#14181c', border: '1px solid #2b3138', borderRadius: 6, fontSize: 11.5, color: '#e6e9ec' },
  labelStyle: { color: '#aab2bb', marginBottom: 2 }, itemStyle: { padding: 0 }, cursor: { fill: '#ffffff0a', stroke: '#ffffff30' },
};
const fmtPeriod = (p: string, interval: string) => {
  const d = new Date(p + 'T00:00:00');
  return interval === 'month' ? d.toLocaleString('en', { month: 'short', year: '2-digit' }) : d.toLocaleString('en', { day: 'numeric', month: 'short' });
};

export function Legend({ items }: { items: { name: string; color: string; count?: number }[] }) {
  return <div className="cr-legend2">{items.map(i => <span key={i.name}><i style={{ background: i.color }} />{i.name}{i.count != null && <b>{i.count}</b>}</span>)}</div>;
}

export function KpiStrip({ s, dataset }: { s: CrimeSummary | null; dataset?: string }) {
  if (!s) return <div className="cr-kpis"><div className="cr-kpi muted">Loading KPIs…</div></div>;
  const ch = s.change_30d_pct;
  const top = s.by_type[0];
  const hr = (h: number | null) => (h == null ? '—' : `${String(h).padStart(2, '0')}:00`);
  return (
    <div className="cr-kpis">
      <div className="cr-kpi"><small>Total incidents</small><b>{s.total_incidents.toLocaleString()}</b><em>{s.date_range ? `${s.date_range[0]} → ${s.date_range[1]}` : ''}</em></div>
      <div className="cr-kpi"><small>Last 30 days</small><b>{s.last_30_days}</b>
        <em className={ch == null ? '' : ch > 0 ? 'up' : 'down'}>{ch == null ? 'no prior period' : `${ch > 0 ? '▲' : ch < 0 ? '▼' : '■'} ${Math.abs(ch)}% vs prev 30d (${s.previous_30_days})`}</em></div>
      <div className="cr-kpi"><small>Clearance rate</small><b>{s.clearance_rate}%</b><em>charge-sheeted + closed</em></div>
      <div className="cr-kpi"><small>Top crime type</small><b className="sm"><i style={{ background: top ? typeColor(top.name) : '#555' }} />{top?.name || '—'}</b><em>{top ? `${top.count} incidents (${Math.round(top.count / Math.max(1, s.total_incidents) * 100)}%)` : ''}</em></div>
      <div className="cr-kpi"><small>Peak hour · day</small><b>{hr(s.peak_hour)}</b><em>{s.peak_day || ''}</em></div>
      <div className="cr-kpi"><small>Active gangs (90d)</small><b>{s.active_gangs_90d}</b><em>{s.known_gangs} known · {s.attributed_share}% attributed</em></div>
      <div className="cr-kpi cr-syn"><span>{dataset === 'synthetic' ? 'SYNTHETIC DEMO DATA' : 'MOCK DATA'}</span><em>Generated, not real FIRs</em></div>
    </div>
  );
}

export function TrendChart({ trend, interval, onInterval }: { trend: CrimeTrend | null; interval: 'week' | 'month'; onInterval: (i: 'week' | 'month') => void }) {
  const [mode, setMode] = useState<'stack' | 'lines'>('stack');
  const types = trend?.types || [];
  return (
    <div>
      <div className="cr-row cr-seg">
        {(['month', 'week'] as const).map(i => <button key={i} className={'btn cr-mini' + (interval === i ? ' on' : '')} onClick={() => onInterval(i)}>{i === 'month' ? 'Monthly' : 'Weekly'}</button>)}
        <span className="sp" />
        {(['stack', 'lines'] as const).map(m => <button key={m} className={'btn cr-mini' + (mode === m ? ' on' : '')} onClick={() => setMode(m)}>{m === 'stack' ? 'Stacked area' : 'Lines'}</button>)}
      </div>
      <div style={{ height: 260 }}>
        {trend && <ResponsiveContainer width="100%" height="100%">
          {mode === 'stack' ? (
            <AreaChart data={trend.data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#22282e" vertical={false} />
              <XAxis dataKey="period" {...AX} tickFormatter={p => fmtPeriod(p, interval)} minTickGap={18} />
              <YAxis {...AX} allowDecimals={false} />
              <Tooltip {...TT} labelFormatter={p => fmtPeriod(String(p), interval)} />
              {types.map(t => <Area key={t} type="monotone" dataKey={t} stackId="1" stroke="#14181c" strokeWidth={1} fill={typeColor(t)} fillOpacity={0.85} isAnimationActive={false} />)}
            </AreaChart>
          ) : (
            <LineChart data={trend.data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#22282e" vertical={false} />
              <XAxis dataKey="period" {...AX} tickFormatter={p => fmtPeriod(p, interval)} minTickGap={18} />
              <YAxis {...AX} allowDecimals={false} />
              <Tooltip {...TT} labelFormatter={p => fmtPeriod(String(p), interval)} />
              {types.map(t => <Line key={t} type="monotone" dataKey={t} stroke={typeColor(t)} strokeWidth={2} dot={false} isAnimationActive={false} />)}
            </LineChart>
          )}
        </ResponsiveContainer>}
      </div>
      <Legend items={types.map(t => ({ name: t, color: typeColor(t) }))} />
    </div>
  );
}

export function TypeBreakdown({ data, onPick }: { data: NameCount[]; onPick?: (t: string) => void }) {
  const total = data.reduce((a, b) => a + b.count, 0);
  return (
    <div className="cr-donutwrap">
      <div style={{ width: 170, height: 170, position: 'relative' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={1} stroke="#14181c" strokeWidth={2} isAnimationActive={false}
              onClick={(d: any) => onPick?.(d.name)}>
              {data.map(d => <Cell key={d.name} fill={typeColor(d.name)} style={{ cursor: onPick ? 'pointer' : undefined }} />)}
            </Pie>
            <Tooltip {...TT} />
          </PieChart>
        </ResponsiveContainer>
        <div className="cr-donut-c"><b>{total}</b><small>incidents</small></div>
      </div>
      <div className="cr-hbars">
        {data.map(d => <div key={d.name} onClick={() => onPick?.(d.name)} title={onPick ? 'Filter to this type' : ''}>
          <span><i style={{ background: typeColor(d.name) }} />{d.name}</span>
          <div className="cr-bar"><i style={{ width: `${(d.count / Math.max(1, data[0]?.count || 1)) * 100}%`, background: typeColor(d.name) }} /></div>
          <b>{d.count}</b>
        </div>)}
      </div>
    </div>
  );
}

export function HeatMatrixChart({ hm }: { hm: HeatMatrix | null }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  if (!hm) return <small className="muted">Loading…</small>;
  const c = (v: number) => {
    const t = hm.max ? v / hm.max : 0;
    return v === 0 ? '#161a1e' : `rgba(254,145,53,${0.12 + 0.88 * t})`;
  };
  return (
    <div className="cr-hm">
      <div className="cr-hm-grid">
        <span />
        {hm.hours.map(h => <small key={h} className="hh">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</small>)}
        {hm.days.map((d, di) => [
          <small key={d} className="dd">{d.slice(0, 3)}</small>,
          ...hm.hours.map(h => <i key={d + h} style={{ background: c(hm.matrix[di][h]) }} onMouseEnter={() => setHover({ d: di, h })} onMouseLeave={() => setHover(null)}
            className={hover && hover.d === di && hover.h === h ? 'on' : ''} />),
        ])}
      </div>
      <div className="cr-hm-foot">
        <span>{hover ? <><b>{hm.days[hover.d]} {String(hover.h).padStart(2, '0')}:00–{String(hover.h + 1).padStart(2, '0')}:00</b> · {hm.matrix[hover.d][hover.h]} incidents</> : 'Hover a cell for counts'}</span>
        <span className="cr-ramp">0<i />{hm.max}</span>
      </div>
    </div>
  );
}

export function StationsBar({ data, onPick }: { data: NameCount[]; onPick?: (s: string) => void }) {
  return (
    <div style={{ height: Math.max(160, data.length * 24 + 20) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
          <XAxis type="number" {...AX} allowDecimals={false} hide />
          <YAxis type="category" dataKey="name" {...AX} width={120} />
          <Tooltip {...TT} />
          <Bar dataKey="count" name="Incidents" fill="#3987e5" radius={[0, 4, 4, 0]} barSize={14} isAnimationActive={false}
            label={{ position: 'right', fill: '#aab2bb', fontSize: 10.5 }} onClick={(d: any) => onPick?.(d.name)} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StatusBreakdown({ data, clearance }: { data: NameCount[]; clearance: number }) {
  const total = data.reduce((a, b) => a + b.count, 0) || 1;
  return (
    <div className="cr-status-bd">
      <div className="cr-stack">{data.map(d => <i key={d.name} title={`${d.name}: ${d.count}`} style={{ width: `${(d.count / total) * 100}%`, background: STATUS_COLORS[d.name] || '#666' }} />)}</div>
      {data.map(d => <div key={d.name} className="cr-kv"><span><i className="sw" style={{ background: STATUS_COLORS[d.name] || '#666' }} />{d.name}</span><b>{d.count} · {Math.round(d.count / total * 100)}%</b></div>)}
      <div className="cr-kv"><span>Clearance rate</span><b>{clearance}%</b></div>
    </div>
  );
}
