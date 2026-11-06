import { M, P, av, clp, risk } from '../../engine';

/** Port of legacy chartM(gs). */
export default function ForecastChart({ gs }: { gs: string[] }) {
  const d: number[] = [];
  for (let k = -7; k <= 7; k++) d.push(av(P.filter((p: any) => gs.includes(p[0])).map((p: any) => risk(p, k)).sort((a: number, b: number) => b - a).slice(0, 5)));
  const X = (i: number) => 10 + i * 19.3, Y = (v: number) => 118 - v * 100, pt = (a: number[], o: number) => a.map((v, i) => X(i + o) + ',' + Y(v)).join(' '), h = d.slice(0, 8), f = d.slice(7);
  const band = `${f.map((v, i) => X(i + 7) + ',' + Y(clp(v + .02 + .012 * i))).join(' ')} ${f.map((_, i) => X(14 - i) + ',' + Y(clp(f[7 - i] - .02 - .012 * (7 - i)))).join(' ')}`;
  return (
    <svg id="mch" viewBox="0 0 300 140" preserveAspectRatio="none" style={{ flex: 1, width: '100%', minHeight: 0 }}>
      <polygon points={band} fill="rgba(254,145,53,.2)" />
      <polyline points={pt(h, 0)} fill="none" stroke="#8b949e" strokeWidth="1.6" />
      <polyline points={pt(f, 7)} fill="none" stroke="#FE9135" strokeWidth="1.8" strokeDasharray="4 3" />
      <line x1={X(7)} x2={X(7)} y1="8" y2="118" stroke="#2b3138" />
      <line x1={X(7 + M.d)} x2={X(7 + M.d)} y1="8" y2="118" stroke="#FBC246" strokeDasharray="2 3" />
      <line x1="10" x2="290" y1="118" y2="118" stroke="#2b3138" />
      <text x="10" y="132">D−7</text><text x={X(7) - 8} y="132">today</text><text x="262" y="132">D+7</text>
      <text x="12" y="14">aggregate risk · grey: older data (hindcast) · orange: forecast ±band</text>
    </svg>
  );
}
