import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Hero from './components/Hero';
import Header from './components/Header';
import OverviewView from './views/OverviewView';
import ModellingView from './views/ModellingView';
import ResponseView from './views/ResponseView';
import DomainsView from './views/DomainsView';
import ImpactView from './views/ImpactView';
import ReportModal from './views/ReportModal';
import CrimeView from './views/CrimeView';
import ComplaintsView from './views/ComplaintsView';
import { HZ, S, selectedDomain } from './engine';
import { useStore, useTick } from './store';
import { connect } from './backend';

export default function App() {
  useTick();
  const view = useStore(s => s.view);
  useEffect(() => { connect(); }, []);
  const scenario = view === 0 ? HZ[S.hz].s : view === 1 ? 'Multi-hazard' : view === 2 ? 'Response planning' : view === 3 ? selectedDomain().scenario : view === 4 ? 'Impact analysis' : view === 5 ? 'Crime intelligence' : 'Citizen reports';
  return (
    <>
      <Hero />
      <div id="app">
        <Header scenario={scenario} />
        {view === 0 && <OverviewView />}
        {view === 1 && <ModellingView />}
        {view === 2 && <ResponseView />}
        {view === 3 && <DomainsView />}
        {view === 4 && <ImpactView />}
        {view === 5 && <CrimeView />}
        {view === 6 && <ComplaintsView />}
      </div>
      {createPortal(<ReportModal />, document.body)}
    </>
  );
}
