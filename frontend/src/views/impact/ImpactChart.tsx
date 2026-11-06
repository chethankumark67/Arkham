/* Faithful port of the legacy chart(tl, peak) SVG. */
const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
export default function ImpactChart({ tl, peak }: { tl: any[]; peak: number }) {
  const W = 620, H = 220, L = 46, R = 46, T = 12, B = 26, x = (h: number) => L + h / 12 * (W - L - R);
  const m1 = Math.max(1, ...tl.map(r => r.people_cut_off)), m2 = Math.max(1, ...tl.map(r => Math.max(r.flooded_km2_gt_0_3m, r.roads_closed_km)));
  const y1 = (v: number) => H - B - v / m1 * (H - T - B), y2 = (v: number) => H - B - v / m2 * (H - T - B);
  const path = (f: (r: any) => number, y: (v: number) => number) => tl.map((r, i) => (i ? 'L' : 'M') + x(r.hour).toFixed(1) + ',' + y(f(r)).toFixed(1)).join('');
  const fl = path(r => r.flooded_km2_gt_0_3m, y2), p = tl[peak];
  return (
    <svg id="iaChart" viewBox="0 0 620 220" style={{ width: '100%', height: 220 }}>
      {[0, 1, 2, 3, 4].map(i => { const yy = T + i * (H - T - B) / 4; return <g key={'g' + i}>
        <line x1={L} x2={W - R} y1={yy} y2={yy} stroke="#22282e" />
        <text x={L - 6} y={yy + 4} fill="#e5533d" fontSize="10" textAnchor="end">{fmt(m1 * (1 - i / 4))}</text>
        <text x={W - R + 6} y={yy + 4} fill="#4c8dd6" fontSize="10">{Math.round(m2 * (1 - i / 4))}</text></g>; })}
      {[0, 2, 4, 6, 8, 10, 12].map(h => <text key={'h' + h} x={x(h)} y={H - 8} fill="#8b949e" fontSize="10" textAnchor="middle">t+{h}h</text>)}
      <rect x={x(0)} y={T} width={x(6) - x(0)} height={H - T - B} fill="#4c8dd6" opacity=".06" />
      <text x={x(3)} y={T + 12} fill="#4c8dd6" fontSize="10" textAnchor="middle">storm</text>
      <path d={`${fl} L${x(12)},${H - B} L${x(0)},${H - B}Z`} fill="#4c8dd6" opacity=".18" />
      <path d={fl} stroke="#4c8dd6" fill="none" strokeWidth="2" />
      <path d={path(r => r.roads_closed_km, y2)} stroke="#FE9135" fill="none" strokeWidth="1.6" strokeDasharray="4 3" />
      <path d={path(r => r.people_cut_off, y1)} stroke="#e5533d" fill="none" strokeWidth="2.4" />
      {p && <>
        <line x1={x(peak)} x2={x(peak)} y1={T} y2={H - B} stroke="#FBC246" strokeDasharray="3" />
        <circle cx={x(peak)} cy={y1(p.people_cut_off)} r="4" fill="#e5533d" />
        <text x={x(peak) + 6} y={y1(p.people_cut_off) - 6} fill="#e6e9ec" fontSize="11">{fmt(p.people_cut_off)} cut off</text></>}
    </svg>
  );
}
