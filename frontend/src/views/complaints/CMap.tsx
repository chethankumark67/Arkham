/* MapLibre satellite base + deck.gl scatter overlay shared by the report form and the officials' board. */
import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import mlWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';

maplibregl.setWorkerUrl(mlWorker);

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { sat: { type: 'raster', tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] } },
  layers: [{ id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': -0.35, 'raster-brightness-max': 0.75 } }],
};

export interface Pt { id: string; lat: number; lon: number; rgb: [number, number, number]; r: number; tip: string; sel?: boolean }

export default function CMap({ points, pin, onMapClick, onPointClick, focus }: {
  points: Pt[]; pin?: { lat: number; lon: number } | null; onMapClick?: (lat: number, lon: number) => void;
  onPointClick?: (id: string) => void; focus?: { lat: number; lon: number } | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const deck = useRef<MapboxOverlay | null>(null);
  const cb = useRef({ onMapClick, onPointClick });
  cb.current = { onMapClick, onPointClick };

  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({ container: box.current, style: STYLE, center: [77.62, 12.97], zoom: 10.6, minZoom: 8,
      maxBounds: [[77.2, 12.6], [78.1, 13.4]], attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const ov = new MapboxOverlay({ interleaved: false, layers: [],
      getTooltip: ({ object }: any) => object?.tip ? { html: object.tip, style: { background: '#14181c', color: '#e6e9ec', font: '11px var(--mono,monospace)', padding: '5px 8px', borderRadius: '4px', maxWidth: '260px' } } : null });
    m.addControl(ov as unknown as maplibregl.IControl);
    m.on('click', e => cb.current.onMapClick?.(e.lngLat.lat, e.lngLat.lng));
    map.current = m; deck.current = ov;
    const ro = new ResizeObserver(() => m.resize()); ro.observe(box.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; deck.current = null; };
  }, []);

  useEffect(() => {
    const pinData = pin ? [{ id: '_pin', lat: pin.lat, lon: pin.lon, rgb: [255, 255, 255], r: 9, tip: 'Selected location' }] : [];
    deck.current?.setProps({ layers: [
      new ScatterplotLayer<Pt>({ id: 'cmp', data: points, pickable: true, radiusUnits: 'pixels', stroked: true,
        getPosition: d => [d.lon, d.lat], getRadius: d => (d.sel ? d.r + 4 : d.r), getFillColor: d => [...d.rgb, 220] as any,
        getLineColor: d => (d.sel ? [255, 255, 255, 255] : [10, 12, 14, 200]), getLineWidth: d => (d.sel ? 3 : 1), lineWidthUnits: 'pixels',
        updateTriggers: { getRadius: points, getLineColor: points },
        onClick: ({ object }) => { if (object) { cb.current.onPointClick?.(object.id); return true; } return false; } }),
      new ScatterplotLayer<any>({ id: 'pin', data: pinData, radiusUnits: 'pixels', stroked: true, getPosition: d => [d.lon, d.lat],
        getRadius: 8, getFillColor: [254, 145, 53, 255], getLineColor: [255, 255, 255, 255], getLineWidth: 3, lineWidthUnits: 'pixels' }),
    ] });
  }, [points, pin]);

  useEffect(() => { if (focus && map.current) map.current.easeTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.current.getZoom(), 13) }); }, [focus]);

  return <div ref={box} className="cm-mapbox" />;
}
