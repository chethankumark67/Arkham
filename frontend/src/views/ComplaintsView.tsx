/* Citizen Reports: citizens lodge complaints with details + photos; officials triage them on a board. */
import { useCallback, useEffect, useState } from 'react';
import ReportForm from './complaints/ReportForm';
import Board from './complaints/Board';
import { cApi } from './complaints/api';
import './complaints.css';

export default function ComplaintsView() {
  const [tab, setTab] = useState<'report' | 'board'>('report');
  const [online, setOnline] = useState<boolean | null>(null);
  const check = useCallback(() => { cApi.stats().then(() => setOnline(true)).catch(() => setOnline(false)); }, []);
  useEffect(check, [check]);
  const onOffline = useCallback((b: boolean) => setOnline(!b), []);
  return (
    <main id="complaints">
      <div className="card cm-card cm-head">
        <div><div className="cm-title">Citizen Reports</div><div className="cm-muted">Report civic issues · officials triage and route them to the right agency</div></div>
        <div className="cm-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'report'} className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>Report an issue</button>
          <button role="tab" aria-selected={tab === 'board'} className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>Officials' board</button>
        </div>
        <span className={'cm-pill ' + (online ? 'ok' : online === false ? 'off' : '')}>{online ? 'API online' : online === false ? 'API offline' : 'checking…'}
          {online === false && <button className="btn" onClick={check}>retry</button>}</span>
      </div>
      {tab === 'report' ? <ReportForm online={online} /> : <Board online={online} onOffline={onOffline} />}
    </main>
  );
}
