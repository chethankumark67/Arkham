import { useStore } from '../store';

export default function Hero() {
  const hero = useStore(s => s.hero);
  const setHero = useStore(s => s.setHero);
  return (
    <section id="hero" className={hero ? '' : 'off'}>
      <video className="hero-video" autoPlay muted loop playsInline preload="auto" aria-hidden="true" src="/arkham-intro.mp4" />
      <div className="hero-scrim" aria-hidden="true" />
      <div className="hero-content">
        <h1>ARKHAM</h1>
        <p>City-scale digital twin for hazard prediction and urban resilience — Bengaluru</p>
        <button id="go" type="button" onClick={() => { setHero(false); setTimeout(() => window.dispatchEvent(new Event('resize')), 60); }}>Get started</button>
        <div className="foot">SYNTHETIC DEMO ENVIRONMENT · BENGALURU, INDIA</div>
      </div>
    </section>
  );
}
