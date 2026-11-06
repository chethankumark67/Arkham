/* Client + constants for the Citizen Reports backend (/api/complaints). */
import { API, API_BASE } from '../../api';

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Status = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'rejected' | 'duplicate';
export type Priority = 'P1' | 'P2' | 'P3';
export interface HistoryItem { at: string; status: Status; note: string }
export interface Complaint {
  id: string; created_at: string; updated_at: string; category: string; title: string; description: string;
  lat: number; lon: number; address: string | null; ward: string | null; severity: Severity; photos: string[];
  status: Status; priority: Priority; assigned_agency: string; upvotes: number; history: HistoryItem[];
  duplicate_of: string | null; demo?: boolean; reporter_name: string | null; reporter_phone: string | null; distance_m?: number;
}
export interface Stats {
  total: number; open: number; open_p1: number; median_age_hours: number;
  by_status: Record<string, number>; by_category: Record<string, number>; by_priority: Record<string, number>; by_agency: Record<string, number>;
  meta: { transitions: Record<string, string[]> };
}

export const CATS: { id: string; label: string; icon: string }[] = [
  { id: 'flooding', label: 'Flooding', icon: '🌊' }, { id: 'waterlogging', label: 'Waterlogging', icon: '💧' },
  { id: 'drain_blockage', label: 'Drain blocked', icon: '🚧' }, { id: 'sewage_overflow', label: 'Sewage overflow', icon: '🦠' },
  { id: 'water_quality', label: 'Water quality', icon: '🚰' }, { id: 'power_outage', label: 'Power outage', icon: '⚡' },
  { id: 'fallen_tree', label: 'Fallen tree', icon: '🌳' }, { id: 'road_damage_pothole', label: 'Road / pothole', icon: '🕳️' },
  { id: 'traffic_signal', label: 'Traffic signal', icon: '🚦' }, { id: 'garbage', label: 'Garbage', icon: '🗑️' },
  { id: 'streetlight', label: 'Streetlight', icon: '💡' }, { id: 'fire_hazard', label: 'Fire hazard', icon: '🔥' },
  { id: 'crowd_safety', label: 'Crowd safety', icon: '👥' }, { id: 'crime_safety', label: 'Crime / safety', icon: '🚨' },
  { id: 'health_disease', label: 'Health / disease', icon: '🏥' }, { id: 'other', label: 'Other', icon: '📝' },
];
export const catOf = (id: string) => CATS.find(c => c.id === id) ?? CATS[CATS.length - 1];
export const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
export const STATUSES: Status[] = ['new', 'acknowledged', 'in_progress', 'resolved', 'rejected', 'duplicate'];
export const AGENCIES = ['BBMP', 'BWSSB', 'BESCOM', 'BTP', 'Bengaluru Police', 'Health Dept', 'Fire & Emergency'];
export const TRANSITIONS: Record<Status, Status[]> = {
  new: ['acknowledged', 'in_progress', 'resolved', 'rejected', 'duplicate'],
  acknowledged: ['in_progress', 'resolved', 'rejected', 'duplicate'],
  in_progress: ['acknowledged', 'resolved', 'rejected', 'duplicate'],
  resolved: ['in_progress'], rejected: ['acknowledged'], duplicate: ['acknowledged'],
};
export const PRIO_RGB: Record<Priority, [number, number, number]> = { P1: [229, 83, 61], P2: [254, 145, 53], P3: [76, 141, 214] };
export const prioCss = (p: Priority) => `rgb(${PRIO_RGB[p].join(',')})`;
export const label = (s: string) => s.replace(/_/g, ' ');
export const photoUrl = (u: string) => (u.startsWith('http') ? u : API_BASE + u);
export const BBOX = { latMin: 12.8, latMax: 13.2, lonMin: 77.45, lonMax: 77.85 };
export const inBbox = (lat: number, lon: number) => lat >= BBOX.latMin && lat <= BBOX.latMax && lon >= BBOX.lonMin && lon <= BBOX.lonMax;
export function ago(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 3.6e6;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`;
}

const CLIENT_ID = (() => {
  try { let v = localStorage.arkCitizenId; if (!v) { v = crypto.randomUUID(); localStorage.arkCitizenId = v; } return v as string; }
  catch { return 'anon'; }
})();

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + '/complaints' + path, init);
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const b = await r.json(); msg = typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail); } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r.json();
}

export const cApi = {
  list: (p: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => v !== undefined && v !== '' && q.set(k, String(v)));
    return req<{ total: number; items: Complaint[] }>('?' + q);
  },
  stats: () => req<Stats>('/stats'),
  get: (id: string) => req<Complaint>('/' + encodeURIComponent(id)),
  nearby: (lat: number, lon: number, category: string) => req<{ items: Complaint[] }>(`/nearby?lat=${lat}&lon=${lon}&radius_m=300&category=${category}`),
  patch: (id: string, body: Record<string, unknown>) => req<Complaint>('/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  upvote: (id: string) => req<{ upvotes: number; already: boolean }>(`/${encodeURIComponent(id)}/upvote`, { method: 'POST', headers: { 'x-client-id': CLIENT_ID } }),
  /** multipart upload with progress (XHR, since fetch has no upload progress). */
  create: (fd: FormData, onProgress: (f: number) => void) => new Promise<Complaint>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', API + '/complaints');
    x.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      let b: any = null; try { b = JSON.parse(x.responseText); } catch { /* ignore */ }
      if (x.status >= 200 && x.status < 300) resolve(b);
      else reject(new Error(b?.detail ? (typeof b.detail === 'string' ? b.detail : b.detail.map((d: any) => `${d.loc?.slice(-1)[0]}: ${d.msg}`).join('; ')) : `HTTP ${x.status}`));
    };
    x.onerror = () => reject(new Error('Backend unreachable — is the API running?'));
    x.send(fd);
  }),
};
