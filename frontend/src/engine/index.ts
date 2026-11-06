/* Typed entry point for the ported engine. The legacy data structures are heterogeneous tuples, so they are
   exposed as `any` here; components should import from './engine', not './engine/legacy'. */
import * as Legacy from './legacy';
const E: any = Legacy;
export const {
  HZ, LAYERS, NAV, SEEDS, FAC, INT, S, M, D, P, fv, tf, inten, fmtN, BB, CORE, GR, SUBS, TR, ROADS, LAKES, PL, EV, DZ,
  g_, pk, clp, sm, av, mx, cnt, dose, rainE, risk, L, DT, MS, hc, hx, FE, by, MT, PRE, CT, sev, eta, syncLive,
  CN, CE, casc, OWN, plan, DOMAINS, clamp01, selectedDomain, domainRisk, domainMetricText, HOOKS, pad,
} = E;
