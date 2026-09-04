import { useState, type ReactNode, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import LogoMark from '../components/LogoMark';

const P = {
  bg: '#000', card: '#0f0f1c', bg2: '#0a0a14', border: '#1c1c2e', border2: '#2a2a42',
  text: '#f3f1fb', muted: '#a49ec4', dim: '#6d6790', violet: '#7c5cfc', violet2: '#8878ff', violetD: '#4a2fd0', green: '#2fd39b', blue: '#4b9bff',
};
const PLAT: Record<string, string> = { Meta: '#1877f2', 'Google Ads': '#ea9e34', Instagram: '#e1306c', TikTok: '#25d0c0' };

// Imágenes del cliente (2–9, 11). El Hero (1) es propio; la 10 es Precios.
const SECTIONS: { n: number; label: string }[] = [
  { n: 2, label: 'Problema' }, { n: 3, label: 'Cómo funciona' }, { n: 4, label: 'Inteligencia' },
  { n: 5, label: 'Generación de creativos' }, { n: 6, label: 'Resultados' }, { n: 7, label: 'Integraciones' },
  { n: 8, label: 'Beneficios' }, { n: 9, label: 'Testimonios' },
];

const PLANS = [
  { name: 'Starter', price: 19, cr: 100, feats: ['100 créditos por mes', 'Imágenes y copy con IA', 'Soporte por email'], featured: false },
  { name: 'Pro', price: 39, cr: 250, feats: ['250 créditos por mes', 'Video y UGC con IA', 'Campañas completas'], featured: true },
  { name: 'Business', price: 79, cr: 600, feats: ['600 créditos por mes', 'Todo lo de Pro', 'Prioridad de generación'], featured: false },
];

const btnPrimary: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, background: `linear-gradient(135deg,${P.violet},${P.violetD})`, color: '#fff', border: 'none', borderRadius: 12, padding: '11px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' };
const btnGhost: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.05)', color: P.text, border: `1px solid ${P.border2}`, borderRadius: 12, padding: '11px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' };

function Logo({ size = 30 }: { size?: number }) {
  return <LogoMark size={size} />;
}
function Area() {
  const line = 'M0,86 C34,74 52,84 78,64 C104,46 120,58 150,42 C180,28 200,36 232,26 C262,17 282,22 320,10';
  return (
    <svg viewBox="0 0 320 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs><linearGradient id="lpag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={P.violet} stopOpacity=".34" /><stop offset="1" stopColor={P.violet} stopOpacity="0" /></linearGradient></defs>
      <path d={line + ' L320,100 L0,100 Z'} fill="url(#lpag)" />
      <path d={line} fill="none" stroke={P.violet} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="150" cy="42" r="4.5" fill="#fff" stroke={P.violet} strokeWidth="2.5" />
    </svg>
  );
}
function KPI({ label, value, delta }: { label: string; value: string; delta: string }) {
  return <div style={{ background: P.bg2, border: `1px solid ${P.border}`, borderRadius: 12, padding: '11px 13px' }}><div style={{ fontSize: 10.5, color: P.dim }}>{label}</div><div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18 }}>{value}</div><div style={{ fontSize: 10.5, color: P.green }}>↑ {delta}</div></div>;
}
const RAIL = ['Inicio', 'Resumen', 'Campañas', 'Anuncios', 'Creativos', 'Reportes', 'Audiencias', 'Configuración'];
function HeroDash() {
  return (
    <div style={{ background: P.card, border: `1px solid ${P.border2}`, borderRadius: 18, overflow: 'hidden', boxShadow: '0 40px 90px -50px #000', display: 'flex', minHeight: 300 }}>
      <div style={{ width: 132, flexShrink: 0, borderRight: `1px solid ${P.border}`, padding: '14px 9px', background: P.bg2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 5px 13px' }}><Logo size={20} /><span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12 }}>CONVERSIA</span></div>
        {RAIL.map(r => <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 8, fontSize: 11, marginBottom: 2, color: r === 'Resumen' ? P.text : P.dim, background: r === 'Resumen' ? `${P.violet}22` : 'transparent', fontWeight: r === 'Resumen' ? 700 : 500 }}><span style={{ width: 5, height: 5, borderRadius: 2, background: r === 'Resumen' ? P.violet : P.border2 }} />{r}</div>)}
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: 15 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}><div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14 }}>Rendimiento general</div><div style={{ fontSize: 11, color: P.muted, border: `1px solid ${P.border}`, borderRadius: 8, padding: '5px 10px' }}>Últimos 7 días ▾</div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
          <KPI label="Gasto total" value="$1.297" delta="12%" /><KPI label="Ventas" value="147" delta="21%" /><KPI label="ROAS" value="4,1x" delta="18%" /><KPI label="CPA medio" value="$6,7k" delta="8%" />
        </div>
        <div style={{ background: P.bg2, border: `1px solid ${P.border}`, borderRadius: 12, padding: 12, marginBottom: 12 }}><div style={{ fontSize: 11.5, color: P.muted, marginBottom: 6 }}>Ingresos generados · <b style={{ color: P.text }}>$11,4K</b></div><div style={{ height: 108 }}><Area /></div></div>
        <div style={{ background: P.bg2, border: `1px solid ${P.border}`, borderRadius: 12, padding: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>{[['Meta', '42%'], ['Google Ads', '28%'], ['Instagram', '20%'], ['TikTok', '10%']].map(([n, p]) => <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}><span style={{ width: 15, height: 15, borderRadius: 5, background: PLAT[n] ?? P.violet }} />{n}<b style={{ color: P.muted }}>{p}</b></div>)}</div>
      </div>
    </div>
  );
}
function Tag({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="lp-tag" style={{ position: 'absolute', display: 'flex', alignItems: 'center', gap: 7, background: '#14121f', border: `1px solid ${P.border2}`, borderRadius: 11, padding: '9px 13px', fontSize: 12.5, fontWeight: 600, color: P.text, boxShadow: '0 16px 34px -18px #000', ...style }}>{children}</div>;
}

function Hero({ toRegister, toLogin, go }: { toRegister: () => void; toLogin: () => void; go: (id: string) => void }) {
  return (
    <section style={{ position: 'relative', overflow: 'hidden', padding: 'clamp(16px,3vw,32px) clamp(16px,4vw,40px) 20px' }}>
      <div style={{ position: 'absolute', top: -180, right: -120, width: 600, height: 600, background: `radial-gradient(circle,${P.violet}22,transparent 62%)`, filter: 'blur(20px)', pointerEvents: 'none' }} />
      <div style={{ maxWidth: 1240, margin: '0 auto', position: 'relative', zIndex: 2 }}>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 'clamp(24px,4vw,56px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Logo /><span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20 }}>CONVERSIA</span></div>
          <div style={{ display: 'flex', gap: 22, marginLeft: 12 }} className="lp-navlinks">
            {[['Producto', 'sec-8'], ['Cómo funciona', 'sec-3'], ['Resultados', 'sec-6'], ['Precios', 'sec-10']].map(([l, a]) => <button key={l} onClick={() => go(a)} style={{ background: 'none', border: 'none', color: P.muted, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>)}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}><button onClick={toLogin} style={btnGhost}>Iniciar sesión</button><button onClick={toRegister} style={btnPrimary}>Empezar gratis</button></div>
        </nav>
        <div style={{ display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 40, alignItems: 'center' }} className="lp-hero">
          <div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: P.violet2, background: `${P.violet}1c`, border: `1px solid ${P.violet}3a`, borderRadius: 999, padding: '7px 15px' }}>🚀 La plataforma para tu publicidad</span>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.05, fontSize: 'clamp(30px,4.2vw,50px)', color: P.text, margin: '20px 0 18px' }}>Tu próximo cliente no debería depender de horas de trabajo. <span style={{ color: P.violet2 }}>Dejá que la IA cree, publique y optimice tus campañas.</span></h1>
            <p style={{ color: P.muted, fontSize: 17, lineHeight: 1.6, margin: '0 0 26px', maxWidth: 520 }}>Subí tu producto. Creá una campaña en 2 minutos. Conversia se encarga de todo el trabajo pesado: desde los creativos y copys hasta la segmentación y el análisis.</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
              <button onClick={toRegister} style={{ ...btnPrimary, padding: '15px 26px', fontSize: 15.5, boxShadow: `0 14px 34px -12px ${P.violet}aa` }}>Empezar gratis →</button>
              <button onClick={() => go('sec-3')} style={{ ...btnGhost, padding: '15px 24px', fontSize: 15.5 }}>Ver cómo funciona</button>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>{['Sin tarjeta de crédito', 'Configuración en minutos', 'Control total de tu gasto'].map(c => <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: P.muted }}><span style={{ color: P.green }}>✓</span>{c}</span>)}</div>
          </div>
          <div style={{ position: 'relative' }} className="lp-herovis">
            <HeroDash />
            <Tag style={{ top: -14, left: 18 }}>🎯 Audiencia lograda</Tag>
            <Tag style={{ bottom: 64, left: -18 }}>📣 +4 creativos publicados</Tag>
            <Tag style={{ bottom: 6, right: 26 }}>✅ Optimización con IA habilitada</Tag>
            <Tag style={{ top: '46%', right: -20 }}>📈 Reportes generados</Tag>
          </div>
        </div>
      </div>
    </section>
  );
}

function Pricing({ onRegister }: { onRegister: () => void }) {
  return (
    <section id="sec-10" style={{ padding: 'clamp(24px,4vw,50px) 0' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '0 clamp(16px,4vw,40px)' }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, letterSpacing: '.2em', color: P.dim, margin: '0 0 16px' }}>SECTION 10 — PRECIOS</div>
        <div style={{ background: 'linear-gradient(180deg,#0b0b15,#070710)', border: `1px solid #18182a`, borderRadius: 30, padding: 'clamp(28px,4vw,56px)' }}>
          <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 'clamp(28px,4vw,44px)', color: '#fff', margin: '0 0 8px', textAlign: 'center', letterSpacing: '-.02em' }}>Precios simples. Sin sorpresas.</h2>
          <p style={{ color: P.muted, fontSize: 16, textAlign: 'center', margin: '0 0 38px' }}>Elegí el plan que se ajusta a tu negocio. Cancelás cuando quieras.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 18, maxWidth: 920, margin: '0 auto' }}>
            {PLANS.map(p => (
              <div key={p.name} style={{ position: 'relative', background: p.featured ? 'linear-gradient(180deg,#1a1436,#0f0b1e)' : P.card, border: `1px solid ${p.featured ? P.violet : P.border}`, borderRadius: 18, padding: '28px 22px', boxShadow: p.featured ? '0 0 44px -12px rgba(124,92,252,.6)' : 'none' }}>
                {p.featured && <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: P.violet, color: '#fff', fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', borderRadius: 999, padding: '4px 12px', whiteSpace: 'nowrap' }}>MÁS ELEGIDO</div>}
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 18, color: '#fff' }}>{p.name}</div>
                <div style={{ margin: '10px 0 3px' }}><span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 42, color: '#fff' }}>${p.price}</span><span style={{ color: P.muted, fontSize: 14 }}> USD/mes</span></div>
                <div style={{ fontSize: 13, color: P.violet2, marginBottom: 18 }}>{p.cr} créditos por mes</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>{p.feats.map(f => <div key={f} style={{ display: 'flex', gap: 8, fontSize: 13.5, color: '#c8c4de' }}><span style={{ color: P.green }}>✓</span>{f}</div>)}</div>
                <button onClick={onRegister} style={{ width: '100%', background: p.featured ? `linear-gradient(135deg,${P.violet},${P.violetD})` : 'rgba(255,255,255,.06)', color: '#fff', border: p.featured ? 'none' : `1px solid ${P.border2}`, borderRadius: 11, padding: '12px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Empezar</button>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', color: P.dim, fontSize: 13, marginTop: 26, lineHeight: 1.6 }}>También podés cargar <b style={{ color: P.muted }}>packs de créditos</b> por transferencia (50 → US$9 · 150 → US$25 · 500 → US$70 · 1000 → US$120). El plan gratis incluye <b style={{ color: P.muted }}>2 imágenes</b> para probar.</p>
        </div>
      </div>
    </section>
  );
}

function SectionImg({ n, label }: { n: number; label: string }) {
  const [stage, setStage] = useState(0);
  if (stage >= 2) return <div id={`sec-${n}`} style={{ margin: '0 auto', maxWidth: 1320, border: `1.5px dashed ${P.border2}`, borderRadius: 16, padding: '48px 20px', textAlign: 'center', color: P.muted, background: P.bg2 }}><div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, letterSpacing: '.14em', color: P.dim, marginBottom: 10 }}>SECCIÓN {n} — {label.toUpperCase()}</div><div style={{ fontSize: 15 }}>Guardá tu imagen como <b style={{ color: P.violet2 }}>public/landing/section-{n}.png</b></div></div>;
  return <img id={`sec-${n}`} src={`/landing/section-${n}.${stage === 0 ? 'png' : 'jpg'}`} alt={label} loading="lazy" onError={() => setStage(s => s + 1)} style={{ display: 'block', width: '100%' }} />;
}

export default function LandingPage() {
  const navigate = useNavigate();
  const toRegister = () => navigate('/auth', { state: { tab: 'register' } });
  const toLogin = () => navigate('/auth', { state: { tab: 'login' } });
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  return (
    <div style={{ background: P.bg, minHeight: '100vh', color: P.text, fontFamily: "'Inter',system-ui,sans-serif", overflowX: 'hidden' }}>
      <style>{`
        @media (max-width:860px){ .lp-hero{grid-template-columns:1fr !important} .lp-navlinks{display:none !important} .lp-tag{display:none !important} }
        html{scroll-behavior:smooth}
      `}</style>
      <Hero toRegister={toRegister} toLogin={toLogin} go={go} />
      <div style={{ maxWidth: 1320, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0 40px' }}>
        {SECTIONS.map(s => <SectionImg key={s.n} n={s.n} label={s.label} />)}
        <Pricing onRegister={toRegister} />
        <SectionImg n={11} label="Gracias" />
      </div>
      <button onClick={toRegister} style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 50, ...btnPrimary, padding: '14px 22px', fontSize: 15, boxShadow: '0 16px 34px -12px #000' }}>Empezar gratis →</button>
    </div>
  );
}
