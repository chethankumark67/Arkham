/* Suspect network: small deterministic force layout rendered in SVG (no extra deps).
   Click a node to highlight its neighbours; `focus` (e.g. a traced plate) selects a node externally. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CrimeNetwork, NetNode, NetNodeType } from '../../crimeApi';
import { typeColor } from '../../crimeApi';

export const NODE_COLORS: Record<NetNodeType, string> = { suspect: '#e66767', vehicle: '#3987e5', city: '#c98500', incident: '#8a8f98' };
const R: Record<NetNodeType, number> = { suspect: 7, vehicle: 6, city: 13, incident: 3.5 };
type P = { x: number; y: number; vx: number; vy: number };

function layout(net: CrimeNetwork, W: number, H: number): Record<string, P> {
  // deterministic seed positions on a circle, then simple force iterations
  const pos: Record<string, P> = {};
  const n = net.nodes.length;
  net.nodes.forEach((d, i) => {
    const a = (i / n) * Math.PI * 2, r = d.type === 'city' ? 60 : 180 + (i % 7) * 12;
    pos[d.id] = { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r, vx: 0, vy: 0 };
  });
  const ids = net.nodes.map(d => d.id);
  const edges = net.edges.filter(e => pos[e.source] && pos[e.target]);
  for (let it = 0; it < 320; it++) {
    const alpha = 1 - it / 320;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = pos[ids[i]], b = pos[ids[j]];
      let dx = a.x - b.x, dy = a.y - b.y; const d2 = Math.max(36, dx * dx + dy * dy);
      if (d2 > 40000) continue;
      const f = (60 / d2) * alpha; dx *= f; dy *= f;
      a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
    }
    for (const e of edges) {
      const a = pos[e.source], b = pos[e.target];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const L = e.type === 'COMMITTED_BY' ? 22 : e.type === 'ACTIVE_IN' ? 120 : 45;
      const k = (e.type === 'ACTIVE_IN' ? 0.012 : 0.06) * (d - L) / d * alpha;
      a.vx += dx * k; a.vy += dy * k; b.vx -= dx * k; b.vy -= dy * k;
    }
    for (const id of ids) {
      const p = pos[id];
      p.vx += (W / 2 - p.x) * 0.01 * alpha; p.vy += (H / 2 - p.y) * 0.01 * alpha;
      p.vx *= 0.6; p.vy *= 0.6;
      const sp = Math.hypot(p.vx, p.vy); if (sp > 12) { p.vx *= 12 / sp; p.vy *= 12 / sp; }
      p.x = Math.max(16, Math.min(W - 16, p.x + p.vx)); p.y = Math.max(16, Math.min(H - 16, p.y + p.vy));
    }
  }
  return pos;
}

export default function NetworkGraph({ net, focus, onSelect }: { net: CrimeNetwork | null; focus?: string | null; onSelect?: (n: NetNode | null) => void }) {
  const W = 900, H = 560;
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [show, setShow] = useState<Record<NetNodeType, boolean>>({ suspect: true, vehicle: true, city: true, incident: true });
  const pos = useMemo(() => (net ? layout(net, W, H) : {}), [net]);
  const adj = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    net?.edges.forEach(e => { (m[e.source] ||= new Set()).add(e.target); (m[e.target] ||= new Set()).add(e.source); });
    return m;
  }, [net]);
  const byId = useMemo(() => Object.fromEntries((net?.nodes || []).map(n => [n.id, n])), [net]);
  const pick = (id: string | null) => { setSel(id); onSelect?.(id ? byId[id] : null); };
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  useEffect(() => {
    if (!focus || !net) return;
    const id = net.nodes.find(n => n.label.toUpperCase() === focus.toUpperCase() || n.id === focus)?.id || null;
    setSel(id); onSelectRef.current?.(id ? byId[id] : null);
  }, [focus, net, byId]);

  if (!net) return <small className="muted">Loading network…</small>;
  const active = sel || hover;
  const nb = active ? adj[active] || new Set<string>() : null;
  const lit = (id: string) => !nb || id === active || nb.has(id);
  const vis = (id: string) => byId[id] && show[byId[id].type];
  return (
    <div className="cr-net">
      <div className="cr-row cr-seg">
        {(Object.keys(NODE_COLORS) as NetNodeType[]).map(t => <label key={t} className="cr-check"><input type="checkbox" checked={show[t]} onChange={e => setShow({ ...show, [t]: e.target.checked })} />
          <i className="sw" style={{ background: NODE_COLORS[t], borderRadius: '50%' }} />{t} <small className="muted">{net.counts[t]}</small></label>)}
        <span className="sp" /><small className="muted">source: {net.source} · click a node, click background to reset</small>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="cr-net-svg" onClick={() => pick(null)} role="img" aria-label="Suspect network graph">
        <g>
          {net.edges.filter(e => vis(e.source) && vis(e.target)).map((e, i) => {
            const a = pos[e.source], b = pos[e.target]; const on = active && (e.source === active || e.target === active);
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={on ? '#FE9135' : e.type === 'DRIVES' ? '#3987e5' : '#5b636c'}
              strokeOpacity={active ? (on ? 0.95 : 0.06) : e.type === 'ACTIVE_IN' ? 0.18 : 0.45} strokeWidth={on ? 1.8 : Math.min(3, 0.6 + e.weight * 0.15)} />;
          })}
        </g>
        <g>
          {net.nodes.filter(n => show[n.type]).map(n => {
            const p = pos[n.id]; const r = R[n.type] + (n.type === 'suspect' ? Math.min(6, Math.sqrt(n.count)) : 0);
            const fill = n.type === 'incident' && n.crime_type ? typeColor(n.crime_type) : NODE_COLORS[n.type];
            const showLabel = n.id === active || (nb?.has(n.id) && n.type !== 'incident') || (!active && (n.type === 'city' || (n.type === 'suspect' && n.count >= 12)));
            return <g key={n.id} transform={`translate(${p.x},${p.y})`} opacity={lit(n.id) ? 1 : 0.15} style={{ cursor: 'pointer' }}
              onClick={ev => { ev.stopPropagation(); pick(n.id === sel ? null : n.id); }} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} data-node={n.id}>
              <circle r={r + 5} fill="transparent" />
              {n.type === 'vehicle' ? <rect x={-r} y={-r * 0.7} width={r * 2} height={r * 1.4} rx={2} fill={fill} stroke={n.id === sel ? '#fff' : '#14181c'} strokeWidth={n.id === sel ? 2 : 1.5} />
                : <circle r={r} fill={fill} stroke={n.id === sel ? '#fff' : '#14181c'} strokeWidth={n.id === sel ? 2 : 1.5} />}
              {showLabel && <text y={-r - 4} textAnchor="middle" className="cr-net-lbl">{n.label.replace(/_/g, ' ')}</text>}
            </g>;
          })}
        </g>
      </svg>
    </div>
  );
}
