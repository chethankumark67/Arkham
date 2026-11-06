/* Typed client for the Suraksha-Grid India crime-intelligence service (suraksha-grid/, FastAPI, default :8100).
   Base URL: ?crime=…, localStorage.surakshaApi, VITE_CRIME_API_URL, or http://localhost:8100. */
const qs = new URLSearchParams(location.search);
export const CRIME_BASE = (qs.get('crime') || localStorage.surakshaApi || import.meta.env.VITE_CRIME_API_URL || 'http://localhost:8100').replace(/\/$/, '');
const V1 = CRIME_BASE + '/api/v1';

export type Threat = 'Critical' | 'High' | 'Moderate' | 'Low' | string;

export interface CrimeStatus {
  postgresql: { status: string; incident_count?: number; detail?: string };
  neo4j: { status: string };
  spacy_nlp: { status: string };
  ml_predictor: { status: string; cv_accuracy: number | null };
}
export interface Hotspot {
  centroid_lat: number; centroid_lon: number; incident_count: number; dominant_crime_type: string;
  cities_involved: string[]; cluster_id?: number; peak_hour?: number; risk_score?: number;
}
export interface TemporalSummary { by_hour: Record<string, number>; by_day: Record<string, number> }
export interface CityHotzone { city: string; total_incidents: number; crime_types: string[] }
export interface SlotPrediction {
  latitude: number; longitude: number; target_time: string;
  occasion_factors: { is_festival: boolean; is_payday: boolean };
  risk_score: number; threat_level: Threat; prediction_method: string;
  model_cv_accuracy?: string; top_risk_drivers?: Record<string, number>;
}
export interface SlotRequest { latitude: number; longitude: number; target_datetime: string; is_festival: 0 | 1; is_payday: 0 | 1 }
export interface GridRequest {
  lat_min: number; lat_max: number; lon_min: number; lon_max: number; target_datetime: string;
  is_festival: 0 | 1; is_payday: 0 | 1; grid_steps: number;
}
export interface IncidentRequest { fir_text: string; city: string; suspect_alias: string; vehicle_plate: string }
export interface SuspectLead { primary_suspect?: string; criminal_network?: string[]; active_cities?: string[]; [k: string]: unknown }
export interface IncidentAnalysis {
  extracted_mo_signature: string;
  nlp_analysis: { mo_signature: string; extracted_keywords: string[]; named_entities: Record<string, string[]>; is_night_crime: boolean; weapon_mentioned: boolean };
  cross_jurisdiction_alert: { level: string; message: string };
  suspect_leads: SuspectLead[];
}
export interface VehicleTrace { plate: string; linked_suspects: string[]; incident_cities: string[]; crime_types: string[] }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(V1 + path, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = (body as any)?.detail;
    throw new Error(Array.isArray(d) ? d.map((x: any) => `${(x.loc || []).slice(1).join('.')}: ${x.msg}`).join('; ') : d || `HTTP ${r.status}`);
  }
  return body as T;
}
const post = <T,>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const crimeApi = {
  root: () => fetch(CRIME_BASE + '/').then(r => r.json() as Promise<{ service: string; version: string; status: string }>),
  status: () => call<CrimeStatus>('/status'),
  hotspots: (crimeType?: string) =>
    call<{ total_hotspots: number; data: Hotspot[] }>(`/hotspots${crimeType ? `?crime_type=${encodeURIComponent(crimeType)}` : ''}`),
  temporal: () => call<{ data: TemporalSummary }>('/temporal-summary').then(r => r.data),
  hotzones: () => call<{ data: CityHotzone[] }>('/city-hotzones').then(r => r.data),
  predictSlot: (b: SlotRequest) => post<{ data: SlotPrediction }>('/predict/daily-slot', b).then(r => r.data),
  predictGrid: (b: GridRequest) => post<{ grid_points: number; data: SlotPrediction[] }>('/predict/grid', b).then(r => r.data),
  analyzeIncident: (b: IncidentRequest) => post<IncidentAnalysis>('/analyze-incident', b),
  traceVehicle: (plate: string) => post<{ data: VehicleTrace }>('/trace-vehicle', { vehicle_plate: plate }).then(r => r.data),
};

/** "2026-06-15T22:30" (datetime-local) -> "2026-06-15 22:30:00" (backend format). */
export const toBackendTime = (local: string) => (local.length === 16 ? local + ':00' : local).replace('T', ' ');
export const threatColor = (t: Threat) =>
  t === 'Critical' ? '#e5533d' : t === 'High' ? '#FE9135' : t === 'Moderate' ? '#FBC246' : '#4fae78';

/* ---------- read-only dashboard endpoints (suraksha-grid/extensions.py) ---------- */
export interface CrimeFilters { types: string[]; from: string; to: string; status: string }
export interface IncidentRow {
  incident_id: string; timestamp: string; crime_type: string; city: string; locality: string; police_station: string; ward: string;
  status: string; latitude: number; longitude: number; mo: string; suspect_alias: string; vehicle_plate: string; gang: string;
  fir_text: string; is_festival: number; is_payday: number;
}
export interface NameCount { name: string; count: number }
export interface CrimeSummary {
  dataset: string; reference_time: string | null; total_incidents: number; date_range: [string, string] | null;
  last_30_days: number; previous_30_days: number; change_30d_pct: number | null;
  by_type: NameCount[]; by_station: NameCount[]; by_city: NameCount[]; by_status: NameCount[];
  clearance_rate: number; peak_hour: number | null; peak_day: string | null; active_gangs_90d: number; known_gangs: number; attributed_share: number;
}
export interface CrimeTrend { interval: 'week' | 'month'; types: string[]; data: ({ period: string; total: number } & Record<string, number | string>)[] }
export interface HeatMatrix { days: string[]; hours: number[]; matrix: number[][]; max: number }
export interface StationStat { station: string; city: string; count: number; lat: number; lon: number; top_type: string; clearance_rate: number; by_status: Record<string, number> }
export type NetNodeType = 'suspect' | 'vehicle' | 'incident' | 'city';
export interface NetNode { id: string; type: NetNodeType; label: string; count: number; gang?: string; crime_type?: string; timestamp?: string }
export interface NetEdge { source: string; target: string; type: string; weight: number }
export interface CrimeNetwork { source: string; dataset: string; counts: Record<NetNodeType, number>; nodes: NetNode[]; edges: NetEdge[] }

export const filterQuery = (f: CrimeFilters, extra: Record<string, string | number> = {}) => {
  const p = new URLSearchParams();
  if (f.types.length) p.set('crime_type', f.types.join(','));
  if (f.from) p.set('date_from', f.from);
  if (f.to) p.set('date_to', f.to);
  if (f.status) p.set('status', f.status);
  Object.entries(extra).forEach(([k, v]) => v !== '' && p.set(k, String(v)));
  const s = p.toString();
  return s ? '?' + s : '';
};

export const dashApi = {
  incidents: (f: CrimeFilters, extra: { limit?: number; offset?: number; q?: string } = {}) =>
    call<{ dataset: string; total: number; limit: number; offset: number; data: IncidentRow[] }>('/incidents' + filterQuery(f, extra as Record<string, string | number>)),
  summary: (f: CrimeFilters) => call<CrimeSummary>('/stats/summary' + filterQuery(f)),
  trend: (f: CrimeFilters, interval: 'week' | 'month') => call<CrimeTrend>('/stats/trend' + filterQuery(f, { interval })),
  heatmatrix: (f: CrimeFilters) => call<HeatMatrix>('/stats/heatmatrix' + filterQuery(f)),
  stations: (f: CrimeFilters) => call<{ data: StationStat[] }>('/stations' + filterQuery(f)).then(r => r.data),
  network: (limit = 60) => call<CrimeNetwork>(`/network?limit=${limit}`),
};

/** Fixed colour per crime type (follows the entity, never its rank). */
export const TYPE_COLORS: Record<string, string> = {
  'Vehicle Theft': '#3987e5', 'Cyber Fraud': '#d95926', 'Pickpocketing': '#199e70', 'Chain Snatching': '#c98500',
  'House Break-in': '#d55181', 'Assault': '#4caf50', 'Shop Burglary': '#9085e9', 'Drug Peddling': '#e66767',
  'Eve Teasing/Harassment': '#7fb3c8', 'ATM Robbery': '#b08a5a',
};
export const ALL_CRIME_TYPES = Object.keys(TYPE_COLORS);
export const typeColor = (t: string) => TYPE_COLORS[t] || '#8a8f98';
export const STATUSES = ['Under Investigation', 'Charge-sheeted', 'Closed', 'Undetected'];
export const STATUS_COLORS: Record<string, string> = { 'Under Investigation': '#fab219', 'Charge-sheeted': '#0ca30c', 'Closed': '#6f8fa8', 'Undetected': '#d03b3b' };
