/* Overview & Digital Twin (<main id="twin">): port of the legacy overview incl. backend overrides and the live map. */
import { StaticMap, Thumbs } from './overview/StaticMap';
import LiveMap from './overview/LiveMap';
import { Actions, Controls, ForecastChart, Gauges, Impact, Kpis, PlayButton, TabsCard } from './overview/Panels';

export default function OverviewView() {
  return (
    <main id="twin">
      <Kpis />
      <div className="card mapc">
        <StaticMap />
        <Gauges />
        <div className="ov" style={{ left: 10, bottom: 10 }}>0 &nbsp;&nbsp;0.5 &nbsp;&nbsp;1.0 km · click map to query a point</div>
        <LiveMap />
      </div>
      <div className="bot">
        <div className="card"><div className="t">Forecast &amp; ensemble <span className="tg M">Modelled</span></div><ForecastChart /></div>
        <div className="card"><div className="t">Progression (simulation)<PlayButton /></div><Thumbs /></div>
        <div className="card" style={{ overflow: 'auto' }}><div className="t">Recommended actions</div><Actions /></div>
      </div>
      <div className="side">
        <Controls />
        <div className="card"><div className="t">Impact summary <span className="tg M">Modelled</span></div><Impact /></div>
        <TabsCard />
      </div>
    </main>
  );
}
