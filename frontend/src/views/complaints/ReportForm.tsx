/* Citizen side: lodge a complaint with category, details, location, photos and optional contact. */
import { useEffect, useMemo, useRef, useState } from 'react';
import CMap, { type Pt } from './CMap';
import { CATS, SEVERITIES, cApi, catOf, inBbox, label, prioCss, ago, type Complaint, type Severity } from './api';

const MAX_PHOTOS = 4, MAX_MB = 5, OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
interface Ph { file: File; url: string }

export default function ReportForm({ online }: { online: boolean | null }) {
  const [cat, setCat] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [sev, setSev] = useState<Severity>('medium');
  const [loc, setLoc] = useState<{ lat: number; lon: number } | null>(null);
  const [landmark, setLandmark] = useState('');
  const [photos, setPhotos] = useState<Ph[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [dupes, setDupes] = useState<Complaint[]>([]);
  const [voted, setVoted] = useState<Record<string, number>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState<Complaint | null>(null);
  const [drag, setDrag] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);

  useEffect(() => () => photos.forEach(p => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDupes([]);
    if (!loc || !cat) return;
    let live = true;
    cApi.nearby(loc.lat, loc.lon, cat).then(r => live && setDupes(r.items)).catch(() => {});
    return () => { live = false; };
  }, [loc, cat]);

  const pick = (lat: number, lon: number) => {
    if (!inBbox(lat, lon)) { setMsg('That point is outside the Bengaluru study area.'); return; }
    setMsg(null); setLoc({ lat: +lat.toFixed(6), lon: +lon.toFixed(6) });
  };
  const geolocate = () => {
    if (!navigator.geolocation) { setMsg('Geolocation is not available in this browser.'); return; }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      p => { setGeoBusy(false); pick(p.coords.latitude, p.coords.longitude); },
      e => { setGeoBusy(false); setMsg('Could not get your location: ' + e.message + ' — click the map instead.'); },
      { enableHighAccuracy: true, timeout: 10000 });
  };
  const addFiles = (fl: FileList | File[]) => {
    const errs: string[] = []; const next = [...photos];
    for (const f of Array.from(fl)) {
      if (next.length >= MAX_PHOTOS) { errs.push(`max ${MAX_PHOTOS} photos`); break; }
      if (!OK_TYPES.includes(f.type)) { errs.push(`${f.name}: only JPEG/PNG/WebP`); continue; }
      if (f.size > MAX_MB * 1048576) { errs.push(`${f.name}: larger than ${MAX_MB} MB`); continue; }
      next.push({ file: f, url: URL.createObjectURL(f) });
    }
    setPhotos(next); setMsg(errs.length ? errs.join('; ') : null);
  };
  const removePhoto = (i: number) => { URL.revokeObjectURL(photos[i].url); setPhotos(photos.filter((_, j) => j !== i)); };

  const phoneOk = !phone.trim() || /^(\+?91[\s-]?|0)?[6-9]\d{9}$/.test(phone.replace(/\s/g, ''));
  const contactGiven = !!(name.trim() || phone.trim());
  const problems = [
    !cat && 'choose a category', title.trim().length < 3 && 'add a short title', !loc && 'set the location',
    !phoneOk && 'phone must be a 10-digit Indian mobile', contactGiven && !consent && 'tick the consent box to share contact details',
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (problems.length || !loc) { setMsg('Please ' + problems.join(', ') + '.'); return; }
    const fd = new FormData();
    fd.set('category', cat); fd.set('title', title.trim()); fd.set('description', desc.trim()); fd.set('severity', sev);
    fd.set('lat', String(loc.lat)); fd.set('lon', String(loc.lon));
    if (landmark.trim()) fd.set('address', landmark.trim());
    if (contactGiven && consent) { if (name.trim()) fd.set('reporter_name', name.trim()); if (phone.trim()) fd.set('reporter_phone', phone.trim()); }
    photos.forEach(p => fd.append('photos', p.file, p.file.name));
    setMsg(null); setProgress(0);
    try { setDone(await cApi.create(fd, setProgress)); }
    catch (e) { setMsg('Submission failed: ' + (e as Error).message); }
    finally { setProgress(null); }
  };
  const upvote = async (id: string) => {
    try { const r = await cApi.upvote(id); setVoted(v => ({ ...v, [id]: r.upvotes })); }
    catch (e) { setMsg('Upvote failed: ' + (e as Error).message); }
  };
  const reset = () => {
    photos.forEach(p => URL.revokeObjectURL(p.url));
    setCat(''); setTitle(''); setDesc(''); setSev('medium'); setLoc(null); setLandmark(''); setPhotos([]);
    setName(''); setPhone(''); setConsent(false); setMsg(null); setDone(null); setDupes([]);
  };

  const pts: Pt[] = useMemo(() => dupes.map(d => ({ id: d.id, lat: d.lat, lon: d.lon, rgb: [254, 194, 70], r: 6, tip: `${d.id}<br>${d.title}` })), [dupes]);

  if (done) return (
    <div className="card cm-card cm-done">
      <div className="t">Report received</div>
      <div className="cm-body">
        <div className="cm-big">✓</div>
        <p>Thank you. Your complaint has been lodged and routed to the responsible agency.</p>
        <div className="cm-kv"><span>Complaint ID</span><b className="cm-id" data-testid="done-id">{done.id}</b></div>
        <div className="cm-kv"><span>Priority</span><b style={{ color: prioCss(done.priority) }}>{done.priority}</b></div>
        <div className="cm-kv"><span>Assigned agency</span><b>{done.assigned_agency}</b></div>
        <div className="cm-kv"><span>Status</span><b>{label(done.status)}</b></div>
        {done.photos.length > 0 && <div className="cm-kv"><span>Photos</span><b>{done.photos.length} attached (location metadata stripped)</b></div>}
        <p className="cm-muted">Keep the ID to follow up. Officials will update the status on the board.</p>
        <button className="run" onClick={reset}>Report another issue</button>
      </div>
    </div>
  );

  return (
    <div className="cm-report">
      <div className="card cm-card cm-form">
        <div className="t">1 · What's the problem?</div>
        <div className="cm-body">
          <div className="cm-cats" role="radiogroup" aria-label="Category">
            {CATS.map(c => (
              <button key={c.id} type="button" role="radio" aria-checked={cat === c.id} className={'cm-cat' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>
                <span>{c.icon}</span>{c.label}
              </button>
            ))}
          </div>
          <label><b>Title</b><input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="e.g. Water knee-deep under the flyover" /></label>
          <label><b>Details <small className="cm-muted">({desc.length}/2000)</small></b>
            <textarea value={desc} maxLength={2000} rows={4} onChange={e => setDesc(e.target.value)} placeholder="What is happening, since when, who is affected…" /></label>
          <div><b className="cm-lab">How serious is it?</b>
            <div className="cm-seg">{SEVERITIES.map(s => <button key={s} type="button" className={'cm-sev ' + s + (sev === s ? ' on' : '')} onClick={() => setSev(s)}>{s}</button>)}</div>
          </div>
        </div>
      </div>

      <div className="card cm-card cm-locc">
        <div className="t">2 · Where? <span className="cm-muted">click the map</span></div>
        <div className="cm-body">
          <div className="cm-map cm-map-sm"><CMap points={pts} pin={loc} onMapClick={pick} focus={loc} /></div>
          <div className="cm-row">
            <button type="button" className="btn" onClick={geolocate} disabled={geoBusy}>{geoBusy ? 'Locating…' : '◎ Use my location'}</button>
            <span className="cm-mono">{loc ? `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}` : 'no location yet'}</span>
          </div>
          <label><b>Landmark / address (optional)</b><input value={landmark} maxLength={200} onChange={e => setLandmark(e.target.value)} placeholder="e.g. opposite Forum Mall gate 2" /></label>
          {dupes.length > 0 && (
            <div className="cm-dupes" data-testid="dupes">
              <div className="cm-sub">Possible duplicates within 300 m</div>
              <p className="cm-muted">If one of these is your issue, upvote it instead of filing a new report — it raises its priority.</p>
              {dupes.map(d => (
                <div key={d.id} className="cm-dupe">
                  <div><b>{d.title}</b><small>{d.id} · {label(d.status)} · {d.distance_m} m · {ago(d.created_at)}</small></div>
                  <button className="btn" disabled={d.id in voted} onClick={() => upvote(d.id)}>▲ {voted[d.id] ?? d.upvotes}{d.id in voted ? ' ✓' : ''}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card cm-card cm-photoc">
        <div className="t">3 · Photos & contact <span className="cm-muted">optional</span></div>
        <div className="cm-body">
          <div className={'cm-drop' + (drag ? ' drag' : '')} onClick={() => fileIn.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
            Drop photos here or <u>browse</u><small>JPEG / PNG / WebP · ≤ {MAX_MB} MB · up to {MAX_PHOTOS} · location data is removed</small>
            <input ref={fileIn} type="file" accept={OK_TYPES.join(',')} multiple hidden data-testid="photo-input"
              onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
          </div>
          {photos.length > 0 && <div className="cm-thumbs">{photos.map((p, i) => (
            <div key={p.url} className="cm-thumb"><img src={p.url} alt={p.file.name} /><button type="button" aria-label="Remove photo" onClick={() => removePhoto(i)}>×</button></div>
          ))}</div>}
          <div className="cm-grid2">
            <label><b>Name</b><input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
            <label><b>Mobile</b><input value={phone} maxLength={16} inputMode="tel" onChange={e => setPhone(e.target.value)} placeholder="98XXXXXXXX" className={phoneOk ? '' : 'bad'} /></label>
          </div>
          {contactGiven && <label className="cm-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
            I consent to officials contacting me about this report. My details are never shown publicly.</label>}
          <div className="cm-summary">
            {cat && <span>{catOf(cat).icon} {catOf(cat).label}</span>}<span className={'cm-sev ' + sev + ' on'}>{sev}</span>
            {photos.length > 0 && <span>{photos.length} photo{photos.length > 1 ? 's' : ''}</span>}
          </div>
          {msg && <div className="cm-err">{msg}</div>}
          {online === false && <div className="cm-err">The ARKHAM API is offline — your report cannot be submitted right now.</div>}
          {progress !== null && <div className="cm-prog"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
          <button className="run cm-submit" onClick={submit} disabled={progress !== null || online === false}>
            {progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : 'Submit report'}</button>
          {problems.length > 0 && <small className="cm-muted">To submit: {problems.join(' · ')}</small>}
        </div>
      </div>
    </div>
  );
}
