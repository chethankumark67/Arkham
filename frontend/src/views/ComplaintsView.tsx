/* Citizen Reports: citizens lodge complaints with details + photos; officials triage them on a board. */
import { useCallback, useEffect, useState } from 'react';
import ReportForm from './complaints/ReportForm';
import Board from './complaints/Board';
import { cApi } from './complaints/api';
import { useLang } from './complaints/i18n';
import './complaints.css';

export default function ComplaintsView() {
  const [tab, setTab] = useState<'report' | 'board'>('report');
  const [online, setOnline] = useState<boolean | null>(null);
  const check = useCallback(() => { cApi.stats().then(() => setOnline(true)).catch(() => setOnline(false)); }, []);
  useEffect(check, [check]);
  const onOffline = useCallback((b: boolean) => setOnline(!b), []);
  const [lang, t, setLang] = useLang();
  // Tabs follow the WAI-ARIA pattern: arrow keys move between them.
  const tabKey = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = tab === 'report' ? 'board' : 'report';
    setTab(next); document.getElementById('cm-tab-' + next)?.focus();
  };
  return (
    <main id="complaints" lang={lang === 'kn' ? 'kn' : 'en'}>
      <div className="card cm-card cm-head">
        <div><h1 className="cm-title">{t.title}</h1><div className="cm-muted">{t.subtitle}</div></div>
        <div className="cm-tabs" role="tablist" aria-label={t.title}>
          {(['report', 'board'] as const).map(k => (
            <button key={k} id={'cm-tab-' + k} role="tab" aria-selected={tab === k} aria-controls="cm-panel" tabIndex={tab === k ? 0 : -1}
              className={tab === k ? 'on' : ''} onClick={() => setTab(k)} onKeyDown={tabKey}>{k === 'report' ? t.tabReport : t.tabBoard}</button>
          ))}
        </div>
        <button type="button" className="btn cm-lang" lang={lang === 'kn' ? 'en' : 'kn'} aria-label={t.langToggleLabel}
          onClick={() => setLang(lang === 'kn' ? 'en' : 'kn')}>{t.langToggle}</button>
        <span className={'cm-pill ' + (online ? 'ok' : online === false ? 'off' : '')} role="status">{online ? t.online : online === false ? t.offline : t.checking}
          {online === false && <button className="btn" onClick={check}>{t.retry}</button>}</span>
      </div>
      <div id="cm-panel" role="tabpanel" aria-labelledby={'cm-tab-' + tab}>
        {tab === 'report' ? <ReportForm online={online} /> : <Board online={online} onOffline={onOffline} />}
      </div>
    </main>
  );
}
