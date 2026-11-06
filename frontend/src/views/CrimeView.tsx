/* Crime Intelligence view: frontend for the Suraksha-Grid India service (suraksha-grid/).
   Fields map 1:1 to its endpoints: risk forecast (daily-slot), risk grid, FIR analysis, vehicle trace,
   hotspots (+ crime-type filter), temporal summary, city hotzones and component status.
   Plus the read-only dashboard endpoints (extensions.py): KPIs, incidents, trends, day×hour matrix, stations, suspect network.
   Data is SYNTHETIC (suraksha-grid/demo_data.py) when the service runs with SURAKSHA_DATASET=synthetic. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import mlWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ColumnLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import {
  ALL_CRIME_TYPES, CRIME_BASE, crimeApi, dashApi, STATUSES, threatColor, toBackendTime, typeColor,
  type CrimeFilters, type CrimeNetwork, type CrimeSummary, type CrimeTrend, type HeatMatrix, type IncidentRow, type NetNode, type StationStat,
  type CityHotzone, type CrimeStatus, type Hotspot, type IncidentAnalysis, type SlotPrediction, type TemporalSummary, type VehicleTrace,
} from '../crimeApi';
import { HeatMatrixChart, KpiStrip, Legend, StationsBar, StatusBreakdown, TrendChart, TypeBreakdown } from './crime/Charts';
import NetworkGraph, { NODE_COLORS } from './crime/NetworkGraph';
import IncidentsTable from './crime/IncidentsTable';
import './crime.css';

maplibregl.setWorkerUrl(mlWorker);

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { sat: { type: 'raster', tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] } },
  layers: [{ id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': -0.35, 'raster-brightness-max': 0.75 } }],
};
const CRIME_TYPES = ALL_CRIME_TYPES;
const CITIES = ['Bengaluru', 'Mysuru', 'Tumakuru', 'Unknown'];
const SAMPLE_FIRS = [
  { label: 'Chain snatching', fir_text: 'Victim gold chain snatched near metro by two suspects riding black motorcycle with helmets.', city: 'Bengaluru', suspect_alias: 'Unknown (Black Helmet)', vehicle_plate: 'UNREGISTERED' },
  { label: 'Vehicle theft', fir_text: 'Two-wheeler stolen from apartment parking at night using a master key to bypass the ignition.', city: 'Bengaluru', suspect_alias: 'Ravi_Kulla_Gang', vehicle_plate: 'KA03AB9876' },
  { label: 'Shop burglary', fir_text: 'Shop shutter forced open with a hydraulic jack at 3 AM; electronics stolen from storefront.', city: 'Tumakuru', suspect_alias: 'Shutter_Jack_Crew', vehicle_plate: 'KA05XY5544' },
  { label: 'Cyber fraud', fir_text: 'Victim lost money in online UPI fraud after sharing OTP with caller posing as bank official.', city: 'Mysuru', suspect_alias: 'Unknown', vehicle_plate: 'UNKNOWN' },
];
const KNOWN_PLATES = ['KA03AB9876', 'KA01HH1234', 'KA05XY5544', 'KA41EP0912', 'KA50Q8820', 'KA02JH9087', 'UNREGISTERED'];
const TABS = [['overview', 'Overview'], ['map', 'Map & hotspots'], ['trends', 'Trends'], ['network', 'Network'], ['investigate', 'Investigate'], ['forecast', 'Forecast']] as const;
type Tab = typeof TABS[number][0];
const MAP_TABS: Tab[] = ['overview', 'map', 'forecast'];
const EMPTY_FILTERS: CrimeFilters = { types: [], from: '', to: '', status: '' };
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hexBin = (rows: IncidentRow[], cell = 0.006) => {
  const m = new Map<string, { lon: number; lat: number; n: number; types: Record<string, number> }>();
  rows.forEach(r => {
    const row = Math.round(r.latitude / (cell * 0.866));
    const col = Math.round((r.longitude - (row % 2 ? cell / 2 : 0)) / cell);
    const k = row + ':' + col;
    const b = m.get(k) || { lat: row * cell * 0.866, lon: col * cell + (row % 2 ? cell / 2 : 0), n: 0, types: {} };
    b.n++; b.types[r.crime_type] = (b.types[r.crime_type] || 0) + 1; m.set(k, b);
  });
  return [...m.values()];
};
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const pad = (n: number) => String(n).padStart(2, '0');
const nowLocal = () => { const d = new Date(); d.setMinutes(0); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`; };
const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const label = (s: string) => s.replace(/_/g, ' ');

function Section({ title, tag, children, className }: { title: string; tag?: string; children: React.ReactNode; className?: string }) {
  return <section className={'card cr-card ' + (className || '')}><div className="t">{title}{tag && <span className="tg M">{tag}</span>}</div><div className="cr-body">{children}</div></section>;
}
function Err({ e }: { e: string | null }) { return e ? <div className="cr-err">⚠ {e}</div> : null; }
function Toggle({ label: l, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="cr-check"><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />{l}</label>;
}
function Bars({ data, keys, color }: { data: Record<string, number>; keys: string[]; color: string }) {
  const mx = Math.max(1, ...keys.map(k => data[k] || 0));
  return (
    <div className="cr-bars">
      {keys.map(k => <div key={k} className="cr-barcol" title={`${k}: ${data[k] || 0}`}>
        <i style={{ height: `${((data[k] || 0) / mx) * 100}%`, background: data[k] ? color : '#22282e' }} />
        <small>{k.length > 3 ? k.slice(0, 3) : (keys.length > 12 && +k % 3 ? '' : k)}</small>
      </div>)}
    </div>
  );
}

export default function CrimeView() {
  // ---------------- service state ----------------
  const [status, setStatus] = useState<CrimeStatus | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const refreshStatus = useCallback(() => {
    crimeApi.status().then(s => { setStatus(s); setOnline(true); }).catch(() => { setOnline(false); setStatus(null); });
  }, []);
  useEffect(() => { refreshStatus(); const i = setInterval(refreshStatus, 15000); return () => clearInterval(i); }, [refreshStatus]);

  // ---------------- analytics ----------------
  const [crimeType, setCrimeType] = useState('');
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [temporal, setTemporal] = useState<TemporalSummary | null>(null);
  const [hotzones, setHotzones] = useState<CityHotzone[]>([]);
  const [anErr, setAnErr] = useState<string | null>(null);
  useEffect(() => {
    if (!online) return;
    crimeApi.hotspots(crimeType || undefined).then(r => { setHotspots(r.data); setAnErr(null); }).catch(e => setAnErr(e.message));
  }, [online, crimeType]);
  useEffect(() => {
    if (!online) return;
    crimeApi.temporal().then(setTemporal).catch(e => setAnErr(e.message));
    crimeApi.hotzones().then(setHotzones).catch(e => setAnErr(e.message));
  }, [online]);

  // ---------------- dashboard (filters apply to map + charts + table) ----------------
  const [tab, setTab] = useState<Tab>('overview');
  const [filters, setFilters] = useState<CrimeFilters>(EMPTY_FILTERS);
  const [summary, setSummary] = useState<CrimeSummary | null>(null);
  const [interval, setIntervalKind] = useState<'week' | 'month'>('month');
  const [trend, setTrend] = useState<CrimeTrend | null>(null);
  const [hm, setHm] = useState<HeatMatrix | null>(null);
  const [stations, setStations] = useState<StationStat[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [net, setNet] = useState<CrimeNetwork | null>(null);
  const [netSel, setNetSel] = useState<NetNode | null>(null);
  const [netFocus, setNetFocus] = useState<string | null>(null);
  const [dashErr, setDashErr] = useState<string | null>(null);
  const [layers, setLayers] = useState({ heat: true, hex3d: false, points: true, stations: true, hotspots: true, zones: true, grid: true });
  const [zoom, setZoom] = useState(10.4);
  useEffect(() => {
    if (!online) return;
    const fail = (e: Error) => setDashErr(e.message);
    dashApi.summary(filters).then(r => { setSummary(r); setDashErr(null); }).catch(fail);
    dashApi.heatmatrix(filters).then(setHm).catch(fail);
    dashApi.stations(filters).then(setStations).catch(fail);
    dashApi.incidents(filters, { limit: 2000 }).then(r => setIncidents(r.data)).catch(fail);
  }, [online, filters]);
  useEffect(() => { if (online) dashApi.trend(filters, interval).then(setTrend).catch(e => setDashErr(e.message)); }, [online, filters, interval]);
  useEffect(() => { if (online && !net) dashApi.network(80).then(setNet).catch(e => setDashErr(e.message)); }, [online, net]);
  const toggleType = (t: string) => setFilters(f => ({ ...f, types: f.types.includes(t) ? f.types.filter(x => x !== t) : [...f.types, t] }));
  const preset = (days: number | null) => setFilters(f => {
    if (days == null) return { ...f, from: '', to: '' };
    const ref = summary?.reference_time ? new Date(summary.reference_time.replace(' ', 'T')) : new Date();
    const from = new Date(ref); from.setDate(from.getDate() - days + 1);
    return { ...f, from: isoDay(from), to: isoDay(ref) };
  });
  const hexes = useMemo(() => hexBin(incidents), [incidents]);

  // ---------------- risk forecast (daily slot) ----------------
  const [slotIn, setSlotIn] = useState({ latitude: '12.9716', longitude: '77.5946', when: nowLocal(), is_festival: false, is_payday: false });
  const [slot, setSlot] = useState<SlotPrediction | null>(null);
  const [slotErr, setSlotErr] = useState<string | null>(null);
  const [slotBusy, setSlotBusy] = useState(false);
  const runSlot = (o = slotIn) => {
    const lat = parseFloat(o.latitude), lon = parseFloat(o.longitude);
    if (!isFinite(lat) || lat < -90 || lat > 90 || !isFinite(lon) || lon < -180 || lon > 180) { setSlotErr('Latitude must be −90…90 and longitude −180…180.'); return; }
    if (!o.when) { setSlotErr('Choose a date and time.'); return; }
    setSlotBusy(true); setSlotErr(null);
    crimeApi.predictSlot({ latitude: lat, longitude: lon, target_datetime: toBackendTime(o.when), is_festival: o.is_festival ? 1 : 0, is_payday: o.is_payday ? 1 : 0 })
      .then(setSlot).catch(e => setSlotErr(e.message)).finally(() => setSlotBusy(false));
  };

  // ---------------- risk grid ----------------
  const [gridIn, setGridIn] = useState({ lat_min: '12.90', lat_max: '13.05', lon_min: '77.55', lon_max: '77.70', when: nowLocal(), is_festival: false, is_payday: false, grid_steps: 8 });
  const [grid, setGrid] = useState<SlotPrediction[]>([]);
  const [gridErr, setGridErr] = useState<string | null>(null);
  const [gridBusy, setGridBusy] = useState(false);
  const runGrid = () => {
    const b = { lat_min: +gridIn.lat_min, lat_max: +gridIn.lat_max, lon_min: +gridIn.lon_min, lon_max: +gridIn.lon_max };
    if (Object.values(b).some(v => !isFinite(v))) { setGridErr('All bounding-box fields must be numbers.'); return; }
    if (b.lat_min >= b.lat_max || b.lon_min >= b.lon_max) { setGridErr('Minimum must be smaller than maximum for both latitude and longitude.'); return; }
    if (!gridIn.when) { setGridErr('Choose a date and time.'); return; }
    setGridBusy(true); setGridErr(null);
    crimeApi.predictGrid({ ...b, target_datetime: toBackendTime(gridIn.when), is_festival: gridIn.is_festival ? 1 : 0, is_payday: gridIn.is_payday ? 1 : 0, grid_steps: gridIn.grid_steps })
      .then(d => { setGrid(d); fitTo([[b.lon_min, b.lat_min], [b.lon_max, b.lat_max]]); })
      .catch(e => setGridErr(e.message)).finally(() => setGridBusy(false));
  };
  const gridStats = useMemo(() => {
    if (!grid.length) return null;
    const s = grid.map(g => g.risk_score);
    const by: Record<string, number> = {};
    grid.forEach(g => (by[g.threat_level] = (by[g.threat_level] || 0) + 1));
    return { min: Math.min(...s), max: Math.max(...s), mean: s.reduce((a, b) => a + b, 0) / s.length, by };
  }, [grid]);

  // ---------------- FIR analysis ----------------
  const [fir, setFir] = useState({ fir_text: SAMPLE_FIRS[0].fir_text, city: 'Bengaluru', suspect_alias: 'Unknown', vehicle_plate: 'UNKNOWN' });
  const [analysis, setAnalysis] = useState<IncidentAnalysis | null>(null);
  const [firErr, setFirErr] = useState<string | null>(null);
  const [firBusy, setFirBusy] = useState(false);
  const runFir = () => {
    if (fir.fir_text.trim().length < 5) { setFirErr('FIR text must be at least 5 characters.'); return; }
    setFirBusy(true); setFirErr(null);
    crimeApi.analyzeIncident({ ...fir, city: fir.city || 'Unknown', suspect_alias: fir.suspect_alias || 'Unknown', vehicle_plate: fir.vehicle_plate || 'UNKNOWN' })
      .then(setAnalysis).catch(e => setFirErr(e.message)).finally(() => setFirBusy(false));
  };

  // ---------------- vehicle trace ----------------
  const [plate, setPlate] = useState('KA03AB9876');
  const [trace, setTrace] = useState<VehicleTrace | null>(null);
  const [traceErr, setTraceErr] = useState<string | null>(null);
  const runTrace = (p = plate) => {
    const v = p.trim().toUpperCase().replace(/\s+/g, '');
    if (!v) { setTraceErr('Enter a registration plate.'); return; }
    setPlate(v); setTraceErr(null);
    setNetFocus(v);
    crimeApi.traceVehicle(v).then(setTrace).catch(e => setTraceErr(e.message));
  };
  const onNetSelect = (n: NetNode | null) => {
    setNetSel(n);
    if (n?.type === 'vehicle' && n.label !== trace?.plate) { setPlate(n.label); setTraceErr(null); crimeApi.traceVehicle(n.label).then(setTrace).catch(e => setTraceErr(e.message)); }
  };

  // ---------------- map ----------------
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const deck = useRef<MapboxOverlay | null>(null);
  const fitTo = (b: [[number, number], [number, number]]) => map.current?.fitBounds(b, { padding: 50, maxZoom: 14, duration: 600 });
  const pickRef = useRef<(lat: number, lon: number) => void>(() => {});
  const tabRef = useRef<Tab>(tab); tabRef.current = tab;
  const [styleReady, setStyleReady] = useState(false);
  useEffect(() => {
    const m = map.current; if (!m || !styleReady) return;
    (m.getSource('inc') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection',
      features: incidents.map(r => ({ type: 'Feature', properties: { t: r.crime_type }, geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] } })) });
    m.setLayoutProperty('inc-heat', 'visibility', layers.heat && !layers.hex3d ? 'visible' : 'none');
  }, [incidents, styleReady, layers.heat, layers.hex3d]);
  useEffect(() => {
    const m = map.current; if (!m) return;
    if (MAP_TABS.includes(tab)) requestAnimationFrame(() => m.resize());
  }, [tab]);
  useEffect(() => { map.current?.easeTo({ pitch: layers.hex3d ? 50 : 0, duration: 500 }); }, [layers.hex3d]);
  const flyToIncident = (r: IncidentRow) => {
    if (!MAP_TABS.includes(tabRef.current)) setTab('map');
    setTimeout(() => { map.current?.resize(); map.current?.flyTo({ center: [r.longitude, r.latitude], zoom: 15, duration: 900 }); setFlash(r); }, 30);
  };
  const [flash, setFlash] = useState<IncidentRow | null>(null);
  pickRef.current = (lat, lon) => {
    const o = { ...slotIn, latitude: lat.toFixed(5), longitude: lon.toFixed(5) };
    setSlotIn(o); runSlot(o);
  };
  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({ container: box.current, style: STYLE, center: [77.62, 12.97], zoom: 10.4, minZoom: 6, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const ov = new MapboxOverlay({ interleaved: false, layers: [],
      getTooltip: ({ object }: any) => object?.tip ? { html: object.tip, style: { background: '#14181c', color: '#e6e9ec', font: '11px var(--mono,monospace)', padding: '5px 8px', borderRadius: '4px' } } : null });
    m.addControl(ov as unknown as maplibregl.IControl);
    m.on('click', (e: maplibregl.MapMouseEvent) => { if (tabRef.current === 'forecast') pickRef.current(e.lngLat.lat, e.lngLat.lng); });
    m.on('zoomend', () => setZoom(m.getZoom()));
    m.on('load', () => {
      m.addSource('inc', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'inc-heat', type: 'heatmap', source: 'inc', maxzoom: 15, paint: {
        'heatmap-weight': 1,
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.35, 11, 0.6, 14, 1.4],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 8, 11, 18, 15, 34],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.85, 15, 0.25],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.1, 'rgba(254,145,53,0.18)', 0.35, 'rgba(254,145,53,0.5)',
          0.65, 'rgba(229,83,61,0.75)', 0.9, 'rgba(255,190,140,0.9)', 1, 'rgba(255,236,200,0.95)'],
      } });
      setStyleReady(true);
    });
    map.current = m; deck.current = ov;
    return () => { m.remove(); map.current = null; deck.current = null; };
  }, []);
  useEffect(() => {
    if (!deck.current) return;
    const steps = Math.round(Math.sqrt(grid.length)) || 1;
    const dLat = grid.length ? (+gridIn.lat_max - +gridIn.lat_min) / Math.max(1, steps - 1) : 0;
    const dLon = grid.length ? (+gridIn.lon_max - +gridIn.lon_min) / Math.max(1, steps - 1) : 0;
    const cells = grid.map(g => ({ ...g, tip: `<b>${g.threat_level}</b> · risk ${g.risk_score}<br>${g.latitude.toFixed(4)}, ${g.longitude.toFixed(4)}`,
      poly: [[g.longitude - dLon / 2, g.latitude - dLat / 2], [g.longitude + dLon / 2, g.latitude - dLat / 2], [g.longitude + dLon / 2, g.latitude + dLat / 2], [g.longitude - dLon / 2, g.latitude + dLat / 2]] }));
    const hs = hotspots.map((h, i) => ({ ...h, i, tip: `<b>Hotspot ${i + 1}</b> · ${h.incident_count} incidents<br>${h.dominant_crime_type}<br>${h.cities_involved.join(', ')}` }));
    const zoneCities: Record<string, [number, number]> = { Bengaluru: [77.5946, 12.9716], Mysuru: [76.6551, 12.3051], Tumakuru: [77.1013, 13.3392] };
    const zs = hotzones.filter(z => zoneCities[z.city]).map(z => ({ ...z, pos: zoneCities[z.city], tip: `<b>${z.city}</b> · ${z.total_incidents} incidents<br>${z.crime_types.join(', ')}` }));
    const showPts = layers.points && zoom >= 11;
    const maxHex = Math.max(1, ...hexes.map(h => h.n));
    const pts = showPts ? incidents.map(r => ({ ...r, tip: `<b>${r.incident_id}</b> · ${r.crime_type}<br>${r.timestamp.slice(0, 16)} · ${r.locality}<br>${r.police_station} · ${r.status}` })) : [];
    const st = stations.map(s => ({ ...s, tip: `<b>${s.station}</b> · ${s.count} incidents<br>top: ${s.top_type}<br>clearance ${s.clearance_rate}%` }));
    deck.current.setProps({ layers: ([
      layers.hex3d && new ColumnLayer({ id: 'hex3d', data: hexes.map(h => ({ ...h, tip: `<b>${h.n} incidents</b><br>${Object.entries(h.types).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t} ${n}`).join('<br>')}` })),
        diskResolution: 6, radius: 300, extruded: true, elevationScale: 1, getPosition: (d: any) => [d.lon, d.lat], getElevation: (d: any) => d.n * 160, pickable: true,
        getFillColor: (d: any) => { const t = d.n / maxHex; return [254, Math.round(200 - 140 * t), Math.round(120 - 80 * t), 210]; } }),
      layers.grid && new PolygonLayer({ id: 'grid', data: cells, getPolygon: (d: any) => d.poly, pickable: true, stroked: true,
        getFillColor: (d: any) => [...hex(threatColor(d.threat_level)), 40 + Math.round(d.risk_score * 1.5)] as any, getLineColor: [255, 255, 255, 40], lineWidthMinPixels: 0.5 }),
      layers.zones && zoom < 9.5 && new ScatterplotLayer({ id: 'zones', data: zs, getPosition: (d: any) => d.pos, pickable: true, radiusUnits: 'meters',
        getRadius: (d: any) => 1200 + d.total_incidents * 500, getFillColor: [254, 145, 53, 45], getLineColor: [254, 145, 53, 220], stroked: true, lineWidthMinPixels: 1.5 }),
      layers.zones && zoom < 9.5 && new TextLayer({ id: 'zone-labels', data: zs, getPosition: (d: any) => d.pos, getText: (d: any) => `${d.city} · ${d.total_incidents}`,
        getSize: 12, getColor: [255, 226, 190], getPixelOffset: [0, -18], fontFamily: 'Inter, sans-serif', fontWeight: 600, outlineWidth: 2, outlineColor: [11, 13, 15] , fontSettings: { sdf: true } }),
      layers.hotspots && new ScatterplotLayer({ id: 'hotspots', data: hs, getPosition: (d: any) => [d.centroid_lon, d.centroid_lat], pickable: true,
        radiusUnits: 'meters', radiusMinPixels: 6, getRadius: (d: any) => 250 + Math.sqrt(d.incident_count) * 60, getFillColor: [229, 83, 61, 70], getLineColor: [255, 120, 100, 230], stroked: true, lineWidthMinPixels: 2 }),
      showPts && new ScatterplotLayer({ id: 'incidents', data: pts, getPosition: (d: any) => [d.longitude, d.latitude], pickable: true, radiusUnits: 'pixels', getRadius: 4.5,
        getFillColor: (d: any) => [...hex(typeColor(d.crime_type)), 235] as any, getLineColor: [11, 13, 15], stroked: true, lineWidthMinPixels: 1, updateTriggers: { getFillColor: incidents } }),
      layers.stations && new ScatterplotLayer({ id: 'stations', data: st, getPosition: (d: any) => [d.lon, d.lat], pickable: true, radiusUnits: 'pixels',
        getRadius: (d: any) => 4 + Math.sqrt(d.count) * 0.9, getFillColor: [57, 135, 229, 60], getLineColor: [140, 190, 255, 255], stroked: true, lineWidthMinPixels: 2 }),
      layers.stations && zoom >= 10.5 && new TextLayer({ id: 'station-labels', data: st, getPosition: (d: any) => [d.lon, d.lat], getText: (d: any) => `${d.station} · ${d.count}`,
        getSize: 11, getColor: [200, 222, 255], getPixelOffset: [0, -16], fontFamily: 'Inter, sans-serif', fontWeight: 600, outlineWidth: 2, outlineColor: [11, 13, 15], fontSettings: { sdf: true } }),
      flash && new ScatterplotLayer({ id: 'flash', data: [flash], getPosition: (d: any) => [d.longitude, d.latitude], radiusUnits: 'pixels', getRadius: 14,
        filled: false, stroked: true, getLineColor: [255, 255, 255], lineWidthMinPixels: 2.5 }),
      new ScatterplotLayer({ id: 'pin', data: slot ? [slot] : [{ latitude: +slotIn.latitude, longitude: +slotIn.longitude }], getPosition: (d: any) => [d.longitude, d.latitude],
        radiusUnits: 'pixels', getRadius: 7, getFillColor: (d: any) => (d.threat_level ? [...hex(threatColor(d.threat_level)), 255] : [251, 194, 70, 255]) as any,
        getLineColor: [11, 13, 15], stroked: true, lineWidthMinPixels: 2 }),
    ] as any[]).filter(Boolean) });
  }, [grid, hotspots, hotzones, slot, slotIn.latitude, slotIn.longitude, gridIn.lat_min, gridIn.lat_max, gridIn.lon_min, gridIn.lon_max, layers, zoom, incidents, hexes, stations, flash]);

  const useMapView = () => {
    const b = map.current?.getBounds(); if (!b) return;
    setGridIn(g => ({ ...g, lat_min: b.getSouth().toFixed(4), lat_max: b.getNorth().toFixed(4), lon_min: b.getWest().toFixed(4), lon_max: b.getEast().toFixed(4) }));
  };

  // ---------------- render ----------------
  const comp = status ? [
    ['PostgreSQL', status.postgresql.status, status.postgresql.incident_count != null ? `${status.postgresql.incident_count} incidents` : status.postgresql.detail || ''],
    ['Neo4j graph', status.neo4j.status, ''],
    ['spaCy NLP', status.spacy_nlp.status, ''],
    ['ML predictor', status.ml_predictor.status, status.ml_predictor.cv_accuracy != null ? `CV ${(status.ml_predictor.cv_accuracy * 100).toFixed(1)}%` : ''],
  ] : [];
  const good = (s: string) => ['connected', 'loaded', 'trained'].includes(s);

  const legendTypes = (filters.types.length ? filters.types : CRIME_TYPES).map(t => ({ name: t, color: typeColor(t) }));
  const toggles: [keyof typeof layers, string][] = [['heat', 'Density heatmap'], ['hex3d', '3D hex columns'], ['points', 'Incident points (zoom ≥ 11)'], ['stations', 'Police stations'], ['hotspots', 'Hotspot clusters'], ['zones', 'City hotzones'], ['grid', 'Risk grid overlay']];
  const filterActive = filters.types.length || filters.from || filters.to || filters.status;

  return (
    <main id="crime" data-tab={tab}>
      <div className="card kp cr-head">
        <div className="ttl"><small>CRIME INTELLIGENCE · SURAKSHA-GRID</small><div>Predictive crime intelligence</div></div>
        <div className="cr-status">
          {online === false && <span className="cr-off">○ Suraksha-Grid API offline at {CRIME_BASE}. Start it with: cd suraksha-grid && uvicorn main:app --port 8100</span>}
          {comp.map(([n, s, x]) => <span key={n} className={'cr-pill ' + (good(s) ? 'ok' : 'warn')} title={x}>{good(s) ? '●' : '○'} {n}<small>{s}{x ? ' · ' + x : ''}</small></span>)}
          <button className="btn" onClick={refreshStatus}>↻</button>
        </div>
        <div className="cr-note"><span className="cr-synbadge">SYNTHETIC DEMO DATA</span> {summary ? `${summary.total_incidents.toLocaleString()} generated incidents` : 'Generated incidents'} across Bengaluru, Mysuru and Tumakuru. These are not real FIRs. Scores are illustrative and are not policing advice.</div>
      </div>

      <KpiStrip s={summary} dataset={summary?.dataset} />

      <div className="card cr-filters">
        <div className="cr-ftypes">
          <small>Crime type</small>
          {CRIME_TYPES.map(t => <button key={t} className={'cr-tchip' + (filters.types.includes(t) ? ' on' : '')} onClick={() => toggleType(t)}
            style={{ ['--c' as any]: typeColor(t) }}><i />{t}</button>)}
        </div>
        <div className="cr-frow">
          <label>From<input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} /></label>
          <label>To<input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} /></label>
          <div className="cr-presets">{([[30, '30d'], [90, '90d'], [180, '6m'], [null, 'All']] as const).map(([d, l]) => <button key={l} className="btn cr-mini" onClick={() => preset(d)}>{l}</button>)}</div>
          <label>Status<select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="">All statuses</option>{STATUSES.map(x => <option key={x}>{x}</option>)}</select></label>
          <button className="btn cr-mini" disabled={!filterActive} onClick={() => setFilters(EMPTY_FILTERS)}>Reset filters</button>
          <small className="muted">{summary ? `${summary.total_incidents.toLocaleString()} incidents in view` : ''}</small>
        </div>
        {dashErr && <Err e={dashErr} />}
      </div>

      <nav className="cr-tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </nav>

      <div className="card mapc cr-map">
        <div ref={box} style={{ position: 'absolute', inset: 0 }} />
        <div className="ov cr-legend" style={{ left: 10, bottom: 10 }}>
          {grid.length > 0 && ['Critical', 'High', 'Moderate', 'Normal'].map(t => <span key={t}><i style={{ background: threatColor(t) }} />{t}</span>)}
          <span><i style={{ background: '#e5533d', borderRadius: '50%', opacity: .7 }} />hotspot</span><span><i style={{ background: '#3987e5', borderRadius: '50%' }} />station</span>
          <span><i style={{ background: 'linear-gradient(90deg,#FE913540,#e5533d,#ffecc8)' }} />density</span>
          {zoom >= 11 && layers.points && legendTypes.map(t => <span key={t.name}><i style={{ background: t.color, borderRadius: '50%' }} />{t.name}</span>)}
          <br /><small>{tab === 'forecast' ? 'Click the map to forecast risk at that point' : zoom < 11 ? 'Zoom in for individual incidents' : 'Hover points for details'}</small>
        </div>
        <div className="ov cr-maptools" style={{ right: 10, top: 80 }}>
          <button className={'btn cr-mini' + (layers.hex3d ? ' on' : '')} onClick={() => setLayers(l => ({ ...l, hex3d: !l.hex3d }))}>{layers.hex3d ? '2D' : '3D'}</button>
          <button className="btn cr-mini" onClick={() => map.current?.flyTo({ center: [77.6, 12.97], zoom: 11, pitch: layers.hex3d ? 50 : 0 })}>BLR</button>
          <button className="btn cr-mini" onClick={() => map.current?.flyTo({ center: [77.3, 12.85], zoom: 8.2 })}>All</button>
        </div>
      </div>

      {tab === 'overview' && <>
        <div className="cr-side">
          <Section title="Crime-type mix" tag="FILTERED"><TypeBreakdown data={summary?.by_type || []} onPick={t => setFilters(f => ({ ...f, types: [t] }))} /></Section>
          <Section title="Case status" tag="CLEARANCE"><StatusBreakdown data={summary?.by_status || []} clearance={summary?.clearance_rate ?? 0} /></Section>
        </div>
        <div className="cr-bottom cr-b2">
          <Section title="Incident trend by type" tag={interval === 'month' ? 'MONTHLY' : 'WEEKLY'}><TrendChart trend={trend} interval={interval} onInterval={setIntervalKind} /></Section>
          <Section title="When incidents happen · day × hour" tag="HEAT MATRIX"><HeatMatrixChart hm={hm} /></Section>
        </div>
      </>}

      {tab === 'map' && <>
        <div className="cr-side">
          <Section title="Map layers" tag="LAYERS">
            {toggles.map(([k, l]) => <Toggle key={k} label={l} value={layers[k]} onChange={v => setLayers(x => ({ ...x, [k]: v }))} />)}
            <Legend items={legendTypes} />
          </Section>
        <Section title="Spatial hotspots" tag="CLUSTERS">
          <small className="muted">Density clusters (DBSCAN, 500 m). Click a row to fly there.</small>
          <label>Crime type<select value={crimeType} onChange={e => setCrimeType(e.target.value)}><option value="">All types</option>{CRIME_TYPES.map(c => <option key={c}>{c}</option>)}</select></label>
          <Err e={anErr} />
          <table className="cr-table"><thead><tr><th>#</th><th>Dominant type</th><th className="num">Incidents</th><th>Cities</th></tr></thead><tbody>
            {hotspots.map((h, i) => <tr key={i} onClick={() => map.current?.flyTo({ center: [h.centroid_lon, h.centroid_lat], zoom: 14 })} style={{ cursor: 'pointer' }}>
              <td>{i + 1}</td><td>{h.dominant_crime_type}</td><td className="num">{h.incident_count}</td><td>{h.cities_involved.join(', ')}</td></tr>)}
            {!hotspots.length && <tr><td colSpan={4} className="muted">No hotspots{crimeType ? ` dominated by ${crimeType}` : ''}</td></tr>}
          </tbody></table>
          <div className="cr-sub">City hotzones (graph)</div>
          <table className="cr-table"><tbody>
            {hotzones.map(z => <tr key={z.city}><td><b>{z.city}</b></td><td className="num">{z.total_incidents}</td><td>{z.crime_types.join(', ')}</td></tr>)}
            {!hotzones.length && <tr><td className="muted">No graph data</td></tr>}
          </tbody></table>
        </Section>

        </div>
        <div className="cr-bottom cr-b2">
          <Section title="Incidents" tag="CLICK TO FLY" className="cr-wide2"><IncidentsTable filters={filters} online={online} onPick={flyToIncident} /></Section>
          <Section title="Police stations" tag="TOP BY VOLUME">
            <table className="cr-table"><thead><tr><th>Station</th><th className="num">Incidents</th><th>Top type</th><th className="num">Cleared</th></tr></thead><tbody>
              {stations.slice(0, 14).map(s => <tr key={s.station} style={{ cursor: 'pointer' }} onClick={() => map.current?.flyTo({ center: [s.lon, s.lat], zoom: 13.5 })}>
                <td>{s.station}<small className="muted"> · {s.city}</small></td><td className="num">{s.count}</td><td><i className="sw" style={{ background: typeColor(s.top_type) }} />{s.top_type}</td><td className="num">{s.clearance_rate}%</td></tr>)}
            </tbody></table>
          </Section>
        </div>
      </>}

      {tab === 'trends' && <div className="cr-full cr-trends">
        <Section title="Incident trend by type" tag={interval === 'month' ? 'MONTHLY' : 'WEEKLY'} className="cr-span2"><TrendChart trend={trend} interval={interval} onInterval={setIntervalKind} /></Section>
        <Section title="Crime-type breakdown" tag="CLICK TO FILTER"><TypeBreakdown data={summary?.by_type || []} onPick={t => setFilters(f => ({ ...f, types: [t] }))} /></Section>
        <Section title="Day × hour heat matrix" tag="TEMPORAL"><HeatMatrixChart hm={hm} /></Section>
        <Section title="Top 10 police stations" tag="VOLUME"><StationsBar data={summary?.by_station || []} /></Section>
        <Section title="Status & clearance" tag="CASES"><StatusBreakdown data={summary?.by_status || []} clearance={summary?.clearance_rate ?? 0} /></Section>
        <Section title="When incidents happen · all data (temporal-summary)" tag="TEMPORAL" className="cr-span2">
          {temporal ? <>
            <div className="cr-sub">By hour of day</div>
            <Bars data={temporal.by_hour} keys={Array.from({ length: 24 }, (_, i) => String(i))} color="#e5533d" />
            <div className="cr-sub">By day of week</div>
            <Bars data={temporal.by_day} keys={DAYS} color="#FE9135" />
          </> : <small className="muted">{online === false ? 'Service offline' : 'Loading…'}</small>}
        </Section>
      </div>}

      {tab === 'network' && <div className="cr-full cr-netgrid">
        <Section title="Suspect · vehicle · city network" tag={net ? `${net.nodes.length} NODES · ${net.edges.length} EDGES` : 'GRAPH'}>
          <NetworkGraph net={net} focus={netFocus} onSelect={onNetSelect} />
        </Section>
        <div className="cr-sidecol">
          <Section title="Selection" tag="NODE">
            {netSel ? <div className="cr-analysis">
              <div className="cr-kv"><span>Type</span><b><i className="sw" style={{ background: NODE_COLORS[netSel.type] }} />{netSel.type}</b></div>
              <div className="cr-kv"><span>Label</span><b>{label(netSel.label)}</b></div>
              {netSel.gang && <div className="cr-kv"><span>Gang</span><b>{netSel.gang}</b></div>}
              {netSel.crime_type && <div className="cr-kv"><span>Crime type</span><b>{netSel.crime_type}</b></div>}
              {netSel.timestamp && <div className="cr-kv"><span>When</span><b>{netSel.timestamp}</b></div>}
              <div className="cr-kv"><span>Linked records</span><b>{netSel.count}</b></div>
              <div className="cr-sub">Neighbours</div>
              <div className="cr-chips">{net?.edges.filter(e => e.source === netSel.id || e.target === netSel.id).slice(0, 40).map(e => {
                const o = net.nodes.find(n => n.id === (e.source === netSel.id ? e.target : e.source));
                return o ? <span key={o.id + e.type}><small>{e.type}</small> {label(o.label)}</span> : null;
              })}</div>
            </div> : <small className="muted">Click a node to highlight its neighbours. Click a vehicle to trace it. Shared vehicles (blue squares) link gangs across cities.</small>}
          </Section>
        <Section title="Vehicle trace · multi-hop" tag="GRAPH">
          <div className="cr-row">
            <input className="cr-plate" value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && runTrace()} placeholder="KA03AB9876" />
            <button className="run" disabled={!online} onClick={() => runTrace()}>Trace</button>
          </div>
          <div className="cr-chips">{KNOWN_PLATES.map(p => <button key={p} className="btn cr-mini" onClick={() => runTrace(p)}>{p}</button>)}</div>
          <Err e={traceErr} />
          {trace && <div className="cr-analysis">
            <div className="cr-kv"><span>Plate</span><b>{trace.plate}</b></div>
            <div className="cr-kv"><span>Linked suspects</span><b>{trace.linked_suspects.join(', ') || '—'}</b></div>
            <div className="cr-kv"><span>Incident cities</span><b>{trace.incident_cities.join(', ') || '—'}</b></div>
            <div className="cr-kv"><span>Crime types</span><b>{trace.crime_types.join(', ') || '—'}</b></div>
            {!trace.linked_suspects.length && <small className="muted">No graph links for this plate.</small>}
          </div>}
        </Section>

        </div>
      </div>}

      {tab === 'investigate' && <div className="cr-full cr-invgrid">
        <Section title="FIR analysis · MO extraction + suspect network" tag="NLP + GRAPH" className="cr-span2">
          <div className="cr-chips">{SAMPLE_FIRS.map(s => <button key={s.label} className="btn cr-mini" onClick={() => setFir({ fir_text: s.fir_text, city: s.city, suspect_alias: s.suspect_alias, vehicle_plate: s.vehicle_plate })}>{s.label}</button>)}</div>
          <label>FIR narrative<textarea rows={3} value={fir.fir_text} onChange={e => setFir({ ...fir, fir_text: e.target.value })} placeholder="Describe the incident as written in the FIR…" /></label>
          <div className="cr-grid3">
            <label>City<input list="cr-cities" value={fir.city} onChange={e => setFir({ ...fir, city: e.target.value })} /></label>
            <label>Suspect alias<input value={fir.suspect_alias} onChange={e => setFir({ ...fir, suspect_alias: e.target.value })} /></label>
            <label>Vehicle plate<input value={fir.vehicle_plate} onChange={e => setFir({ ...fir, vehicle_plate: e.target.value.toUpperCase() })} /></label>
          </div>
          <datalist id="cr-cities">{CITIES.map(c => <option key={c} value={c} />)}</datalist>
          <button className="run" disabled={firBusy || !online} onClick={runFir}>{firBusy ? 'Analysing…' : '🔎 Analyse incident'}</button>
          <Err e={firErr} />
          {analysis && <div className="cr-analysis">
            <div className={'cr-alert ' + analysis.cross_jurisdiction_alert.level.toLowerCase()}><b>{analysis.cross_jurisdiction_alert.level}</b> {analysis.cross_jurisdiction_alert.message}</div>
            <div className="cr-kv"><span>MO signature</span><b>{label(analysis.extracted_mo_signature)}</b></div>
            <div className="cr-kv"><span>Night-time crime</span><b>{analysis.nlp_analysis.is_night_crime ? 'Yes' : 'No'}</b></div>
            <div className="cr-kv"><span>Weapon mentioned</span><b>{analysis.nlp_analysis.weapon_mentioned ? 'Yes' : 'No'}</b></div>
            <div className="cr-sub">Keywords</div>
            <div className="cr-chips">{analysis.nlp_analysis.extracted_keywords.map(k => <span key={k}>{label(k)}</span>)}{!analysis.nlp_analysis.extracted_keywords.length && <small className="muted">none</small>}</div>
            <div className="cr-sub">Named entities</div>
            <div className="cr-chips">{Object.entries(analysis.nlp_analysis.named_entities).flatMap(([t, vs]) => vs.map(v => <span key={t + v}><small>{t}</small> {v}</span>))}{!Object.keys(analysis.nlp_analysis.named_entities).length && <small className="muted">none</small>}</div>
            <div className="cr-sub">Suspect leads</div>
            <table className="cr-table"><thead><tr><th>Primary suspect</th><th>Network</th><th>Active cities</th><th>Crime types</th></tr></thead><tbody>
              {analysis.suspect_leads.map((l, i) => <tr key={i}><td>{l.primary_suspect}</td><td>{(l.criminal_network || []).join(', ') || '—'}</td><td>{(l.active_cities || []).join(', ')}</td><td>{((l.crime_types as string[]) || []).join(', ')}</td></tr>)}
              {!analysis.suspect_leads.length && <tr><td colSpan={4} className="muted">No matching suspect network</td></tr>}
            </tbody></table>
          </div>}
        </Section>

        <Section title="Vehicle trace · multi-hop" tag="GRAPH">
          <div className="cr-row">
            <input className="cr-plate" value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && runTrace()} placeholder="KA03AB9876" />
            <button className="run" disabled={!online} onClick={() => runTrace()}>Trace</button>
          </div>
          <div className="cr-chips">{KNOWN_PLATES.map(p => <button key={p} className="btn cr-mini" onClick={() => runTrace(p)}>{p}</button>)}</div>
          <Err e={traceErr} />
          {trace && <div className="cr-analysis">
            <div className="cr-kv"><span>Plate</span><b>{trace.plate}</b></div>
            <div className="cr-kv"><span>Linked suspects</span><b>{trace.linked_suspects.join(', ') || '—'}</b></div>
            <div className="cr-kv"><span>Incident cities</span><b>{trace.incident_cities.join(', ') || '—'}</b></div>
            <div className="cr-kv"><span>Crime types</span><b>{trace.crime_types.join(', ') || '—'}</b></div>
            {!trace.linked_suspects.length && <small className="muted">No graph links for this plate.</small>}
          </div>}
        </Section>

        <Section title="Incident search" tag="CLICK TO FLY" className="cr-span2"><IncidentsTable filters={filters} online={online} onPick={flyToIncident} pageSize={10} /></Section>
      </div>}

      {tab === 'forecast' && <div className="cr-side">
        <Section title="Risk forecast · single point" tag="ML">
          <div className="cr-grid2">
            <label>Latitude<input type="number" step="0.0001" min={-90} max={90} value={slotIn.latitude} onChange={e => setSlotIn({ ...slotIn, latitude: e.target.value })} /></label>
            <label>Longitude<input type="number" step="0.0001" min={-180} max={180} value={slotIn.longitude} onChange={e => setSlotIn({ ...slotIn, longitude: e.target.value })} /></label>
          </div>
          <label>Date & time<input type="datetime-local" value={slotIn.when} onChange={e => setSlotIn({ ...slotIn, when: e.target.value })} /></label>
          <div className="cr-row"><Toggle label="Festival day" value={slotIn.is_festival} onChange={v => setSlotIn({ ...slotIn, is_festival: v })} />
            <Toggle label="Payday" value={slotIn.is_payday} onChange={v => setSlotIn({ ...slotIn, is_payday: v })} /></div>
          <button className="run" disabled={slotBusy || !online} onClick={() => runSlot()}>{slotBusy ? 'Predicting…' : '▶ Predict risk'}</button>
          <Err e={slotErr} />
          {slot && <div className="cr-result">
            <div className="cr-score" style={{ borderColor: threatColor(slot.threat_level) }}>
              <b style={{ color: threatColor(slot.threat_level) }}>{slot.risk_score.toFixed(1)}</b><span>/ 100</span>
              <em style={{ background: threatColor(slot.threat_level) }}>{slot.threat_level}</em>
            </div>
            <div className="cr-kv"><span>Method</span><b>{label(slot.prediction_method)}</b></div>
            {slot.model_cv_accuracy && <div className="cr-kv"><span>Model CV accuracy</span><b>{slot.model_cv_accuracy}</b></div>}
            <div className="cr-kv"><span>Target time</span><b>{slot.target_time}</b></div>
            {slot.top_risk_drivers && <div className="cr-drivers"><small>Top risk drivers (feature importance)</small>
              {Object.entries(slot.top_risk_drivers).map(([k, v]) => <div key={k}><span>{label(k)}</span><div className="cr-bar"><i style={{ width: `${Math.min(100, v * 200)}%` }} /></div><b>{v.toFixed(3)}</b></div>)}</div>}
          </div>}
        </Section>

        <Section title="Risk heatmap · grid" tag="ML">
          <div className="cr-grid2">
            <label>Lat min<input type="number" step="0.01" value={gridIn.lat_min} onChange={e => setGridIn({ ...gridIn, lat_min: e.target.value })} /></label>
            <label>Lat max<input type="number" step="0.01" value={gridIn.lat_max} onChange={e => setGridIn({ ...gridIn, lat_max: e.target.value })} /></label>
            <label>Lon min<input type="number" step="0.01" value={gridIn.lon_min} onChange={e => setGridIn({ ...gridIn, lon_min: e.target.value })} /></label>
            <label>Lon max<input type="number" step="0.01" value={gridIn.lon_max} onChange={e => setGridIn({ ...gridIn, lon_max: e.target.value })} /></label>
          </div>
          <button className="btn cr-mini" onClick={useMapView}>⌖ Use current map view</button>
          <label>Date & time<input type="datetime-local" value={gridIn.when} onChange={e => setGridIn({ ...gridIn, when: e.target.value })} /></label>
          <label>Grid steps <b>{gridIn.grid_steps} × {gridIn.grid_steps} = {gridIn.grid_steps ** 2} cells</b>
            <input type="range" min={2} max={20} value={gridIn.grid_steps} onChange={e => setGridIn({ ...gridIn, grid_steps: +e.target.value })} /></label>
          <div className="cr-row"><Toggle label="Festival day" value={gridIn.is_festival} onChange={v => setGridIn({ ...gridIn, is_festival: v })} />
            <Toggle label="Payday" value={gridIn.is_payday} onChange={v => setGridIn({ ...gridIn, is_payday: v })} /></div>
          <div className="cr-row">
            <button className="run" disabled={gridBusy || !online} onClick={runGrid}>{gridBusy ? 'Computing…' : '▦ Generate heatmap'}</button>
            {grid.length > 0 && <button className="btn cr-mini" onClick={() => setGrid([])}>Clear</button>}
          </div>
          <Err e={gridErr} />
          {gridStats && <div className="cr-kvs">
            <div className="cr-kv"><span>Cells</span><b>{grid.length}</b></div>
            <div className="cr-kv"><span>Risk min / mean / max</span><b>{gridStats.min.toFixed(1)} / {gridStats.mean.toFixed(1)} / {gridStats.max.toFixed(1)}</b></div>
            <div className="cr-chips">{Object.entries(gridStats.by).map(([t, n]) => <span key={t} style={{ borderColor: threatColor(t), color: threatColor(t) }}>{t} {n}</span>)}</div>
          </div>}
        </Section>
      </div>}
    </main>
  );
}
