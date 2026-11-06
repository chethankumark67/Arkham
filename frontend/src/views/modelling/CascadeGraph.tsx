import { CE, CN, eta, sev } from '../../engine';

/** Port of legacy cascRender(): returns the critical-path label and the SVG. */
export function cascPath(N: any) { return 'Critical path: ' + N.path.join(' → '); }

export default function CascadeGraph({ N }: { N: any }) {
  const X = [8, 160, 312, 464, 616], W = 128, H = 34, pos: Record<string, number[]> = {};
  CN.forEach((c: any) => (pos[c[0]] = [X[c[1]], c[3]]));
  return (
    <svg id="casc" viewBox="0 0 760 196" style={{ flex: 1, width: '100%', minHeight: 0 }}>
      <defs><filter id="nf" x="-20%" y="-30%" width="140%" height="180%"><feDropShadow dx="3" dy="3" stdDeviation="3" floodColor="#05070a" floodOpacity=".9" /></filter></defs>
      {CE.map(([a, b, w]: any, i: number) => {
        const fl = N.V[a] * w, [x1, y1] = pos[a], [x2, y2] = pos[b], m = (x1 + W + x2) / 2;
        return <path key={i} d={`M${x1 + W},${y1 + 17} C${m},${y1 + 17} ${m},${y2 + 17} ${x2},${y2 + 17}`} fill="none" stroke={fl > .12 ? sev(fl) : '#2b3138'}
          strokeWidth={(1 + fl * 3).toFixed(1)} opacity={fl > .12 ? (.3 + fl * .55).toFixed(2) : .5} className={fl > .3 ? 'fl' : undefined} />;
      })}
      {CN.map(([id, c, lb, y]: any) => {
        const v = N.V[id], x = X[c], k = sev(v);
        return <g key={id}>
          <g filter="url(#nf)"><rect x={x} y={y} width={W} height={H} rx="9" fill="#1b2025" stroke={v > .12 ? k : '#262d34'} strokeOpacity=".55" /></g>
          <text className="nl" x={x + 9} y={y + 13}>{lb}</text>
          <text className="nv" x={x + W - 9} y={y + 13} textAnchor="end" fill={k}>{Math.round(v * 100)}%</text>
          <rect x={x + 9} y={y + 18} width={W - 18} height="3" rx="1.5" fill="#0c0f11" />
          <rect x={x + 9} y={y + 18} width={((W - 18) * v).toFixed(1)} height="3" rx="1.5" fill={k} />
          <text x={x + 9} y={y + 30} style={{ fontSize: 8 }}>{v > .15 && N.E[id] > 0 ? 'ETA ' + eta(N.E[id]) : ''}</text>
        </g>;
      })}
      {['TRIGGER', 'PRIMARY', 'SECONDARY', 'CASCADE', 'HUMAN IMPACT'].map((t, i) => <text key={t} x={X[i]} y="192" style={{ fontSize: 8, letterSpacing: '.1em' }}>{t}</text>)}
    </svg>
  );
}
