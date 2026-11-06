import { useStore } from '../../store';
/** Legacy dbtn(k): Dispatch button that turns into "Sent ✓" (remembered in the store). */
export default function Dbtn({ k }: { k: string }) {
  const sent = useStore(s => s.sent.has(k));
  const dispatch = useStore(s => s.dispatch);
  return sent ? <button className="btn ok">Sent ✓</button> : <button className="btn" onClick={() => dispatch(k)}>Dispatch</button>;
}
