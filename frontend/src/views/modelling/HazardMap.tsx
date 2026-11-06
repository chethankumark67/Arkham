/* Hazard Modelling map: MapLibre basemap (Esri dark / imagery) + deck.gl overlay. Shows only the current sub tab's
   assets (respecting M.gv), risk-coloured markers with pulsing rings, corridors with alternates, and per-sub context:
   Natural → backend flood depth + drainage rasters · Epidemics → risk heatmap · Artificial → radiation plume + crowd rings. */
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import mlWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { EV, GR, M, P, SUBS, TR, hx } from '../../engine';
import { bump, useStore } from '../../store';
import { BOUNDS, urls } from '../../api';

maplibregl.setWorkerUrl(mlWorker);
type C4 = [number, number, number, number];
const rgb = (h: string, a = 255): C4 => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const BC: [[number, number], [number, number], [number, number], [number, number]] =
  [[BOUNDS[0][1], BOUNDS[1][0]], [BOUNDS[1][1], BOUNDS[1][0]], [BOUNDS[1][1], BOUNDS[0][0]], [BOUNDS[0][1], BOUNDS[0][0]]];
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    dark: { type: 'raster', tiles: [ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 16, attribution: '© Esri' },
    sat: { type: 'raster', tiles: [ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar' },
    drain: { type: 'image', url: BLANK, coordinates: BC },
    flood: { type: 'image', url: BLANK, coordinates: BC },
    heat: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0b0d0f' } },
    { id: 'dark', type: 'raster', source: 'dark' },
    { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' }, paint: { 'raster-brightness-max': .7 } },
    { id: 'drain', type: 'raster', source: 'drain', layout: { visibility: 'none' }, paint: { 'raster-opacity': .25, 'raster-fade-duration': 0 } },
    { id: 'flood', type: 'raster', source: 'flood', layout: { visibility: 'none' }, paint: { 'raster-opacity': .75, 'raster-fade-duration': 0 } },
    { id: 'heat', type: 'heatmap', source: 'heat', layout: { visibility: 'none' }, paint: {
      'heatmap-weight': ['get', 'w'], 'heatmap-intensity': 1.1, 'heatmap-opacity': .7,
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 30, 13, 110],
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', .2, 'rgba(80,190,170,.35)', .45, '#FBC246', .7, '#FE9135', 1, '#e5533d'] } },
  ],
};
const PLUME: [number, number] = [77.52, 13.03];
const ell = (c: [number, number], rx: number, ry: number, rot: number) => Array.from({ length: 41 }, (_, i) => {
  const a = i / 40 * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
  return [c[0] + x * Math.cos(rot) - y * Math.sin(rot), c[1] + (x * Math.sin(rot) + y * Math.cos(rot)) * .97];
});

export default function HazardMap({ tick }: { tick: number }) {
  const bk = useStore(s => s.bk);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const deck = useRef<MapboxOverlay | null>(null);
  const [ready, setReady] = useState(false);
  const [sat, setSat] = useState(false);
  const urlK = useRef<Record<string, string>>({});

  useEffect(() => {
    const m = new maplibregl.Map({ container: box.current!, style: STYLE, center: [77.62, 12.97], zoom: 10.6, minZoom: 9, maxZoom: 16,
      maxBounds: [[77.3, 12.7], [78.0, 13.35]], attributionControl: { compact: true } });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const ov = new MapboxOverlay({ interleaved: false, layers: [], getCursor: ({ isHovering }: any) => isHovering ? 'pointer' : 'grab',
      getTooltip: ({ object }: any) => object?.tip ? { html: object.tip, style: { background: '#14181c', color: '#e6e9ec', font: '11px var(--mono,monospace)', padding: '5px 8px', borderRadius: '4px', border: '1px solid #2b3138' } } : null });
    m.addControl(ov as any); deck.current = ov;
    m.on('load', () => setReady(true));
    m.on('mousemove', e => window.dispatchEvent(new CustomEvent('arkham:cursor', { detail: `Cursor: ${e.lngLat.lat.toFixed(4)}° N, ${e.lngLat.lng.toFixed(4)}° E` })));
    const ro = new ResizeObserver(() => m.resize()); ro.observe(box.current!);
    return () => { ro.disconnect(); m.remove(); map.current = null; deck.current = null; };
  }, []);

  /* basemap + maplibre context layers */
  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    const vis = (id: string, on: boolean) => m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('sat', sat); vis('dark', !sat);
    const nat = M.sub == 0 && bk.ok;
    vis('flood', nat); vis('drain', nat); vis('heat', M.sub == 1);
    const setImg = (id: string, u: string) => { if (urlK.current[id] !== u) { urlK.current[id] = u; (m.getSource(id) as maplibregl.ImageSource).updateImage({ url: u, coordinates: BC }); } };
    if (nat) { setImg('flood', urls.floodPng(`hour=${Math.min(12, 6 + M.d)}&rain=${M.rain}&iv=`)); setImg('drain', urls.drainagePng()); }
    if (M.sub == 1) {
      const feats = (M.pts || []).filter(([p]: any) => p[0] == 'cs' || p[0] == 'wq').map(([p, r]: any) =>
        ({ type: 'Feature', properties: { w: r * (p[0] == 'cs' ? 1 : .7) }, geometry: { type: 'Point', coordinates: [p[3], p[2]] } }));
      (m.getSource('heat') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: feats } as any);
    }
  });

  /* deck layers, re-built at ~12 fps for the pulse animation */
  useEffect(() => {
    if (!ready) return; let raf = 0, last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw); if (t - last < 80 || !deck.current) return; last = t;
      deck.current.setProps({ layers: build(t, map.current!) });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  void tick;
  const leg = SUBS[M.sub].slice(1).filter((g: string) => M.gv[g] !== false);
  return <div style={{ position: 'absolute', inset: 0 }}>
    <div ref={box} id="hmap" style={{ position: 'absolute', inset: 0 }} />
    <div className="hm-legend">
      <div className="hm-grad"><span>Risk</span><i /><small>low → critical</small></div>
      <div className="hm-groups">{leg.map((g: string) => <span key={g}><em style={{ borderColor: GR[g][1], color: GR[g][1] }}>{GR[g][2]}</em>{GR[g][0]}</span>)}</div>
      <div className="hm-ctx">{M.sub == 0 ? (bk.ok ? <><i style={{ background: '#3d8be0' }} />Flood depth (backend) · drainage</> : 'Flood raster needs backend')
        : M.sub == 1 ? <><i style={{ background: 'linear-gradient(90deg,#50beaa,#FBC246,#e5533d)' }} />Disease / water-quality heat</>
        : <><i style={{ background: '#ff7a7a' }} />Crowd rings{M.leak ? ' · radiation plume' : ''}</>}
        {leg.includes('tr') && <><i style={{ background: '#4fae78', height: 2 }} />Alternate route</>}</div>
    </div>
    <button className="btn hm-base" onClick={() => setSat(!sat)}>{sat ? 'Dark map' : 'Imagery'}</button>
  </div>;
}

/* dashed line as short segments (no PathStyleExtension dependency) */
function dash([a, b]: number[][], n = 14) {
  return Array.from({ length: n }, (_, i) => [[a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n], [a[0] + (b[0] - a[0]) * (i + .6) / n, a[1] + (b[1] - a[1]) * (i + .6) / n]]);
}

function build(t: number, m: maplibregl.Map) {
  const pts: any[] = M.pts || [], ph = (t % 1800) / 1800;
  const items = pts.filter(([p]) => p[0] != 'tr').map(([p, r]) => ({ p, r, pos: [p[3], p[2]],
    tip: `<b>${p[1]}</b><br/>${GR[p[0]][0]} · ${Math.round(r * 100)}% risk` }));
  const corr = pts.filter(([p]) => p[0] == 'tr' && TR[p[1]]).map(([p, r]) => {
    const tt = TR[p[1]], a = [tt[0][1], tt[0][0]], b = [tt[1][1], tt[1][0]];
    const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1, o = [-dy / n * .012, dx / n * .012];
    return { p, r, path: [a, b], alt: [[a[0] + o[0], a[1] + o[1]], [b[0] + o[0], b[1] + o[1]]], pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      tip: `<b>${p[1]}</b><br/>Corridor · ${Math.round(r * 100)}% risk${r > .55 ? '<br/>Alt: ' + tt[2] : ''}` };
  });
  const all = [...items, ...corr].sort((x, y) => y.r - x.r);
  /* greedy screen-space collision: selected first, then by risk; max 5 labels */
  const boxes: number[][] = [], lab: any[] = [];
  for (const d of [...all.filter(d => d.p[5] == M.sel), ...all.filter(d => d.p[5] != M.sel)]) {
    if (lab.length >= 5) break;
    const q = m.project(d.pos as [number, number]), w = (d.p[1].length + 5) * 6.6 + 10, bx = [q.x + 10, q.y - 10, q.x + 14 + w, q.y + 10];
    if (boxes.some(b => bx[0] < b[2] && bx[2] > b[0] && bx[1] < b[3] && bx[3] > b[1])) continue;
    boxes.push(bx); lab.push(d);
  }
  const hot = items.filter(d => d.r > .7);
  const pick = ({ object }: any) => { if (object?.p) { M.sel = object.p[5]; bump(); } };
  const layers: any[] = [];
  if (M.sub == 2) {
    const ev = EV[M.ev] || {};
    const crowd = P.filter((p: any) => p[0] == 'cr' && ev[p[1]] != null && M.gv.cr !== false);
    layers.push(new ScatterplotLayer({ id: 'crowd', data: crowd, getPosition: (p: any) => [p[3], p[2]], radiusUnits: 'meters',
      getRadius: (p: any) => 300 + ev[p[1]] * 1400 * (1 + .15 * Math.sin(t / 400)), filled: true, stroked: true,
      getFillColor: [255, 122, 122, 40], getLineColor: [255, 122, 122, 200], lineWidthMinPixels: 1.5, updateTriggers: { getRadius: t } }));
    if (M.leak && M.gv.rd !== false) {
      const k = .6 + .4 * ((t % 9000) / 9000);
      layers.push(new PolygonLayer({ id: 'plume', data: [.5, .75, 1].map(s => ({ s, poly: ell(PLUME, .09 * k * s, .03 * k * s, .55) })),
        getPolygon: (d: any) => d.poly, getFillColor: (d: any) => [196, 90, 216, 90 - d.s * 50], getLineColor: [196, 90, 216, 160], lineWidthMinPixels: 1, updateTriggers: { getPolygon: t } }));
    }
  }
  layers.push(
    new PathLayer({ id: 'alt', data: corr.filter(d => d.r > .55).flatMap(d => dash(d.alt)), getPath: (d: any) => d, getColor: [79, 174, 120, 230], widthUnits: 'pixels', getWidth: 2.5 }),
    new PathLayer({ id: 'corr', data: corr, getPath: (d: any) => d.path, getColor: (d: any) => rgb(hx(d.r)), widthUnits: 'pixels', capRounded: true,
      getWidth: (d: any) => d.p[5] == M.sel ? 9 : 6, pickable: true, onClick: pick, updateTriggers: { getWidth: M.sel, getColor: t } }),
    new ScatterplotLayer({ id: 'pulse', data: hot, getPosition: (d: any) => d.pos, radiusUnits: 'pixels', getRadius: 10 + ph * 22,
      filled: false, stroked: true, getLineColor: (d: any) => rgb(hx(d.r), Math.round(220 * (1 - ph))), lineWidthMinPixels: 2, updateTriggers: { getRadius: t, getLineColor: t } }),
    new ScatterplotLayer({ id: 'halo', data: items, getPosition: (d: any) => d.pos, radiusUnits: 'pixels', getRadius: (d: any) => 8 + d.r * 14,
      getFillColor: (d: any) => rgb(hx(d.r), 70), updateTriggers: { getRadius: t, getFillColor: t } }),
    new ScatterplotLayer({ id: 'mk', data: [...items, ...corr], getPosition: (d: any) => d.pos, radiusUnits: 'pixels', pickable: true, onClick: pick,
      getRadius: (d: any) => d.p[5] == M.sel ? 11 : 8, stroked: true, getFillColor: [15, 18, 21, 240], getLineColor: (d: any) => rgb(hx(d.r)),
      getLineWidth: (d: any) => d.p[5] == M.sel ? 3 : 2, lineWidthUnits: 'pixels', updateTriggers: { getRadius: M.sel, getLineWidth: M.sel, getLineColor: t } }),
    new TextLayer({ id: 'ic', data: [...items, ...corr], getPosition: (d: any) => d.pos, getText: (d: any) => GR[d.p[0]][2], getSize: 11, fontWeight: 700,
      getColor: (d: any) => rgb(GR[d.p[0]][1]), characterSet: 'auto', fontFamily: 'Inter, sans-serif' }),
    new TextLayer({ id: 'lab', data: lab, getPosition: (d: any) => d.pos, getText: (d: any) => `${d.p[1]} ${Math.round(d.r * 100)}%`, getSize: 11.5,
      getPixelOffset: [14, 0], getTextAnchor: 'start', getAlignmentBaseline: 'center', getColor: [232, 235, 238, 255], fontFamily: 'Inter, sans-serif',
      background: true, getBackgroundColor: [15, 18, 21, 210], backgroundPadding: [4, 2], characterSet: 'auto', collisionEnabled: false,
      updateTriggers: { getText: t } }),
  );
  return layers;
}
