/* Stress-test curve and cost frontier for the Resilience Planning Studio. One y-axis each; hover = per-point tooltip. */
import { FUNCTION_LOSS, fmt, type Outcome } from './plan';

const BASE = '#8b949e', PLAN = '#FE9135', GRID = '#22282e', INK = '#8b949e';

export function StressCurve({ base, plan, bpBase, bpPlan, design }: { base: Outcome[]; plan: Outcome[] | null; bpBase: number | null; bpPlan: number | null; design: number }) {
  const W = 820, H = 250, L = 50, R = 14, T = 14, B = 28;
  const rs = base.map(o => o.rain), x0 = rs[0], x1 = rs[rs.length - 1];
  const ymax = Math.max(...base.map(o => o.cut), ...(plan ?? []).map(o => o.cut), FUNCTION_LOSS * 2);
  const X = (r: number) => L + (r - x0) / (x1 - x0) * (W - L - R), Y = (v: number) => T + (1 - v / ymax) * (H - T - B);
  const path = (c: Outcome[]) => c.map((o, i) => `${i ? 'L' : 'M'}${X(o.rain)},${Y(o.cut)}`).join('');
  const area = (c: Outcome[]) => `${path(c)}L${X(x1)},${Y(0)}L${X(x0)},${Y(0)}Z`;
  const ticks = [0, .25, .5, .75, 1].map(f => f * ymax);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rz-svg" role="img"
      aria-label={`People cut off from hospitals against storm size. Breaking point today ${bpBase ?? 'beyond 200'} mm; with plan ${bpPlan ?? 'beyond 200'} mm.`}>
      {ticks.map(v => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke={GRID} /><text x={L - 6} y={Y(v) + 3} textAnchor="end" fill={INK}>{v ? fmt(v).replace(' lakh', 'L') : 0}</text></g>)}
      {rs.map(r => <text key={r} x={X(r)} y={H - 10} textAnchor="middle" fill={INK}>{r}</text>)}
      <text x={W - R} y={H - 1} textAnchor="end" fill={INK}>storm, mm in 6 h</text>
      <rect x={X(Math.max(x0, design - 10))} y={T} width={X(Math.min(x1, design + 10)) - X(Math.max(x0, design - 10))} height={H - T - B} fill="rgba(76,141,214,.08)" />
      <text x={X(design)} y={T - 3} textAnchor="middle" fill="#4c8dd6">design storm</text>
      <line x1={L} x2={W - R} y1={Y(FUNCTION_LOSS)} y2={Y(FUNCTION_LOSS)} stroke="#e5533d" strokeDasharray="4 3" />
      <text x={W - R - 4} y={Y(FUNCTION_LOSS) - 5} textAnchor="end" fill="#e8ebee">10,000 people cut off: city loses function</text>
      <path d={area(base)} fill="rgba(139,148,158,.10)" />
      <path d={path(base)} fill="none" stroke={BASE} strokeWidth={2} />
      {plan && <><path d={area(plan)} fill="rgba(254,145,53,.12)" /><path d={path(plan)} fill="none" stroke={PLAN} strokeWidth={2} /></>}
      {bpBase && <g><circle cx={X(bpBase)} cy={Y(FUNCTION_LOSS)} r={5} fill={BASE} stroke="#171b1f" strokeWidth={2} /></g>}
      {plan && bpPlan && <g><circle cx={X(bpPlan)} cy={Y(FUNCTION_LOSS)} r={5} fill={PLAN} stroke="#171b1f" strokeWidth={2} /></g>}
      <text x={X(x1) - 4} y={Y(base[base.length - 1].cut) + 12} textAnchor="end" fill="#e8ebee">Today</text>
      {plan && <text x={X(x1) - 4} y={Y(plan[plan.length - 1].cut) - 6} textAnchor="end" fill="#e8ebee">With plan</text>}
      {base.map((o, i) => {
        const w = (W - L - R) / (rs.length - 1);
        return <rect key={o.rain} x={X(o.rain) - w / 2} y={T} width={w} height={H - T - B} fill="transparent" className="rz-hit">
          <title>{`${o.rain} mm in 6 h\nToday: ${fmt(o.cut)} cut off · ${o.hosp} hospitals flooded · ${o.roads} km roads closed` + (plan ? `\nWith plan: ${fmt(plan[i].cut)} cut off · ${plan[i].hosp} hospitals flooded · ${plan[i].roads} km roads closed` : '')}</title></rect>;
      })}
    </svg>
  );
}

interface P { interventions: string[]; cost_cr: number; people_cut_off: number }
export function Frontier({ pts, plan, budget, labels }: { pts: P[]; plan: { cost: number; cut: number } | null; budget: number; labels: Record<string, string> }) {
  const W = 440, H = 190, L = 46, R = 14, T = 12, B = 28;
  const xmax = Math.max(410, ...pts.map(p => p.cost_cr)), ymax = Math.max(...pts.map(p => p.people_cut_off), 1);
  const X = (c: number) => L + c / xmax * (W - L - R), Y = (v: number) => T + (1 - v / ymax) * (H - T - B);
  const step = pts.map((p, i) => `${i ? `L${X(p.cost_cr)},${Y(pts[i - 1].people_cut_off)}L` : 'M'}${X(p.cost_cr)},${Y(p.people_cut_off)}`).join('') + `L${X(xmax)},${Y(pts[pts.length - 1].people_cut_off)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rz-svg" role="img" aria-label="Best achievable people cut off for each budget">
      {[0, .5, 1].map(f => <g key={f}><line x1={L} x2={W - R} y1={Y(f * ymax)} y2={Y(f * ymax)} stroke={GRID} /><text x={L - 6} y={Y(f * ymax) + 3} textAnchor="end" fill={INK}>{f ? fmt(f * ymax).replace(' lakh', 'L') : 0}</text></g>)}
      {[0, 100, 200, 300, 400].map(c => <text key={c} x={X(c)} y={H - 10} textAnchor="middle" fill={INK}>₹{c}</text>)}
      <text x={W - R} y={H - 1} textAnchor="end" fill={INK}>budget, ₹ crore</text>
      <line x1={X(budget)} x2={X(budget)} y1={T} y2={H - B} stroke="#4c8dd6" strokeDasharray="3 3" />
      <text x={X(budget) + 4} y={T + 8} fill="#4c8dd6">your budget</text>
      <path d={step} fill="none" stroke="#4fae78" strokeWidth={2} />
      {pts.map(p => <g key={p.interventions.join() || 'none'}>
        <circle cx={X(p.cost_cr)} cy={Y(p.people_cut_off)} r={4.5} fill="#4fae78" stroke="#171b1f" strokeWidth={2} />
        <circle cx={X(p.cost_cr)} cy={Y(p.people_cut_off)} r={11} fill="transparent" className="rz-hit">
          <title>{`₹${p.cost_cr} cr: ${p.interventions.map(i => labels[i] ?? i).join(' + ') || 'do nothing'}\n${fmt(p.people_cut_off)} people cut off`}</title></circle></g>)}
      {plan && <g><circle cx={X(plan.cost)} cy={Y(plan.cut)} r={6} fill="#FE9135" stroke="#171b1f" strokeWidth={2} />
        <text x={X(plan.cost) + 9} y={Y(plan.cut) - 6} fill="#e8ebee">your plan</text></g>}
    </svg>
  );
}
