/* English / Kannada strings for the citizen reporting page. Choice persists in localStorage. */
import { useEffect, useState } from 'react';

export type Lang = 'en' | 'kn';
const KEY = 'arkham.lang';

const en = {
  title: 'Citizen Reports', subtitle: 'Report civic issues · officials triage and route them to the right agency',
  tabReport: 'Report an issue', tabBoard: "Officials' board", online: 'API online', offline: 'API offline', checking: 'checking…', retry: 'retry',
  langToggle: 'ಕನ್ನಡ', langToggleLabel: 'ಕನ್ನಡದಲ್ಲಿ ನೋಡಿ (View in Kannada)',
  s1: "1 · What's the problem?", category: 'Category', fTitle: 'Title', titlePh: 'e.g. Water knee-deep under the flyover',
  details: 'Details', detailsPh: 'What is happening, since when, who is affected…', howSerious: 'How serious is it?',
  s2: '2 · Where?', clickMap: 'click the map, or use your location', mapLabel: 'Map: click to set the problem location',
  useLoc: '◎ Use my location', locating: 'Locating…', noLoc: 'no location yet', locSet: 'Location set',
  landmark: 'Landmark / address (optional)', landmarkPh: 'e.g. opposite Forum Mall gate 2',
  dupesH: 'Possible duplicates within 300 m', dupesP: 'If one of these is your issue, upvote it instead of filing a new report — it raises its priority.', upvote: 'Upvote',
  s3: '3 · Photos & contact', optional: 'optional', drop: 'Drop photos here or', browse: 'browse',
  dropHint: (mb: number, n: number) => `JPEG / PNG / WebP · ≤ ${mb} MB · up to ${n} · location data is removed`,
  photoAlt: (i: number, n: number, name: string) => `Photo ${i} of ${n}: ${name}`, removePhoto: (i: number) => `Remove photo ${i}`,
  name: 'Name', mobile: 'Mobile', consent: 'I consent to officials contacting me about this report. My details are never shown publicly.',
  photos: (n: number) => `${n} photo${n > 1 ? 's' : ''}`, apiOff: 'The ARKHAM API is offline — your report cannot be submitted right now.',
  uploading: 'Uploading…', submit: 'Submit report', toSubmit: 'To submit', please: 'Please',
  pChooseCat: 'choose a category', pTitle: 'add a short title', pLoc: 'set the location',
  pPhone: 'phone must be a 10-digit Indian mobile', pConsent: 'tick the consent box to share contact details',
  outside: 'That point is outside the Bengaluru study area.', noGeo: 'Geolocation is not available in this browser.',
  geoFail: (m: string) => `Could not get your location: ${m} — click the map instead.`,
  maxPhotos: (n: number) => `max ${n} photos`, badType: (f: string) => `${f}: only JPEG/PNG/WebP`, tooBig: (f: string, mb: number) => `${f}: larger than ${mb} MB`,
  submitFail: 'Submission failed', upvoteFail: 'Upvote failed',
  received: 'Report received', thanks: 'Thank you. Your complaint has been lodged and routed to the responsible agency.',
  cid: 'Complaint ID', priority: 'Priority', agency: 'Assigned agency', status: 'Status',
  photosAttached: (n: number) => `${n} attached (location metadata stripped)`, keepId: 'Keep the ID to follow up. Officials will update the status on the board.',
  another: 'Report another issue',
  sev: { low: 'low', medium: 'medium', high: 'high', critical: 'critical' } as Record<string, string>,
  cats: {} as Record<string, string>,
};

export type Strings = typeof en;

const kn: Strings = {
  title: 'ನಾಗರಿಕ ದೂರುಗಳು', subtitle: 'ನಾಗರಿಕ ಸಮಸ್ಯೆಗಳನ್ನು ವರದಿ ಮಾಡಿ · ಅಧಿಕಾರಿಗಳು ಪರಿಶೀಲಿಸಿ ಸಂಬಂಧಿತ ಇಲಾಖೆಗೆ ಕಳುಹಿಸುತ್ತಾರೆ',
  tabReport: 'ಸಮಸ್ಯೆ ವರದಿ ಮಾಡಿ', tabBoard: 'ಅಧಿಕಾರಿಗಳ ಫಲಕ', online: 'API ಸಂಪರ್ಕದಲ್ಲಿದೆ', offline: 'API ಸಂಪರ್ಕವಿಲ್ಲ', checking: 'ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ…', retry: 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ',
  langToggle: 'English', langToggleLabel: 'View in English (ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ನೋಡಿ)',
  s1: '1 · ಸಮಸ್ಯೆ ಏನು?', category: 'ವರ್ಗ', fTitle: 'ಶೀರ್ಷಿಕೆ', titlePh: 'ಉದಾ. ಫ್ಲೈಓವರ್ ಕೆಳಗೆ ಮೊಣಕಾಲುದ್ದ ನೀರು',
  details: 'ವಿವರಗಳು', detailsPh: 'ಏನಾಗುತ್ತಿದೆ, ಯಾವಾಗಿನಿಂದ, ಯಾರಿಗೆ ತೊಂದರೆ…', howSerious: 'ಎಷ್ಟು ಗಂಭೀರವಾಗಿದೆ?',
  s2: '2 · ಎಲ್ಲಿ?', clickMap: 'ನಕ್ಷೆಯ ಮೇಲೆ ಕ್ಲಿಕ್ ಮಾಡಿ ಅಥವಾ ನಿಮ್ಮ ಸ್ಥಳ ಬಳಸಿ', mapLabel: 'ನಕ್ಷೆ: ಸಮಸ್ಯೆಯ ಸ್ಥಳ ಗುರುತಿಸಲು ಕ್ಲಿಕ್ ಮಾಡಿ',
  useLoc: '◎ ನನ್ನ ಸ್ಥಳ ಬಳಸಿ', locating: 'ಸ್ಥಳ ಹುಡುಕಲಾಗುತ್ತಿದೆ…', noLoc: 'ಸ್ಥಳ ಇನ್ನೂ ಆಯ್ಕೆಯಾಗಿಲ್ಲ', locSet: 'ಸ್ಥಳ ಗುರುತಿಸಲಾಗಿದೆ',
  landmark: 'ಹೆಗ್ಗುರುತು / ವಿಳಾಸ (ಐಚ್ಛಿಕ)', landmarkPh: 'ಉದಾ. ಫೋರಮ್ ಮಾಲ್ ಗೇಟ್ 2 ಎದುರು',
  dupesH: '300 ಮೀ ಒಳಗಿನ ಸಂಭಾವ್ಯ ನಕಲು ದೂರುಗಳು', dupesP: 'ಇವುಗಳಲ್ಲಿ ಒಂದು ನಿಮ್ಮ ಸಮಸ್ಯೆಯಾಗಿದ್ದರೆ, ಹೊಸ ದೂರು ನೀಡುವ ಬದಲು ಅದನ್ನು ಬೆಂಬಲಿಸಿ — ಅದರ ಆದ್ಯತೆ ಹೆಚ್ಚುತ್ತದೆ.', upvote: 'ಬೆಂಬಲಿಸಿ',
  s3: '3 · ಫೋಟೋಗಳು ಮತ್ತು ಸಂಪರ್ಕ', optional: 'ಐಚ್ಛಿಕ', drop: 'ಫೋಟೋಗಳನ್ನು ಇಲ್ಲಿ ಎಳೆದು ಹಾಕಿ ಅಥವಾ', browse: 'ಆಯ್ಕೆ ಮಾಡಿ',
  dropHint: (mb, n) => `JPEG / PNG / WebP · ≤ ${mb} MB · ಗರಿಷ್ಠ ${n} · ಸ್ಥಳ ಮಾಹಿತಿಯನ್ನು ತೆಗೆದುಹಾಕಲಾಗುತ್ತದೆ`,
  photoAlt: (i, n, name) => `ಫೋಟೋ ${i} / ${n}: ${name}`, removePhoto: i => `ಫೋಟೋ ${i} ತೆಗೆದುಹಾಕಿ`,
  name: 'ಹೆಸರು', mobile: 'ಮೊಬೈಲ್', consent: 'ಈ ದೂರಿನ ಬಗ್ಗೆ ಅಧಿಕಾರಿಗಳು ನನ್ನನ್ನು ಸಂಪರ್ಕಿಸಲು ನನ್ನ ಒಪ್ಪಿಗೆ ಇದೆ. ನನ್ನ ವಿವರಗಳನ್ನು ಸಾರ್ವಜನಿಕವಾಗಿ ತೋರಿಸಲಾಗುವುದಿಲ್ಲ.',
  photos: n => `${n} ಫೋಟೋ`, apiOff: 'ARKHAM API ಸಂಪರ್ಕದಲ್ಲಿಲ್ಲ — ಈಗ ನಿಮ್ಮ ದೂರು ಸಲ್ಲಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.',
  uploading: 'ಅಪ್‌ಲೋಡ್ ಆಗುತ್ತಿದೆ…', submit: 'ದೂರು ಸಲ್ಲಿಸಿ', toSubmit: 'ಸಲ್ಲಿಸಲು', please: 'ದಯವಿಟ್ಟು',
  pChooseCat: 'ವರ್ಗ ಆಯ್ಕೆ ಮಾಡಿ', pTitle: 'ಚಿಕ್ಕ ಶೀರ್ಷಿಕೆ ಸೇರಿಸಿ', pLoc: 'ಸ್ಥಳ ಗುರುತಿಸಿ',
  pPhone: 'ಮೊಬೈಲ್ ಸಂಖ್ಯೆ 10 ಅಂಕಿಗಳ ಭಾರತೀಯ ಸಂಖ್ಯೆಯಾಗಿರಬೇಕು', pConsent: 'ಸಂಪರ್ಕ ವಿವರ ಹಂಚಲು ಒಪ್ಪಿಗೆ ಪೆಟ್ಟಿಗೆಯನ್ನು ಗುರುತಿಸಿ',
  outside: 'ಆ ಸ್ಥಳ ಬೆಂಗಳೂರು ಅಧ್ಯಯನ ಪ್ರದೇಶದ ಹೊರಗಿದೆ.', noGeo: 'ಈ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಸ್ಥಳ ಸೇವೆ ಲಭ್ಯವಿಲ್ಲ.',
  geoFail: m => `ನಿಮ್ಮ ಸ್ಥಳ ಪಡೆಯಲಾಗಲಿಲ್ಲ: ${m} — ಬದಲಿಗೆ ನಕ್ಷೆಯ ಮೇಲೆ ಕ್ಲಿಕ್ ಮಾಡಿ.`,
  maxPhotos: n => `ಗರಿಷ್ಠ ${n} ಫೋಟೋಗಳು`, badType: f => `${f}: JPEG/PNG/WebP ಮಾತ್ರ`, tooBig: (f, mb) => `${f}: ${mb} MB ಗಿಂತ ದೊಡ್ಡದು`,
  submitFail: 'ಸಲ್ಲಿಕೆ ವಿಫಲವಾಯಿತು', upvoteFail: 'ಬೆಂಬಲ ವಿಫಲವಾಯಿತು',
  received: 'ದೂರು ಸ್ವೀಕರಿಸಲಾಗಿದೆ', thanks: 'ಧನ್ಯವಾದಗಳು. ನಿಮ್ಮ ದೂರು ದಾಖಲಾಗಿದ್ದು ಸಂಬಂಧಿತ ಇಲಾಖೆಗೆ ಕಳುಹಿಸಲಾಗಿದೆ.',
  cid: 'ದೂರು ಸಂಖ್ಯೆ', priority: 'ಆದ್ಯತೆ', agency: 'ನಿಯೋಜಿತ ಇಲಾಖೆ', status: 'ಸ್ಥಿತಿ',
  photosAttached: n => `${n} ಲಗತ್ತಿಸಲಾಗಿದೆ (ಸ್ಥಳ ಮಾಹಿತಿ ತೆಗೆದುಹಾಕಲಾಗಿದೆ)`, keepId: 'ಮುಂದಿನ ವಿಚಾರಣೆಗೆ ಈ ಸಂಖ್ಯೆಯನ್ನು ಇಟ್ಟುಕೊಳ್ಳಿ. ಅಧಿಕಾರಿಗಳು ಫಲಕದಲ್ಲಿ ಸ್ಥಿತಿಯನ್ನು ನವೀಕರಿಸುತ್ತಾರೆ.',
  another: 'ಇನ್ನೊಂದು ಸಮಸ್ಯೆ ವರದಿ ಮಾಡಿ',
  sev: { low: 'ಕಡಿಮೆ', medium: 'ಮಧ್ಯಮ', high: 'ಹೆಚ್ಚು', critical: 'ತುರ್ತು' },
  cats: {
    flooding: 'ಪ್ರವಾಹ', waterlogging: 'ನೀರು ನಿಲ್ಲುವಿಕೆ', drain_blockage: 'ಚರಂಡಿ ಕಟ್ಟಿಕೊಂಡಿದೆ', sewage_overflow: 'ಒಳಚರಂಡಿ ಉಕ್ಕುವಿಕೆ',
    water_quality: 'ನೀರಿನ ಗುಣಮಟ್ಟ', power_outage: 'ವಿದ್ಯುತ್ ಕಡಿತ', fallen_tree: 'ಬಿದ್ದ ಮರ', road_damage_pothole: 'ರಸ್ತೆ / ಗುಂಡಿ',
    traffic_signal: 'ಸಂಚಾರ ದೀಪ', garbage: 'ಕಸ', streetlight: 'ಬೀದಿ ದೀಪ', fire_hazard: 'ಬೆಂಕಿ ಅಪಾಯ',
    crowd_safety: 'ಜನಸಂದಣಿ ಸುರಕ್ಷತೆ', crime_safety: 'ಅಪರಾಧ / ಸುರಕ್ಷತೆ', health_disease: 'ಆರೋಗ್ಯ / ರೋಗ', other: 'ಇತರೆ',
  },
};

const STR = { en, kn };
let current: Lang = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'kn') ? 'kn' : 'en';
const subs = new Set<(l: Lang) => void>();

export function setLang(l: Lang) {
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  subs.forEach(f => f(l));
}

/** Current language + strings; re-renders every subscriber when the language changes. */
export function useLang(): [Lang, Strings, (l: Lang) => void] {
  const [l, set] = useState(current);
  useEffect(() => { subs.add(set); return () => { subs.delete(set); }; }, []);
  return [l, STR[l], setLang];
}

export const catLabel = (t: Strings, id: string, fallback: string) => t.cats[id] ?? fallback;
