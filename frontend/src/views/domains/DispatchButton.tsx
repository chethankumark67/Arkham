import { useStore } from '../../store';
/** Legacy dbtn(k): Dispatch → "Sent ✓". */
export default function DispatchButton({ k }: { k: string }) {
  const sent = useStore(s => s.sent.has(k));
  const dispatch = useStore(s => s.dispatch);
  return sent ? <button className="btn ok">Sent ✓</button> : <button className="btn" onClick={() => dispatch(k)}>Dispatch</button>;
}
