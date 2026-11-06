/* Port of the legacy canvas map: draw(), render(), cursor readout, click popup and the progression thumbnails. */
import { useEffect, useRef, useState } from 'react';
import { FAC, HZ, S, SEEDS, fv, inten, tf } from '../../engine';
import { bump, useTick } from '../../store';

const img = new Image();
img.src = '/bengaluru-satellite.jpg';
const loaded = new Set<() => void>();
img.onload = () => loaded.forEach(f => f());

function cover(w: number, h: number) {
  const r = Math.max(w / img.width, h / img.height), dw = img.width * r, dh = img.height * r;
  return { dw, dh, ox: (w - dw) / 2, oy: (h - dh) / 2 };
}

export function draw(c: CanvasRenderingContext2D, w: number, h: number, f: number, t: number, full: boolean) {
  c.clearRect(0, 0, w, h); c.fillStyle = '#0b0d0f'; c.fillRect(0, 0, w, h);
  if (!img.width || !w || !h) return;
  const o = cover(w, h);
  if (!full || S.layers[0]) { if (img.complete) c.drawImage(img, o.ox, o.oy, o.dw, o.dh); }
  const P = (x: number, y: number) => [o.ox + x * o.dw, o.oy + y * o.dh], hc = HZ[S.hz].col, k = f * S.m * tf(t);
  if (!full || S.layers[4]) {
    if (S.hz === 'flood') {
      for (const [a, b, r] of SEEDS) {
        const [x, y] = P(a, b), R = r * o.dw * (.4 + 1.6 * k), g = c.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0, `rgba(${hc},${.6 * Math.min(1, k * 1.4)})`); g.addColorStop(.7, `rgba(${hc},${.35 * Math.min(1, k * 1.4)})`); g.addColorStop(1, `rgba(${hc},0)`);
        c.fillStyle = g; c.save(); c.translate(x, y); c.scale(1, .5); c.translate(-x, -y); c.beginPath(); c.arc(x, y, R, 0, 7); c.fill(); c.restore();
      }
    } else {
      for (let i = 0; i < 14; i++) {
        const a = (Math.sin(i * 12.9) * .5 + .5) * .9 + .05, b = (Math.cos(i * 7.1) * .5 + .5) * .9 + .05, [x, y] = P(a, b), R = o.dw * .07 * (.5 + k * 1.4), g = c.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0, `rgba(${hc},${.55 * k + .1})`); g.addColorStop(1, `rgba(${hc},0)`); c.fillStyle = g; c.beginPath(); c.arc(x, y, R, 0, 7); c.fill();
      }
    }
  }
  if (full && S.layers[1]) { c.fillStyle = 'rgba(255,255,255,.07)'; for (let i = 0; i < 160; i++) { const [x, y] = P((Math.sin(i * 3.1) * .5 + .5), (Math.cos(i * 5.3) * .5 + .5)); c.fillRect(x, y, 5, 4); } }
  if (full && S.layers[3]) { c.strokeStyle = 'rgba(76,141,214,.8)'; c.setLineDash([4, 3]); c.beginPath(); SEEDS.forEach(([a, b]: number[], i: number) => { const [x, y] = P(a, b); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke(); c.setLineDash([]); }
  if (full && S.layers[2]) {
    c.strokeStyle = 'rgba(229,83,61,.9)'; c.lineWidth = 2; c.setLineDash([6, 4]);
    const n = Math.round(HZ[S.hz].ik[0] * f * S.m / 4);
    for (let i = 0; i < n; i++) { const [x, y] = P((Math.sin(i * 9.7) * .5 + .5) * .9 + .05, (Math.cos(i * 4.3) * .5 + .5) * .9 + .05); c.beginPath(); c.moveTo(x, y); c.lineTo(x + 22, y + (i % 2 ? 9 : -7)); c.stroke(); }
    c.setLineDash([]); c.lineWidth = 1;
  }
  if (full && S.layers[5]) for (const [ty, a, b] of FAC) {
    const [x, y] = P(a, b), hit = inten(a, b, f, t) > .25 && S.hz === 'flood';
    c.fillStyle = hit ? '#e5533d' : '#0f1215'; c.strokeStyle = hit ? '#fff' : '#FBC246'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 9, 0, 7); c.fill(); c.stroke();
    c.fillStyle = hit ? '#fff' : '#FBC246'; c.font = 'bold 11px Inter'; c.textAlign = 'center'; c.fillText(ty === 'H' ? '+' : ty === 'P' ? '◆' : '⚡', x, y + 4);
  }
}

function fit(c: HTMLCanvasElement, w: number, h: number) {
  c.width = w * devicePixelRatio; c.height = h * devicePixelRatio;
  c.getContext('2d')!.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
/** Redraw a canvas to its CSS size on every engine tick / resize / image load. */
function useCanvas(ref: React.RefObject<HTMLCanvasElement | null>, t: number, full: boolean) {
  const tick = useTick();
  const [rs, setRs] = useState(0);
  useEffect(() => {
    const f = () => setRs(x => x + 1);
    loaded.add(f); addEventListener('resize', f);
    const ro = new ResizeObserver(f); if (ref.current) ro.observe(ref.current);
    return () => { loaded.delete(f); removeEventListener('resize', f); ro.disconnect(); };
  }, [ref]);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const r = c.getBoundingClientRect(); if (!r.width) return;
    fit(c, r.width, r.height); draw(c.getContext('2d')!, r.width, r.height, fv(), t, full);
  });
  return tick + rs;
}

export function StaticMap() {
  const ref = useRef<HTMLCanvasElement>(null);
  useCanvas(ref, S.t, true);
  const [pop, setPop] = useState<null | { x: number; y: number; html: string }>(null);
  const tm = useRef<any>(0);
  useEffect(() => () => clearTimeout(tm.current), []);
  const rel = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect(), o = cover(r.width, r.height);
    return { r, x: (e.clientX - r.left - o.ox) / o.dw, y: (e.clientY - r.top - o.oy) / o.dh };
  };
  return (
    <>
      <canvas id="map" ref={ref}
        onMouseMove={e => { const { x, y } = rel(e); window.dispatchEvent(new CustomEvent('arkham:cursor', { detail: `Cursor: ${(12.955 - y * .043).toFixed(4)}° N, ${(77.655 + x * .055).toFixed(4)}° E` })); }}
        onClick={e => {
          const { r, x, y } = rel(e), i = inten(x, y, fv(), S.t);
          const html = S.hz === 'flood'
            ? `Depth <b>${(i * 1.4).toFixed(2)} m</b><br>P(flood) <b>${Math.round(Math.min(1, i * 1.15) * 100)}%</b><br>Status <b style="color:${i > .5 ? 'var(--rd)' : i > .2 ? 'var(--c2)' : 'var(--gr)'}">${i > .5 ? 'Blocked' : i > .2 ? 'Warning' : 'Passable'}</b>`
            : `Index <b>${(i * 100 + fv() * 35).toFixed(0)}</b>/100<br>Status <b style="color:var(--c2)">${fv() > .6 ? 'Elevated' : 'Watch'}</b>`;
          setPop({ x: Math.min(e.clientX - r.left + 10, r.width - 190), y: Math.min(e.clientY - r.top + 10, r.height - 90), html });
          clearTimeout(tm.current); tm.current = setTimeout(() => setPop(null), 4000);
        }} />
      <div className="ov" id="pop" style={pop ? { display: 'block', left: pop.x, top: pop.y } : undefined} dangerouslySetInnerHTML={{ __html: pop?.html || '' }} />
    </>
  );
}

const TS = [0, 3, 6, 12];
function Thumb({ t, i }: { t: number; i: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useCanvas(ref, t, false);
  const on = TS[i] <= S.t && (TS[i + 1] > S.t || i === 3);
  return <div data-t={t} className={on ? 'on' : ''} onClick={() => { S.t = t; bump(); }}><canvas ref={ref} /><span>t + {t} h</span></div>;
}
export function Thumbs() {
  return <div className="th" id="th">{TS.map((t, i) => <Thumb key={t} t={t} i={i} />)}</div>;
}
