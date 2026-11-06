/* Typed client for the ARKHAM FastAPI backend. Base URL: VITE_API_URL, ?api=…, localStorage.arkhamApi, or localhost. */
const qs = new URLSearchParams(location.search);
export const API_BASE = (qs.get('api') || localStorage.arkhamApi || import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
export const API = API_BASE + '/api';
export const IV = ['lakes', 'desilt', 'pumps', 'bellandur', 'permeable'] as const;
export const BOUNDS: [[number, number], [number, number]] = [[12.8, 77.45], [13.2, 77.85]];

async function j<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, init);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}
const post = <T = any>(path: string, body?: unknown) =>
  j<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

export const ivq = (sel: Iterable<number>) => [...sel].map(i => IV[i]).join(',');

export const api = {
  health: () => j('/health'),
  meta: () => j('/meta'),
  scenario: (rain: number, drain = 100, iv = '', o: { detail?: boolean; probabilities?: boolean } = {}) =>
    j(`/scenario?rain=${rain}&drain=${drain}&iv=${iv}${o.detail ? '&detail=true' : ''}${o.probabilities ? '&probabilities=true' : ''}`),
  sample: (rain: number, drain: number, interventions: string[], points: { id: string; lat: number; lon: number }[]) =>
    post('/flood/sample', { rain, drain, interventions, points }),
  impact: (rain: number, drain: number, iv: string, budget: number) => j(`/impact?rain=${rain}&drain=${drain}&iv=${iv}&budget=${budget}`),
  optimize: (rain: number, budget: number, drain = 100) => j(`/optimize?rain=${rain}&drain=${drain}&budget=${budget}`),
  timeline: (rain: number, drain = 100, iv = '') => j(`/timeline?rain=${rain}&drain=${drain}&iv=${iv}`),
  rainfall: () => j('/rainfall'),
  domain: (id: string, rain: number, drain: number) => j(`/domains/${id}?rain=${rain}&drain=${drain}`),
  mapLayers: (q: string) => j(`/map/layers?${q}`),
  facilities: (q: string) => j(`/map/facilities?${q}`),
  roads: () => j('/map/roads'),
  heat: (peak: number) => j(`/heat?peak=${peak}`),
  hotspot: (lat: number, lon: number, rainMmHr: number, drainMmHr = 15, minutes = 120) =>
    j(`/hotspot/simulate?lat=${lat}&lon=${lon}&rain_mm_hr=${rainMmHr}&drain_mm_hr=${drainMmHr}&minutes=${minutes}`),
  citywideRun: (rainMmHr: number, drainMmHr = 15, minutes = 120, resM = 60) =>
    post<{ job: string }>(`/citywide/run?rain_mm_hr=${rainMmHr}&drain_mm_hr=${drainMmHr}&minutes=${minutes}&res_m=${resM}`),
  citywide: (job: string, frame?: number) => j(`/citywide/${job}${frame != null ? `?frame=${frame}` : ''}`),
  nearby: (lat: number, lon: number, km = 1) => j(`/nearby?lat=${lat}&lon=${lon}&km=${km}`),
  runs: (n = 20) => j(`/runs?n=${n}`),
};

export const urls = {
  floodPng: (q: string) => `${API}/map/flood.png?${q}`,
  heatPng: (peak: number) => `${API}/map/heat.png?peak=${peak}`,
  drainagePng: () => `${API}/map/drainage.png`,
  cogFlood: (q: string) => `${API}/cog/flood.tif?${q}`,
  cogCitywide: (job: string) => `${API}/cog/citywide/${job}.tif`,
  pmtiles: () => `${API_BASE}/tiles/arkham.pmtiles`,
};

/** Open citizen complaints (optional endpoint; resolves [] when missing/offline). */
export async function fetchComplaints(): Promise<any[]> {
  try {
    const r: any = await j('/complaints?status=open&limit=200');
    return Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
  } catch { return []; }
}
