/* Live map (port of the legacy Leaflet "arkham-livemap" script to MapLibre GL + deck.gl).
   S.layers drives it: 0 satellite/dark base · 1 buildings (OSM) · 2 road network (+ flood closures) · 3 drainage
   4 hazard extent (flood/heat from backend; other hazards = synthetic geolocated assets) · 5 critical facilities.
   Extras: click-to-query + Tier 2 deep-dive, whole-city Tier 2 job, COG downloads. */
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import mlWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol, PMTiles } from 'pmtiles';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { EV, GR, HZ, P, S, TR, clp, fv, hx, tf } from '../../engine';
import { useStore, useTick } from '../../store';
import { BOUNDS, api, ivq, urls } from '../../api';
import './overview.css';

const HG: Record<string, string[]> = { water: ['wq', 'pl'], epi: ['cs', 'wq'], grid: ['pw'], traffic: ['tr'], rad: ['rd'], crowd: ['cr'], heat: ['pw'] };
const COORDS = (b: number[][]): [[number, number], [number, number], [number, number], [number, number]] =>
  [[b[0][1], b[1][0]], [b[1][1], b[1][0]], [b[1][1], b[0][0]], [b[0][1], b[0][0]]];
const BC = COORDS(BOUNDS);
const rgb = (h: string, a = 255): [number, number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const kk = () => fv() * S.m * tf(S.t);
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/* PMTiles: register the protocol once and probe whether the archive exists. */
/* The default worker URL is resolved relative to the module, which breaks under Vite's dep pre-bundling. */
maplibregl.setWorkerUrl(mlWorker);
let pmProbe: Promise<boolean> | null = null;
function hasPm() {
  if (!pmProbe) {
    const proto = new Protocol(); maplibregl.addProtocol('pmtiles', proto.tile);
    const pm = new PMTiles(urls.pmtiles()); proto.add(pm);
    pmProbe = pm.getHeader().then(() => true).catch(() => false);
  }
  return pmProbe;
}

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
    dark: { type: 'raster', tiles: ['a', 'b', 'c', 'd'].map(s => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`), tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors © CARTO' },
    bld: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
    drainpng: { type: 'image', url: BLANK, coordinates: BC },
    hzA: { type: 'image', url: BLANK, coordinates: BC },
    hzB: { type: 'image', url: BLANK, coordinates: BC },
    city: { type: 'image', url: BLANK, coordinates: BC },
    t2: { type: 'image', url: BLANK, coordinates: BC },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0b0d0f' } },
    { id: 'sat', type: 'raster', source: 'sat' },
    { id: 'dark', type: 'raster', source: 'dark', layout: { visibility: 'none' } },
    { id: 'bld', type: 'raster', source: 'bld', paint: { 'raster-opacity': .45 }, layout: { visibility: 'none' } },
    { id: 'drainpng', type: 'raster', source: 'drainpng', paint: { 'raster-opacity': .85, 'raster-fade-duration': 0 }, layout: { visibility: 'none' } },
    { id: 'hzA', type: 'raster', source: 'hzA', paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 350, delay: 0 }, 'raster-fade-duration': 0 } },
    { id: 'hzB', type: 'raster', source: 'hzB', paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 350, delay: 0 }, 'raster-fade-duration': 0 } },
    { id: 'city', type: 'raster', source: 'city', paint: { 'raster-opacity': .85, 'raster-fade-duration': 0 }, layout: { visibility: 'none' } },
    { id: 't2', type: 'raster', source: 't2', paint: { 'raster-opacity': .85, 'raster-fade-duration': 0 }, layout: { visibility: 'none' } },
  ],
};

type Pop = { html: string; t2?: [number, number] };
interface Data { roadnet: any[] | null; roads: any[]; hot: any[]; bbmp: any[]; fac: any[]; t2box: number[][] | null; }

export default function LiveMap() {
  useTick();
  const bk = useStore(s => s.bk);
  const [on, setOn] = useState(true);
  const live = on && bk.ok;
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const deck = useRef<MapboxOverlay | null>(null);
  const [ready, setReady] = useState(false);
  const [pm, setPm] = useState<boolean | null>(null);
  const D = useRef<Data>({ roadnet: null, roads: [], hot: [], bbmp: [], fac: [], t2box: null });
  const K = useRef<Record<string, any>>({});
  const [sum, setSum] = useState<any>(null);
  const [heat, setHeat] = useState<any>(null);
  const [showBbmp, setShowBbmp] = useState(false);
  const [showT2, setShowT2] = useState(true);
  const [cw, setCw] = useState<any>(null);
  const [, force] = useState(0);
  const popup = useRef<maplibregl.Popup | null>(null);
  const fade = useRef({ act: 'hzB', url: '' });

  /* ---------- init (lazily, the first time the live map is shown) ---------- */
  useEffect(() => {
    if (!live || map.current || !box.current) return;
    const m = new maplibregl.Map({ container: box.current, style: STYLE, center: [77.64, 12.95], zoom: 11, minZoom: 9, maxBounds: [[77.4, 12.75], [77.9, 13.25]], attributionControl: { compact: true } });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const ov = new MapboxOverlay({ interleaved: false, layers: [], getTooltip: ({ object }: any) => object?.tip ? { html: object.tip, style: { background: '#14181c', color: '#e6e9ec', font: '11px var(--mono,monospace)', padding: '4px 7px', borderRadius: '4px' } } : null });
    m.addControl(ov as any); deck.current = ov;
    m.on('load', () => {
      hasPm().then(ok => {
        setPm(ok);
        if (ok) {
          m.addSource('pm', { type: 'vector', url: 'pmtiles://' + urls.pmtiles() });
          m.addLayer({ id: 'drainvec', type: 'line', source: 'pm', 'source-layer': 'drainage', layout: { visibility: 'none' }, paint: { 'line-color': '#28a0ff', 'line-opacity': .85, 'line-width': ['interpolate', ['linear'], ['get', 'order'], 0, .6, 3, 3] } }, 'hzA');
          m.addLayer({ id: 'roadnet', type: 'line', source: 'pm', 'source-layer': 'roads', layout: { visibility: 'none' }, paint: { 'line-color': '#c9d1d9', 'line-opacity': .45, 'line-width': ['match', ['get', 'hw'], 'motorway', 2.2, 'trunk', 2, 'primary', 1.6, 1] } }, 'city');
          const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'lm-tip' });
          m.on('mousemove', 'roadnet', e => { const n = e.features?.[0]?.properties?.name; if (n) tip.setLngLat(e.lngLat).setText(n).addTo(m); else tip.remove(); });
          m.on('mouseleave', 'roadnet', () => tip.remove());
        }
        setReady(true);
      });
    });
    m.on('mousemove', e => window.dispatchEvent(new CustomEvent('arkham:cursor', { detail: `Cursor: ${e.lngLat.lat.toFixed(4)}° N, ${e.lngLat.lng.toFixed(4)}° E` })));
    m.on('click', e => onClick(e));
    return undefined;
  }, [live]);
  useEffect(() => () => { map.current?.remove(); map.current = null; deck.current = null; }, []);
  useEffect(() => { if (live && map.current) setTimeout(() => map.current?.resize(), 50); }, [live]);
  useEffect(() => { const r = () => map.current?.resize(); addEventListener('resize', r); return () => removeEventListener('resize', r); }, []);

  /* ---------- popups ---------- */
  function openPop(ll: maplibregl.LngLatLike, p: Pop | string) {
    const m = map.current!; popup.current?.remove();
    popup.current = new maplibregl.Popup({ maxWidth: '280px', className: 'lm-pop' }).setLngLat(ll).setHTML(typeof p === 'string' ? p : p.html).addTo(m);
    return popup.current;
  }
  function onClick(e: maplibregl.MapMouseEvent) {
    const m = map.current!, ov = deck.current;
    const hit: any = ov?.pickObject({ x: e.point.x, y: e.point.y, radius: 4 });
    if (hit?.object?.pop) { openPop(e.lngLat, hit.object.pop); return; }
    const { lat, lng } = e.lngLat; const pop = openPop(e.lngLat, 'Querying…');
    if (S.hz !== 'flood') {
      const gs = HG[S.hz] || [], near = P.filter((p: any) => gs.includes(p[0])).map((p: any) => [p, Math.hypot(p[2] - lat, (p[3] - lng) * .97)]).sort((a: any, b: any) => a[1] - b[1])[0];
      pop.setHTML(`<b>${lat.toFixed(4)}, ${lng.toFixed(4)}</b><br>${HZ[S.hz].n}` + (near ? `<br>Nearest asset: <b>${near[0][1]}</b> (${(near[1] * 111).toFixed(1)} km)` : '') + `<br><small>Point physics available for Flood</small>`);
      return;
    }
    api.sample(S.v, 100, ivq(S.sel).split(',').filter(Boolean), [{ id: 'q', lat, lon: lng }]).then(j => {
      const p = j.points[0];
      pop.setHTML(`<b>${lat.toFixed(4)}, ${lng.toFixed(4)}</b><br>Modelled peak depth: <b>${p.depth_m} m</b><br>P(depth &gt; 0.3 m): <b>${Math.round(p.probability * 100)}%</b><br><button class="btn" id="t2go" style="margin-top:6px">▶ Run Tier 2 2D solve here</button>`);
      const bt = pop.getElement()?.querySelector('#t2go') as HTMLButtonElement | null;
      if (bt) bt.onclick = ev => { ev.stopPropagation(); runT2(lat, lng, pop); };
    }).catch(() => pop.setHTML('Backend unavailable'));
    void m;
  }
  function runT2(lat: number, lon: number, pop: maplibregl.Popup) {
    pop.setHTML('Running local-inertial solver on 30 m DEM…');
    api.hotspot(lat, lon, Math.round(S.v / 2), 15, 120).then(j => {
      const m = map.current!;
      (m.getSource('t2') as maplibregl.ImageSource).updateImage({ url: j.png, coordinates: COORDS(j.bounds) });
      D.current.t2box = j.bounds; setShowT2(true);
      m.fitBounds([[j.bounds[0][1], j.bounds[0][0]], [j.bounds[1][1], j.bounds[1][0]]], { padding: 30 });
      pop.setHTML(`<b>Tier 2 deep-dive</b> (${j.cell_m} m cells, 2 h)<br>Max depth <b>${j.max_depth_m} m</b><br>Area &gt; 0.3 m: <b>${j.area_gt_0_3m_ha} ha</b><br><small>${j.series.map((s: any) => `${s.minute}′ ${s.max_depth_m.toFixed(2)} m`).join(' · ')}</small>`);
      force(x => x + 1);
    }).catch(() => pop.setHTML('Tier 2 failed'));
  }

  /* ---------- hazard image crossfade (two image sources alternate) ---------- */
  function fadeTo(url: string | null, op: number) {
    const m = map.current!, f = fade.current;
    if (!url) { m.setPaintProperty('hzA', 'raster-opacity', 0); m.setPaintProperty('hzB', 'raster-opacity', 0); f.url = ''; return; }
    if (f.url === url) return; f.url = url;
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => {
      if (fade.current.url !== url || !map.current) return;
      const nx = f.act === 'hzA' ? 'hzB' : 'hzA', old = f.act;
      (m.getSource(nx) as maplibregl.ImageSource).updateImage({ url, coordinates: BC });
      m.once('idle', () => { if (fade.current.url !== url) return; m.setPaintProperty(nx, 'raster-opacity', op); m.setPaintProperty(old, 'raster-opacity', 0); });
      m.triggerRepaint(); f.act = nx;
    };
    im.src = url;
  }

  /* ---------- data fetches (deduped by key like the legacy K map) ---------- */
  function floodLayers() {
    const iv = ivq(S.sel), q = `hour=${S.t}&rain=${S.v}&iv=${iv}`; const k = K.current;
    if (k.flood === q) return; k.flood = q;
    fadeTo(S.layers[4] ? urls.floodPng(q) : null, .8);
    const b = `rain=${S.v}&iv=${iv}`;
    if (b !== k.pre) { k.pre = b; for (let h = 0; h <= 12; h++) new Image().src = urls.floodPng(`hour=${h}&${b}`); }
    api.mapLayers(q).then(gj => {
      if (k.flood !== q) return;
      const d = D.current; d.roads = []; d.hot = []; d.bbmp = [];
      setSum(gj.summary);
      for (const f of gj.features) {
        const p = f.properties, c = f.geometry.coordinates;
        if (p.kind === 'road') d.roads.push({ path: c, closed: p.state === 'closed', tip: `${p.state} · ${p.depth_m} m` });
        else if (p.kind === 'hotspot') d.hot.push({ pos: c, r: 8 + Math.min(10, p.area_km2 * 3), pop: `<b>Hotspot #${p.rank}</b><br>Max depth ${p.max_depth_m} m · ${p.area_km2} km²<br>P(flood) ${Math.round((p.probability || 0) * 100)}%${p.nearest_bbmp ? `<br>Near BBMP: ${p.nearest_bbmp.name} (${p.nearest_bbmp.km} km)` : ''}` });
        else if (p.kind === 'bbmp') d.bbmp.push({ pos: c, hit: p.hit, tip: `${p.name}${p.ward ? ' · ' + p.ward : ''} · ${p.hit ? 'flagged by model' : 'missed'}` });
      }
      force(x => x + 1);
    }).catch(() => { k.flood = null; });
    facilities(q);
  }
  function facilities(q: string) {
    const k = K.current; if (k.fac === q) return; k.fac = q;
    api.facilities(q).then((hs: any[]) => {
      if (k.fac !== q) return; const fl = S.hz === 'flood';
      D.current.fac = hs.map(h => { const bad = fl && !h.functional; return { pos: [h.lon, h.lat], bad, pop: `<b>✚ ${h.name}</b><br>${fl ? (bad ? `Flooded ${h.depth_m} m · not functional` : `Operational (depth ${h.depth_m} m)`) : 'Hospital (OSM)'}` }; });
      force(x => x + 1);
    }).catch(() => { k.fac = null; });
  }
  function heatLayers() {
    const q = `peak=${S.v}`, k = K.current;
    if (k.heat !== q) { k.heat = q; api.heat(S.v).then(setHeat).catch(() => {}); }
    fadeTo(S.layers[4] ? urls.heatPng(S.v) : null, .6);
  }
  function fitAssets() {
    const gs = HG[S.hz] || [], k = K.current;
    const pts: number[][] = P.filter((p: any) => gs.includes(p[0])).map((p: any) => [p[2], p[3]]).concat(S.hz === 'traffic' ? Object.values(TR).flatMap((t: any) => [t[0], t[1]]) : []);
    if (k.fit !== S.hz && pts.length) {
      k.fit = S.hz;
      const la = pts.map(p => p[0]), lo = pts.map(p => p[1]), a = Math.min(...la), b = Math.max(...la), c = Math.min(...lo), d = Math.max(...lo), pa = (b - a) * .25, po = (d - c) * .25;
      map.current!.fitBounds([[c - po, a - pa], [d + po, b + pa]], { maxZoom: 12, duration: 600 });
    }
  }
  function loadRoadnet() {
    if (pm || D.current.roadnet || K.current.rn) return; K.current.rn = 1;
    api.roads().then(gj => {
      D.current.roadnet = gj.features.map((f: any) => ({ path: f.geometry.coordinates, w: ({ motorway: 2.2, trunk: 2, primary: 1.6 } as any)[f.properties.hw] || 1, tip: f.properties.name || undefined }));
      force(x => x + 1);
    }).catch(() => { K.current.rn = 0; });
  }

  /* ---------- main refresh (every engine tick) ---------- */
  useEffect(() => {
    const m = map.current; if (!live || !m || !ready) return;
    const L_ = S.layers, fl = S.hz === 'flood', k = K.current;
    if (k.hz !== S.hz) { if (fl && k.hz) m.flyTo({ center: [77.64, 12.95], zoom: 11 }); k.hz = S.hz; k.flood = k.heat = null; fadeTo(null, 0); }
    const vis = (id: string, v: boolean) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
    vis('sat', !!L_[0]); vis('dark', !L_[0]); vis('bld', !!L_[1]);
    vis('roadnet', !!L_[2]);
    if (pm) vis('drainvec', !!L_[3]);
    else { if (L_[3] && !k.drain) { k.drain = 1; (m.getSource('drainpng') as maplibregl.ImageSource).updateImage({ url: urls.drainagePng(), coordinates: BC }); } vis('drainpng', !!L_[3]); }
    vis('t2', showT2 && !!D.current.t2box); vis('city', !!cw?.png && cw.show);
    if (L_[2]) loadRoadnet();
    if (fl) floodLayers();
    else {
      if (S.hz === 'heat') heatLayers(); else fadeTo(null, 0);
      fitAssets(); facilities('hour=6&rain=0');
    }
    if ((fl || S.hz === 'heat') && L_[4] && fade.current.url === '') { k.flood = k.heat = null; if (fl) floodLayers(); else heatLayers(); }
    if (!L_[4]) fadeTo(null, 0);
    deck.current?.setProps({ layers: deckLayers() });
  });

  function deckLayers() {
    const L_ = S.layers, fl = S.hz === 'flood', d = D.current, out: any[] = [];
    if (L_[2] && !pm && d.roadnet) out.push(new PathLayer({ id: 'roadnet', data: d.roadnet, getPath: (x: any) => x.path, getWidth: (x: any) => x.w, widthUnits: 'pixels', getColor: [201, 209, 217, 115], pickable: true }));
    if (L_[2] && fl) out.push(new PathLayer({ id: 'roads', data: d.roads, getPath: (x: any) => x.path, getWidth: (x: any) => x.closed ? 3.2 : 2.2, widthUnits: 'pixels', getColor: (x: any) => rgb(x.closed ? '#e5533d' : '#FE9135', 242), pickable: true, updateTriggers: { getColor: d.roads } }));
    if (L_[4] && fl) out.push(new ScatterplotLayer({ id: 'hot', data: d.hot, getPosition: (x: any) => x.pos, getRadius: (x: any) => x.r, radiusUnits: 'pixels', stroked: true, filled: true, getFillColor: [251, 194, 70, 26], getLineColor: [251, 194, 70, 255], lineWidthUnits: 'pixels', getLineWidth: 2, pickable: true }));
    if (fl && showBbmp) out.push(new ScatterplotLayer({ id: 'bbmp', data: d.bbmp, getPosition: (x: any) => x.pos, getRadius: 4, radiusUnits: 'pixels', stroked: true, getFillColor: (x: any) => rgb(x.hit ? '#2f9e63' : '#8b949e', 242), getLineColor: [11, 13, 15, 255], lineWidthUnits: 'pixels', getLineWidth: 1, pickable: true }));
    if (L_[4] && !fl) out.push(...assetLayers());
    if (L_[5]) out.push(new ScatterplotLayer({ id: 'fac', data: d.fac, getPosition: (x: any) => x.pos, getRadius: (x: any) => x.bad ? 6 : 2.5, radiusUnits: 'pixels', stroked: true, getFillColor: (x: any) => rgb(x.bad ? '#e5533d' : '#4fae78', 242), getLineColor: (x: any) => x.bad ? [255, 255, 255, 255] : [11, 13, 15, 255], lineWidthUnits: 'pixels', getLineWidth: (x: any) => x.bad ? 1.5 : .8, pickable: true }));
    if (showT2 && d.t2box) { const b = d.t2box; out.push(new PolygonLayer({ id: 't2box', data: [[[b[0][1], b[0][0]], [b[1][1], b[0][0]], [b[1][1], b[1][0]], [b[0][1], b[1][0]]]], getPolygon: (x: any) => x, filled: false, stroked: true, getLineColor: [251, 194, 70, 255], lineWidthUnits: 'pixels', getLineWidth: 1 })); }
    return out;
  }
  function assetLayers() {
    const k = kk(), gs = HG[S.hz] || [], rk = (b: number) => clp(b * (.45 + 1.4 * k)), out: any[] = [], key = S.hz + '|' + S.v + '|' + S.t + '|' + [...S.sel];
    const pts = P.filter((p: any) => gs.includes(p[0])).map((p: any) => { const r = rk(p[4]); return { pos: [p[3], p[2]], r, pop: `<b>${p[1]}</b><br>${GR[p[0]][0]}<br>Stress ${Math.round(r * 100)}% <small style="color:#FBC246">· synthetic</small>` }; });
    if (S.hz === 'traffic') out.push(new PathLayer({ id: 'tr', data: Object.entries(TR).map(([n, [a, b, alt, base]]: any) => { const r = rk(base); return { path: [[a[1], a[0]], [b[1], b[0]]], r, pop: `<b>${n}</b><br>Congestion ${Math.round(r * 100)}% · +${Math.round(r * 55)} min<br>↪ ${alt}<br><small style="color:#FBC246">synthetic</small>` }; }),
      getPath: (x: any) => x.path, getColor: (x: any) => rgb(hx(x.r), 230), getWidth: (x: any) => 3 + 6 * x.r, widthUnits: 'pixels', pickable: true, updateTriggers: { getColor: key, getWidth: key } }));
    if (S.hz === 'rad') { const R = 400 + 2600 * k; out.push(new ScatterplotLayer({ id: 'plume', data: [{ pos: [77.52, 13.03], pop: `<b>Drill plume (synthetic)</b><br>Radius ${(R / 1000).toFixed(1)} km` }], getPosition: (x: any) => x.pos, getRadius: R, radiusUnits: 'meters', stroked: true, getFillColor: [196, 90, 216, 46], getLineColor: [196, 90, 216, 255], lineWidthUnits: 'pixels', getLineWidth: 1.5, pickable: true, updateTriggers: { getRadius: key } })); }
    if (S.hz === 'crowd') {
      const rings: any[] = []; Object.values(EV).forEach((v: any) => Object.keys(v).forEach(n => { const p = P.find((x: any) => x[1] === n); if (p) rings.push({ pos: [p[3], p[2]] }); }));
      out.push(new ScatterplotLayer({ id: 'rings', data: rings, getPosition: (x: any) => x.pos, getRadius: 250 + 900 * k, radiusUnits: 'meters', stroked: true, getFillColor: [255, 122, 122, 20], getLineColor: [255, 122, 122, 255], lineWidthUnits: 'pixels', getLineWidth: 1, updateTriggers: { getRadius: key } }));
    }
    out.push(new ScatterplotLayer({ id: 'assets', data: pts, getPosition: (x: any) => x.pos, getRadius: (x: any) => 6 + 14 * x.r, radiusUnits: 'pixels', stroked: true, getFillColor: (x: any) => rgb(hx(x.r), Math.round((.35 + .5 * x.r) * 255)), getLineColor: [255, 255, 255, 255], lineWidthUnits: 'pixels', getLineWidth: 1, pickable: true, updateTriggers: { getRadius: key, getFillColor: key } }));
    return out;
  }

  /* ---------- whole-city Tier 2 ---------- */
  const cwTimer = useRef<any>(null);
  useEffect(() => () => clearTimeout(cwTimer.current), []);
  function runCity() {
    const rain = Math.round(S.v / 2), t0 = Date.now();
    setCw({ status: 'starting', rain, el: 0 });
    api.citywideRun(rain).then(({ job }) => {
      const poll = () => api.citywide(job).then(j => {
        if (j.status === 'done') {
          setCw({ ...j, rain, job, show: true });
          const m = map.current; if (m) (m.getSource('city') as maplibregl.ImageSource).updateImage({ url: j.png, coordinates: COORDS(j.bounds || BOUNDS) });
        } else if (j.status === 'error' || j.status === 'failed') setCw({ status: 'error', error: j.error || j.status, rain });
        else { setCw({ ...j, rain, job, el: (Date.now() - t0) / 1000 }); cwTimer.current = setTimeout(poll, 1500); }
      }).catch(e => setCw({ status: 'error', error: String(e), rain }));
      poll();
    }).catch(e => setCw({ status: 'error', error: String(e), rain }));
  }

  /* ---------- panels ---------- */
  const bar = <div style={{ height: 4, background: '#2b3138', borderRadius: 2, margin: '5px 0' }}><i style={{ display: 'block', height: '100%', width: `${S.t / 12 * 100}%`, background: `rgb(${HZ[S.hz].col})`, borderRadius: 2 }} /></div>;
  let clock: React.ReactNode = null;
  if (S.hz === 'flood') {
    if (sum) {
      const h = S.t, ph = h < 6 ? 'STORM BUILDING' : h < 7 ? 'PEAK' : 'RECEDING', x = h / 6, rf = Math.round(S.v * (h >= 6 ? 1 : x * x * (3 - 2 * x)));
      clock = <><span style={{ color: '#FBC246' }}>t + {h} h</span> · {ph}{bar}<small style={{ fontWeight: 400, color: '#b7bec7' }}>Rain so far {rf} / {S.v} mm · flooded {sum.flooded_km2_gt_0_3m} km²<br />Roads closed {sum.roads_closed_km} km · max depth {sum.max_depth_m} m<br /><span style={{ color: '#9be0b8' }}>Modelled · physics backend</span></small></>;
    }
  } else {
    const h = HZ[S.hz], hi = heat;
    clock = <><span style={{ color: '#FBC246' }}>t + {S.t} h</span> · {h.n.toUpperCase()}{bar}<small style={{ fontWeight: 400, color: '#b7bec7' }}>{h.c}: <b style={{ color: '#e6e9ec' }}>{S.v}</b> · intensity {Math.round(kk() * 100)}%<br />
      {S.hz === 'heat' && hi ? <>Today's live max {hi.live_max_c ?? 'n/a'} °C · coolest {hi.min_c} °C<br /><span style={{ color: '#9be0b8' }}>{hi.provenance.split(',')[0]}</span></> : <span style={{ color: '#FBC246' }}>Synthetic assets · backend model is flood + heat</span>}</small></>;
  }
  const sw = (c: string, t: string, r?: boolean) => <span key={c + t}><i style={{ display: 'inline-block', width: r ? 8 : 16, height: r ? 8 : 7, borderRadius: r ? '50%' : 2, background: c, margin: '0 4px 0 8px', verticalAlign: 'middle' }} />{t}</span>;
  const legend = <>
    {S.hz === 'flood' ? <>{sw('#78beff', '0.05 m')}{sw('#2360d7', '0.7 m')}{sw('#0a146e', '3 m')}<br />{sw('#e5533d', 'closed')}{sw('#FE9135', 'slowed')}{sw('#FBC246', 'hotspot', true)}</>
      : S.hz === 'heat' ? <>{sw('#ffd25a', 'cooler')}{sw('#fa9632', 'warm')}{sw('#b4141e', 'hottest')}</> : <>{sw('#4fae78', 'low', true)}{sw('#FE9135', 'elevated', true)}{sw('#e5533d', 'high', true)}</>}
    {S.layers[3] ? <><br />{sw('#28a0ff', 'drainage (DEM)')}</> : null}
    {S.layers[5] ? <><br />{sw('#4fae78', 'hospital', true)}{S.hz === 'flood' && sw('#e5533d', 'flooded', true)}</> : null}
  </>;
  const panel: React.CSSProperties = { position: 'absolute', zIndex: 3, background: '#14181cdd', padding: '6px 9px', borderRadius: 6, font: '600 11px var(--mono,monospace)', color: '#e6e9ec', lineHeight: 1.55 };
  const cogQ = `hour=${S.t}&rain=${S.v}&iv=${ivq(S.sel)}`;
  const busy = cw && cw.status !== 'done' && cw.status !== 'error';

  return (
    <>
      <div id="lmap" style={{ display: live ? '' : 'none' }}>
        <div ref={box} style={{ position: 'absolute', inset: 0 }} />
        <div id="lmClock" style={{ ...panel, left: 10, bottom: 44, minWidth: 240, fontSize: 12, display: clock ? '' : 'none' }}>{clock}</div>
        <div id="lmLegend" style={{ ...panel, right: 10, bottom: 28 }}>{legend}</div>
        <div id="lmTools" style={{ ...panel, right: 10, top: 84, maxWidth: 230, fontWeight: 400 }}>
          {S.hz === 'flood' && <label style={{ display: 'block', cursor: 'pointer' }}><input type="checkbox" checked={showBbmp} onChange={e => setShowBbmp(e.target.checked)} /> BBMP flood points (validation)</label>}
          <label style={{ display: 'block', cursor: 'pointer' }}><input type="checkbox" checked={showT2} onChange={e => setShowT2(e.target.checked)} /> Tier 2 deep-dive</label>
          {cw?.status === 'done' && <label style={{ display: 'block', cursor: 'pointer' }}><input type="checkbox" checked={!!cw.show} onChange={e => setCw({ ...cw, show: e.target.checked })} /> Whole-city Tier 2</label>}
          <div style={{ marginTop: 5, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button className="btn" id="cwRun" disabled={!!busy} onClick={runCity}>🌐 Whole-city Tier 2</button>
            {S.hz === 'flood' && <a className="btn" id="cogFlood" href={urls.cogFlood(cogQ)} download style={{ textDecoration: 'none' }}>⬇ Depth COG</a>}
          </div>
          {cw && <div id="cwStat" style={{ marginTop: 5 }}>
            {busy && <>Running 2D solve at {cw.rain} mm/h… {cw.status} · {Math.round(cw.el || 0)} s{cw.progress != null ? ` · ${Math.round(cw.progress * 100)}%` : ''}</>}
            {cw.status === 'error' && <span style={{ color: '#e5533d' }}>Whole-city run failed: {cw.error}</span>}
            {cw.status === 'done' && <>Max depth <b>{cw.max_depth_m} m</b> · area &gt; 0.3 m <b>{cw.area_gt_0_3m_km2} km²</b><br />{cw.seconds} s solve ({cw.elapsed_s} s total) · {cw.engine} · {cw.cell_m} m cells · {cw.rain} mm/h<br />
              <a href={urls.cogCitywide(cw.job)} download style={{ color: '#9bbfe6' }}>⬇ COG</a></>}
          </div>}
        </div>
      </div>
      {bk.ok && <button id="lmToggle" className="btn" onClick={() => setOn(o => !o)}>{live ? '▦ Static view' : '🛰 Live map'}</button>}
    </>
  );
}
