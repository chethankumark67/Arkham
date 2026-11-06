/* Citizen side: lodge a complaint with category, details, location, photos and optional contact. */
import { useEffect, useMemo, useRef, useState } from 'react';
import CMap, { type Pt } from './CMap';
import { useLang, catLabel } from './i18n';
import { CATS, SEVERITIES, cApi, catOf, inBbox, label, prioCss, ago, type Complaint, type Severity } from './api';

const MAX_PHOTOS = 4, MAX_MB = 5, OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
interface Ph { file: File; url: string }

/** Arrow keys move the selection within a radio group (WAI-ARIA radio pattern) and focus the new option. */
function radioKeys(e: React.KeyboardEvent, ids: readonly string[], cur: string, set: (v: string) => void) {
  const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!d && e.key !== 'Home' && e.key !== 'End') return;
  e.preventDefault();
  const i = Math.max(0, ids.indexOf(cur));
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + d! + ids.length) % ids.length;
  set(ids[n]);
  const btns = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role=radio]');
  btns[n]?.focus();
}

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
  const [, t] = useLang();
  const catName = (id: string) => catLabel(t, id, catOf(id).label);

  useEffect(() => () => photos.forEach(p => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDupes([]);
    if (!loc || !cat) return;
    let live = true;
    cApi.nearby(loc.lat, loc.lon, cat).then(r => live && setDupes(r.items)).catch(() => {});
    return () => { live = false; };
  }, [loc, cat]);

  const pick = (lat: number, lon: number) => {
    if (!inBbox(lat, lon)) { setMsg(t.outside); return; }
    setMsg(null); setLoc({ lat: +lat.toFixed(6), lon: +lon.toFixed(6) });
  };
  const geolocate = () => {
    if (!navigator.geolocation) { setMsg(t.noGeo); return; }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      p => { setGeoBusy(false); pick(p.coords.latitude, p.coords.longitude); },
      e => { setGeoBusy(false); setMsg(t.geoFail(e.message)); },
      { enableHighAccuracy: true, timeout: 10000 });
  };
  const addFiles = (fl: FileList | File[]) => {
    const errs: string[] = []; const next = [...photos];
    for (const f of Array.from(fl)) {
      if (next.length >= MAX_PHOTOS) { errs.push(t.maxPhotos(MAX_PHOTOS)); break; }
      if (!OK_TYPES.includes(f.type)) { errs.push(t.badType(f.name)); continue; }
      if (f.size > MAX_MB * 1048576) { errs.push(t.tooBig(f.name, MAX_MB)); continue; }
      next.push({ file: f, url: URL.createObjectURL(f) });
    }
    setPhotos(next); setMsg(errs.length ? errs.join('; ') : null);
  };
  const removePhoto = (i: number) => { URL.revokeObjectURL(photos[i].url); setPhotos(photos.filter((_, j) => j !== i)); };

  const phoneOk = !phone.trim() || /^(\+?91[\s-]?|0)?[6-9]\d{9}$/.test(phone.replace(/\s/g, ''));
  const contactGiven = !!(name.trim() || phone.trim());
  const problems = [
    !cat && t.pChooseCat, title.trim().length < 3 && t.pTitle, !loc && t.pLoc,
    !phoneOk && t.pPhone, contactGiven && !consent && t.pConsent,
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (problems.length || !loc) { setMsg(t.please + ' ' + problems.join(', ') + '.'); return; }
    const fd = new FormData();
    fd.set('category', cat); fd.set('title', title.trim()); fd.set('description', desc.trim()); fd.set('severity', sev);
    fd.set('lat', String(loc.lat)); fd.set('lon', String(loc.lon));
    if (landmark.trim()) fd.set('address', landmark.trim());
    if (contactGiven && consent) { if (name.trim()) fd.set('reporter_name', name.trim()); if (phone.trim()) fd.set('reporter_phone', phone.trim()); }
    photos.forEach(p => fd.append('photos', p.file, p.file.name));
    setMsg(null); setProgress(0);
    try { setDone(await cApi.create(fd, setProgress)); }
    catch (e) { setMsg(t.submitFail + ': ' + (e as Error).message); }
    finally { setProgress(null); }
  };
  const upvote = async (id: string) => {
    try { const r = await cApi.upvote(id); setVoted(v => ({ ...v, [id]: r.upvotes })); }
    catch (e) { setMsg(t.upvoteFail + ': ' + (e as Error).message); }
  };
  const reset = () => {
    photos.forEach(p => URL.revokeObjectURL(p.url));
    setCat(''); setTitle(''); setDesc(''); setSev('medium'); setLoc(null); setLandmark(''); setPhotos([]);
    setName(''); setPhone(''); setConsent(false); setMsg(null); setDone(null); setDupes([]);
  };

  const pts: Pt[] = useMemo(() => dupes.map(d => ({ id: d.id, lat: d.lat, lon: d.lon, rgb: [254, 194, 70], r: 6, tip: `${d.id}<br>${d.title}` })), [dupes]);

  if (done) return (
    <div className="card cm-card cm-done" role="status">
      <h2 className="t">{t.received}</h2>
      <div className="cm-body">
        <div className="cm-big" aria-hidden="true">✓</div>
        <p>{t.thanks}</p>
        <div className="cm-kv"><span>{t.cid}</span><b className="cm-id" data-testid="done-id">{done.id}</b></div>
        <div className="cm-kv"><span>{t.priority}</span><b style={{ color: prioCss(done.priority) }}>{done.priority}</b></div>
        <div className="cm-kv"><span>{t.agency}</span><b>{done.assigned_agency}</b></div>
        <div className="cm-kv"><span>{t.status}</span><b>{label(done.status)}</b></div>
        {done.photos.length > 0 && <div className="cm-kv"><span>{t.s3.replace(/^3 · /, '')}</span><b>{t.photosAttached(done.photos.length)}</b></div>}
        <p className="cm-muted">{t.keepId}</p>
        <button className="run" onClick={reset}>{t.another}</button>
      </div>
    </div>
  );

  return (
    <div className="cm-report">
      <div className="card cm-card cm-form">
        <h2 className="t" id="cm-s1">{t.s1}</h2>
        <div className="cm-body">
          <div className="cm-cats" role="radiogroup" aria-label={t.category} onKeyDown={e => radioKeys(e, CATS.map(c => c.id), cat, setCat)}>
            {CATS.map((c, i) => (
              <button key={c.id} type="button" role="radio" aria-checked={cat === c.id} tabIndex={cat === c.id || (!cat && i === 0) ? 0 : -1}
                className={'cm-cat' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>
                <span aria-hidden="true">{c.icon}</span>{catName(c.id)}
              </button>
            ))}
          </div>
          <label><b>{t.fTitle}</b><input value={title} maxLength={120} required aria-required="true" onChange={e => setTitle(e.target.value)} placeholder={t.titlePh} /></label>
          <label><b>{t.details} <small className="cm-muted">({desc.length}/2000)</small></b>
            <textarea value={desc} maxLength={2000} rows={4} onChange={e => setDesc(e.target.value)} placeholder={t.detailsPh} /></label>
          <div><b className="cm-lab" id="cm-sev-lab">{t.howSerious}</b>
            <div className="cm-seg" role="radiogroup" aria-labelledby="cm-sev-lab" onKeyDown={e => radioKeys(e, SEVERITIES, sev, v => setSev(v as Severity))}>
              {SEVERITIES.map(s => <button key={s} type="button" role="radio" aria-checked={sev === s} tabIndex={sev === s ? 0 : -1}
                className={'cm-sev ' + s + (sev === s ? ' on' : '')} onClick={() => setSev(s)}>{t.sev[s]}</button>)}</div>
          </div>
        </div>
      </div>

      <div className="card cm-card cm-locc">
        <h2 className="t">{t.s2} <span className="cm-muted">{t.clickMap}</span></h2>
        <div className="cm-body">
          <div className="cm-map cm-map-sm" role="application" aria-label={t.mapLabel}><CMap points={pts} pin={loc} onMapClick={pick} focus={loc} /></div>
          <div className="cm-row">
            <button type="button" className="btn" onClick={geolocate} disabled={geoBusy}>{geoBusy ? t.locating : t.useLoc}</button>
            <span className="cm-mono" aria-live="polite">{loc ? <><span className="cm-sr">{t.locSet}: </span>{loc.lat.toFixed(5)}, {loc.lon.toFixed(5)}</> : t.noLoc}</span>
          </div>
          <label><b>{t.landmark}</b><input value={landmark} maxLength={200} onChange={e => setLandmark(e.target.value)} placeholder={t.landmarkPh} /></label>
          {dupes.length > 0 && (
            <div className="cm-dupes" data-testid="dupes">
              <h3 className="cm-sub">{t.dupesH}</h3>
              <p className="cm-muted">{t.dupesP}</p>
              {dupes.map(d => (
                <div key={d.id} className="cm-dupe">
                  <div><b>{d.title}</b><small>{d.id} · {label(d.status)} · {d.distance_m} m · {ago(d.created_at)}</small></div>
                  <button className="btn" disabled={d.id in voted} aria-label={`${t.upvote}: ${d.title}`} onClick={() => upvote(d.id)}>▲ {voted[d.id] ?? d.upvotes}{d.id in voted ? ' ✓' : ''}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card cm-card cm-photoc">
        <h2 className="t">{t.s3} <span className="cm-muted">{t.optional}</span></h2>
        <div className="cm-body">
          <div className={'cm-drop' + (drag ? ' drag' : '')} role="button" tabIndex={0} onClick={() => fileIn.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.current?.click(); } }}
            onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
            {t.drop} <u>{t.browse}</u><small>{t.dropHint(MAX_MB, MAX_PHOTOS)}</small>
            <input ref={fileIn} type="file" accept={OK_TYPES.join(',')} multiple hidden tabIndex={-1} data-testid="photo-input"
              onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
          </div>
          {photos.length > 0 && <div className="cm-thumbs">{photos.map((p, i) => (
            <div key={p.url} className="cm-thumb"><img src={p.url} alt={t.photoAlt(i + 1, photos.length, p.file.name)} /><button type="button" aria-label={t.removePhoto(i + 1)} onClick={() => removePhoto(i)}>×</button></div>
          ))}</div>}
          <div className="cm-grid2">
            <label><b>{t.name}</b><input value={name} maxLength={80} autoComplete="name" onChange={e => setName(e.target.value)} /></label>
            <label><b>{t.mobile}</b><input value={phone} maxLength={16} inputMode="tel" autoComplete="tel" aria-invalid={!phoneOk} onChange={e => setPhone(e.target.value)} placeholder="98XXXXXXXX" className={phoneOk ? '' : 'bad'} /></label>
          </div>
          {contactGiven && <label className="cm-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
            {t.consent}</label>}
          <div className="cm-summary">
            {cat && <span><span aria-hidden="true">{catOf(cat).icon}</span> {catName(cat)}</span>}<span className={'cm-sev ' + sev + ' on'}>{t.sev[sev]}</span>
            {photos.length > 0 && <span>{t.photos(photos.length)}</span>}
          </div>
          {msg && <div className="cm-err" role="alert">{msg}</div>}
          {online === false && <div className="cm-err" role="alert">{t.apiOff}</div>}
          {progress !== null && <div className="cm-prog" role="progressbar" aria-label={t.uploading} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
          <button className="run cm-submit" onClick={submit} disabled={progress !== null || online === false}>
            {progress !== null ? `${t.uploading} ${Math.round(progress * 100)}%` : t.submit}</button>
          {problems.length > 0 && <small className="cm-muted" aria-live="polite">{t.toSubmit}: {problems.join(' · ')}</small>}
        </div>
      </div>
    </div>
  );
}
