import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { C } from '../../styles/theme';
import { Spinner } from '../../components/ui';
import { creativeApi, type Fmt, type ProductInfo, type ImageVariant, type CopyVariant, type Strategy } from '../../api/creative';
import { workspaceApi } from '../../api/workspace';
import { aiCreditsConfig } from '../../config/aiCreditsConfig';
import UgcCampaign from './UgcCampaign';

// ── Catálogos de UI ──────────────────────────────────────────────────────────
const STEPS = ['Producto', 'Objetivo', 'Estilo', 'Imagen', 'Video', 'Copy', 'Resultado'];

const OBJECTIVES = [
  { key: 'vender',      emoji: '🛒', label: 'Vender',            desc: 'Publicidad de conversión' },
  { key: 'promocionar', emoji: '📢', label: 'Promocionar',       desc: 'Oferta o descuento' },
  { key: 'lanzamiento', emoji: '🚀', label: 'Lanzamiento',       desc: 'Producto nuevo' },
  { key: 'clientes',    emoji: '🎯', label: 'Conseguir clientes',desc: 'Generar consultas' },
  { key: 'redes',       emoji: '📱', label: 'Redes sociales',    desc: 'IG / TikTok / FB' },
  { key: 'whatsapp',    emoji: '💬', label: 'WhatsApp',          desc: 'Iniciar conversaciones' },
];

const STYLES = [
  { key: 'auto',        label: '✨ Auto (IA decide)' },
  { key: 'profesional', label: 'Profesional' }, { key: 'premium', label: 'Premium' },
  { key: 'minimalista', label: 'Minimalista' }, { key: 'moderno', label: 'Moderno' },
  { key: 'oferta',      label: 'Oferta agresiva' }, { key: 'ecommerce', label: 'E-commerce' },
  { key: 'social',      label: 'Social Media' }, { key: 'elegante', label: 'Elegante' },
  { key: 'juvenil',     label: 'Juvenil' }, { key: 'tecnologico', label: 'Tecnológico' },
  { key: 'gastronomico',label: 'Gastronómico' }, { key: 'automotriz', label: 'Automotriz' },
  { key: 'retail',      label: 'Retail' },
];

const FORMATS: { key: Fmt; label: string; sub: string }[] = [
  { key: '9:16', label: '9:16', sub: 'Reels / Stories / TikTok' },
  { key: '4:5',  label: '4:5',  sub: 'Feed Instagram' },
  { key: '1:1',  label: '1:1',  sub: 'Feed / Facebook' },
];

const LOADING_MSGS: Record<string, string[]> = {
  analyze:  ['🧠 Analizando características', 'Detectando categoría y público'],
  strategy: ['🎯 Definiendo concepto publicitario', 'Eligiendo el mejor ángulo'],
  images:   ['🎨 Creando 3 creatividades', 'Componiendo imagen y luz', 'Casi listo…'],
  image:    ['🎨 Regenerando variante'],
  video:    ['🎬 Generando video con IA', 'Animando la creatividad', 'Esto puede tardar ~1 min…'],
  ugc:      ['🎭 Eligiendo el creador ideal', '🎨 Generando la persona con el producto', '🎬 Grabando el UGC…'],
  copy:     ['✍️ Escribiendo el anuncio', 'Generando variantes de copy'],
};

const toBase64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file);
});

const money = (v?: string) => (v ? String(v) : '');

function friendly(e: any): string {
  const msg: string = e?.response?.data?.message ?? e?.message ?? '';
  if (/OPENAI/i.test(msg)) return 'Falta configurar OpenAI. Avisá al administrador (no se descontaron créditos).';
  if (/MAGNIFIC/i.test(msg)) return 'No pudimos generar el video (Magnific sin configurar). No se descontaron créditos.';
  if (/timeout/i.test(msg)) return 'La generación tardó demasiado. Probá de nuevo.';
  return 'Hubo un problema con la IA. No se descontaron créditos, probá otra vez.';
}

// ── Estado del studio ────────────────────────────────────────────────────────
interface StudioState {
  imageBase64?: string;         // primera foto (compatibilidad con analyze/video/ugc)
  images?: string[];            // varias fotos del producto (data URLs)
  brief?: string;               // pedido en texto ("tipo catálogo para marketplace")
  product: ProductInfo;
  objective: string;
  style: string;
  strategy?: Strategy;
  format: Fmt;
  variants: ImageVariant[];
  selectedImage?: ImageVariant;
  videoUrl?: string;
  copyVariants: CopyVariant[];
  selectedCopy?: CopyVariant;
  creditsUsed: number;
}
const EMPTY: StudioState = { product: { name: '' }, objective: 'vender', style: 'auto', format: '9:16', images: [], variants: [], copyVariants: [], creditsUsed: 0 };

// Descargar una imagen (URL del backend) como PNG
async function downloadImage(url: string, name: string) {
  try {
    const r = await fetch(url); const b = await r.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name.endsWith('.png') ? name : `${name}.png`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  } catch { window.open(url, '_blank'); }
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AICreativeStudio() {
  const nav = useNavigate();
  const [view, setView] = useState<'launcher' | 'studio' | 'campaign' | 'history'>('launcher');
  const [step, setStep] = useState(1);
  const [s, setS] = useState<StudioState>(EMPTY);
  const patch = (p: Partial<StudioState>) => setS(prev => ({ ...prev, ...p }));
  const patchProduct = (p: Partial<ProductInfo>) => setS(prev => ({ ...prev, product: { ...prev.product, ...p } }));

  // Varias fotos del producto
  const addImages = async (files: FileList | File[]) => {
    const b64s = await Promise.all(Array.from(files).map(toBase64));
    setS(prev => { const images = [...(prev.images ?? []), ...b64s]; return { ...prev, images, imageBase64: images[0] }; });
  };
  const removeImage = (i: number) => setS(prev => { const images = (prev.images ?? []).filter((_, idx) => idx !== i); return { ...prev, images, imageBase64: images[0] }; });

  // Persistencia: restaurar al volver + guardar (sin las fotos base64, pesadas)
  useEffect(() => {
    try { const raw = localStorage.getItem('cv_studio'); if (raw) { const d = JSON.parse(raw); if (d.s) setS(d.s); if (d.view) setView(d.view); if (d.step) setStep(d.step); } } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('cv_studio', JSON.stringify({ s: { ...s, imageBase64: undefined, images: undefined }, view, step })); } catch { /* quota */ }
  }, [s, view, step]);

  const [busy, setBusy] = useState<string | null>(null);       // clave de LOADING_MSGS
  const [err, setErr] = useState<string | null>(null);
  const [noCredits, setNoCredits] = useState(false);
  const [confirm, setConfirm] = useState<null | { cost: number; label: string; run: () => void }>(null);

  const [costs, setCosts] = useState<Record<string, number>>(aiCreditsConfig);
  const [credits, setCredits] = useState<number>(0);
  const [onboard, setOnboard] = useState(false);
  useEffect(() => { try { if (!localStorage.getItem('cv_onboarded')) setOnboard(true); } catch { /* ignore */ } }, []);
  const closeOnboard = () => { try { localStorage.setItem('cv_onboarded', '1'); } catch { /* ignore */ } setOnboard(false); };

  useEffect(() => {
    creativeApi.costs().then(r => { setCosts({ ...aiCreditsConfig, ...r.costs }); setCredits(r.credits); }).catch(() => {});
  }, []);

  const goto = (n: number) => { setErr(null); setStep(n); };
  const reset = () => { setS(EMPTY); setStep(1); setErr(null); };

  // helper: envuelve una acción con estado de carga + manejo de error
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr(null);
    try { await fn(); }
    catch (e: any) {
      const backend = e?.response?.data?.message;
      if (backend === 'SIN_CREDITOS') { setNoCredits(true); }
      else setErr(friendly(e));
    }
    finally { setBusy(null); }
  };

  // Confirmación de gasto de créditos antes de operaciones costosas
  const withConfirm = (cost: number, label: string, fn: () => void) => {
    if (cost <= 0) return fn();
    setConfirm({ cost, label, run: () => { setConfirm(null); fn(); } });
  };

  // ── Acciones IA ─────────────────────────────────────────────────────────────
  const analyze = () => run('analyze', async () => {
    const info = await creativeApi.analyze({ name: s.product.name, description: s.product.description, imageBase64: s.imageBase64 });
    patchProduct({ ...info, name: info.name || s.product.name });
  });

  const buildStrategyAndGo = () => run('strategy', async () => {
    const strat = await creativeApi.strategy({ product: s.product, objective: s.objective, style: s.style });
    patch({ strategy: strat, style: strat.chosenStyle || s.style });
    goto(4);
  });

  const genImages = (quality?: 'standard' | 'premium') => run('images', async () => {
    const r = await creativeApi.images({ product: s.product, objective: s.objective, style: s.strategy?.chosenStyle || s.style, format: s.format, quality, referenceImage: s.imageBase64, referenceImages: s.images, brief: s.brief });
    patch({ variants: r.variants }); setCredits(r.credits);
  });

  const regenImage = (angleKey: string, quality?: 'standard' | 'premium') => run('image', async () => {
    const r = await creativeApi.image({ product: s.product, objective: s.objective, style: s.strategy?.chosenStyle || s.style, format: s.format, angleKey, quality, referenceImage: s.imageBase64, referenceImages: s.images, brief: s.brief });
    setCredits(r.credits);
    patch({ variants: s.variants.map(v => v.key === angleKey ? r.variant : v) });
  });

  const genVideo = (duration: '5' | '10') => run('video', async () => {
    if (!s.selectedImage) return;
    const r = await creativeApi.video({ imageBase64: s.selectedImage.url, product: s.product, style: s.strategy?.chosenStyle || s.style, duration });
    patch({ videoUrl: r.videoUrl }); setCredits(r.credits);
  });

  const genUGC = () => run('ugc', async () => {
    const pick = await creativeApi.ugcAuto({ product: s.product });
    const r = await creativeApi.ugc({ product: s.product, ...pick, duration: '10', referenceImage: s.imageBase64, format: s.format });
    patch({ videoUrl: r.videoUrl, selectedImage: s.selectedImage ?? { key: 'ugc', label: 'UGC', description: r.creator?.name ?? '', prompt: '', url: r.imageUrl, model: '' } });
    setCredits(r.credits);
  });

  const genCopy = () => run('copy', async () => {
    const r = await creativeApi.copy({ product: s.product, objective: s.objective, style: s.strategy?.chosenStyle || s.style });
    patch({ copyVariants: r.variants, selectedCopy: r.variants[0] }); setCredits(r.credits);
  });

  const saveToHistory = async () => {
    try {
      await creativeApi.save({
        name: s.product.name || 'Creativo IA',
        format: s.format,
        type: s.videoUrl ? 'video' : 'image',
        imageUrl: s.selectedImage?.url,
        videoUrl: s.videoUrl,
        studio: { product: s.product, objective: s.objective, style: s.strategy?.chosenStyle || s.style, strategy: s.strategy, copy: s.selectedCopy },
        creditsUsed: s.creditsUsed,
      });
    } catch { /* no crítico */ }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100%', background: C.bg, color: C.text }}>
      <Header credits={credits} view={view} setView={setView} onNew={() => { reset(); setView('studio'); }} />

      {view === 'launcher' ? (
        <Launcher setView={setView} />
      ) : view === 'campaign' ? (
        <UgcCampaign costs={costs} credits={credits} setCredits={setCredits} />
      ) : view === 'history' ? (
        <History />
      ) : (
        <div style={{ display: 'flex', gap: 0, minHeight: 'calc(100vh - 64px)' }}>
          <StepRail step={step} />
          <main style={{ flex: 1, padding: '28px clamp(16px,3vw,40px)', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
            {busy && <LoadingState msgs={LOADING_MSGS[busy] ?? ['Generando…']} />}

            {!busy && err && (
              <Banner tone="red">⚠️ {err}</Banner>
            )}

            {!busy && (
              <>
                {step === 1 && <StepProducto s={s} patch={patch} patchProduct={patchProduct} onAnalyze={analyze} onNext={() => goto(2)} onAddImages={addImages} onRemoveImage={removeImage} />}
                {step === 2 && <StepObjetivo s={s} setObjective={(o: string) => patch({ objective: o })} onBack={() => goto(1)} onNext={() => goto(3)} />}
                {step === 3 && <StepEstilo s={s} setStyle={(st: string) => patch({ style: st })} onBack={() => goto(2)} onNext={buildStrategyAndGo} />}
                {step === 4 && <StepImagen s={s} costs={costs} setFormat={(f: Fmt) => patch({ format: f })} setBrief={(b: string) => patch({ brief: b })} onGen={(q?: 'standard' | 'premium') => withConfirm(costs.imageVariantsSet, 'Generar 3 imágenes', () => genImages(q))} onRegen={(k: string, q?: 'standard' | 'premium') => withConfirm(costs.imageRegen, 'Regenerar imagen', () => regenImage(k, q))} onPick={(v: ImageVariant) => patch({ selectedImage: v })} onDownload={(v: ImageVariant) => downloadImage(v.url, `creativo-${v.key}`)} onBack={() => goto(3)} onNext={() => goto(5)} />}
                {step === 5 && <StepVideo s={s} costs={costs} onGen={(d: '5' | '10') => withConfirm(d === '10' ? costs.video10 : costs.video5, `Generar video ${d}s`, () => genVideo(d))} onUGC={() => withConfirm(costs.ugc_video_10 ?? 10, 'Generar UGC (persona IA)', genUGC)} onBack={() => goto(4)} onNext={() => goto(6)} />}
                {step === 6 && <StepCopy s={s} costs={costs} onGen={() => withConfirm(costs.copy, 'Generar copy', genCopy)} onPick={(c: CopyVariant) => patch({ selectedCopy: c })} onBack={() => goto(5)} onNext={() => { saveToHistory(); goto(7); }} />}
                {step === 7 && <StepResultado s={s} onRegenImage={() => goto(4)} onRegenVideo={() => goto(5)} onRegenCopy={genCopy} onCampaign={() => nav('/dashboard/new-campaign')} onNew={reset} />}
              </>
            )}
          </main>
        </div>
      )}

      {confirm && (
        <Overlay onClose={() => setConfirm(null)}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 8 }}>{confirm.label}</div>
          <p style={{ color: C.textMuted, fontSize: 14, marginBottom: 6 }}>Esta generación utilizará <b style={{ color: C.accent }}>{confirm.cost} créditos</b>.</p>
          <p style={{ color: C.textDim, fontSize: 12, marginBottom: 18 }}>Tenés {credits} créditos disponibles.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Btn ghost onClick={() => setConfirm(null)}>Cancelar</Btn>
            <Btn onClick={confirm.run}>Generar</Btn>
          </div>
        </Overlay>
      )}

      {onboard && (
        <Overlay onClose={closeOnboard}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>👋</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20, marginBottom: 10 }}>Bienvenido al AI Creative Studio</div>
          <ol style={{ color: C.textMuted, fontSize: 14, paddingLeft: 20, margin: '0 0 18px', lineHeight: 1.8 }}>
            <li>Subí tu producto (foto y/o datos).</li>
            <li>Elegí objetivo y estilo.</li>
            <li>La IA genera imagen, video/UGC y copy.</li>
            <li>Descargá o creá tu campaña.</li>
          </ol>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Btn onClick={closeOnboard}>Empezar →</Btn></div>
        </Overlay>
      )}

      {noCredits && (
        <Overlay onClose={() => setNoCredits(false)}>
          <div style={{ fontSize: 34, marginBottom: 6 }}>🪫</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Te quedaste sin créditos</div>
          <p style={{ color: C.textMuted, fontSize: 14, marginBottom: 18 }}>No se descontó nada. Recargá para seguir generando con IA.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Btn ghost onClick={() => setNoCredits(false)}>Cerrar</Btn>
            <Btn onClick={() => { setNoCredits(false); nav('/dashboard/billing'); }}>Comprar créditos</Btn>
          </div>
        </Overlay>
      )}
    </div>
  );
}

// ── Launcher (inicio de la sección) ──────────────────────────────────────────
function ModePreview({ kind }: { kind: 'nodes' | 'wizard' | 'library' }) {
  if (kind === 'nodes') return (
    <svg viewBox="0 0 260 120" style={{ width: '100%', height: '100%' }}>
      <defs><linearGradient id="mn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b6bff" /><stop offset="1" stopColor="#4a2fd0" /></linearGradient></defs>
      <path d="M58 60 C 95 60, 95 34, 132 34" stroke="#ffffff55" fill="none" strokeWidth="2" />
      <path d="M58 60 C 95 60, 95 86, 132 86" stroke="#ffffff55" fill="none" strokeWidth="2" />
      <path d="M188 34 C 210 34, 210 60, 232 60" stroke="#ffffff55" fill="none" strokeWidth="2" />
      <path d="M188 86 C 210 86, 210 60, 232 60" stroke="#ffffff55" fill="none" strokeWidth="2" />
      <rect x="20" y="46" width="38" height="28" rx="7" fill="#ffffffcc" />
      <rect x="132" y="20" width="56" height="28" rx="7" fill="#ffffffee" />
      <rect x="132" y="72" width="56" height="28" rx="7" fill="#ffffffcc" />
      <rect x="220" y="46" width="24" height="28" rx="7" fill="url(#mn)" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
  if (kind === 'wizard') return (
    <svg viewBox="0 0 260 120" style={{ width: '100%', height: '100%' }}>
      {[0, 1, 2, 3].map(i => (<g key={i}><circle cx={40 + i * 60} cy={40} r="14" fill={i === 0 ? '#fff' : '#ffffff55'} /><text x={40 + i * 60} y={45} textAnchor="middle" fontSize="13" fontWeight="700" fill={i === 0 ? '#2b6fd0' : '#fff'}>{i + 1}</text>{i < 3 && <line x1={54 + i * 60} y1={40} x2={86 + i * 60} y2={40} stroke="#ffffff55" strokeWidth="2" />}</g>))}
      <rect x="26" y="72" width="208" height="12" rx="6" fill="#ffffff33" /><rect x="26" y="72" width="70" height="12" rx="6" fill="#fff" />
      <rect x="26" y="92" width="150" height="10" rx="5" fill="#ffffff22" />
    </svg>
  );
  return (
    <svg viewBox="0 0 260 120" style={{ width: '100%', height: '100%' }}>
      <rect x="120" y="30" width="120" height="78" rx="12" fill="#ffffff22" stroke="#ffffff44" />
      <rect x="40" y="18" width="92" height="66" rx="12" fill="#ffffffe0" />
      <circle cx="66" cy="40" r="9" fill="#ffe08a" />
      <path d="M50 74 L74 50 L92 68 L108 54 L124 74 Z" fill="#7bd8b0" />
      <rect x="150" y="72" width="86" height="40" rx="9" fill="#ffffffcc" />
    </svg>
  );
}

// Ilustración del hero: nodo central → 3 pills (Producto / IA analiza / Creativos listos)
function HeroGraph() {
  const pills: [string, string, number][] = [['📦', 'Producto', 30], ['◎', 'IA analiza', 102], ['▷', 'Creativos listos', 174]];
  return (
    <svg viewBox="0 0 460 240" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9b7cff" /><stop offset="1" stopColor="#5a34e0" /></linearGradient>
        <filter id="hglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <rect x="20" y="104" width="46" height="34" rx="9" fill="#ffffffe6" />
      <path d="M66 121 C 110 121, 120 121, 156 121" stroke="#ffffff40" strokeWidth="2" fill="none" />
      {pills.map(([, , y], i) => <path key={i} d={`M232 121 C 280 121, 280 ${y + 19}, 314 ${y + 19}`} stroke="#ffffff33" strokeWidth="2" fill="none" />)}
      <g filter="url(#hglow)"><rect x="156" y="85" width="76" height="76" rx="20" fill="url(#hg)" /></g>
      <text x="194" y="133" textAnchor="middle" fontSize="30">✨</text>
      {pills.map(([ic, l, y], i) => (
        <g key={i}>
          <rect x="314" y={y} width="138" height="38" rx="11" fill="#171331" stroke="#ffffff26" />
          <text x="332" y={y + 24} fontSize="15">{ic}</text>
          <text x="352" y={y + 24} fontSize="13.5" fill="#e9e4ff" fontWeight="600">{l}</text>
        </g>
      ))}
    </svg>
  );
}

function Launcher({ setView }: { setView: (v: 'launcher' | 'studio' | 'campaign' | 'history') => void }) {
  const [gallery, setGallery] = useState<any[]>([]);
  useEffect(() => { creativeApi.list().then(l => setGallery(l.slice(0, 5))).catch(() => {}); }, []);
  const MODES = [
    { key: 'campaign' as const, kind: 'nodes' as const, title: 'Campaña UGC con Copiloto', desc: 'El agente planifica y arma los nodos. Ejecutás en el canvas y ensamblás el video final.', tag: 'Nodos + IA', cta: 'Empezar', grad: 'linear-gradient(135deg,#7c5cfc,#4a2fd0)' },
    { key: 'studio' as const, kind: 'wizard' as const, title: 'Studio por pasos', desc: 'Asistente guiado: producto → objetivo → estilo → imagen → video → copy.', tag: 'Wizard', cta: 'Empezar', grad: 'linear-gradient(135deg,#3f7fe0,#2350b8)' },
    { key: 'history' as const, kind: 'library' as const, title: 'Mis creativos', desc: 'Tu biblioteca de imágenes y videos, con filtros y favoritos.', tag: 'Biblioteca', cta: 'Explorar', grad: 'linear-gradient(135deg,#12a97a,#0a7d59)' },
  ];
  return (
    <div style={{ padding: '24px clamp(16px,3vw,44px)', maxWidth: 1280, margin: '0 auto' }}>
      {/* Hero */}
      <div className="cv-fade-in" style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, padding: 'clamp(26px,3.4vw,44px)', marginBottom: 30, background: 'linear-gradient(120deg,#171232 0%,#120d26 55%,#0d0a1c 100%)', border: '1px solid #241c46' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 120% at 92% 20%, #6d4bd633, transparent 60%), radial-gradient(50% 80% at 0% 0%, #4a2fd022, transparent 60%)' }} />
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 360px', minWidth: 280 }}>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 'clamp(26px,3.6vw,40px)', color: '#fff', lineHeight: 1.05, margin: '0 0 12px', letterSpacing: -0.6 }}>Creá tu campaña<br /><span style={{ color: '#a78bfa' }}>publicitaria con IA</span></h1>
            <p style={{ color: 'rgba(255,255,255,.72)', fontSize: 15, margin: '0 0 22px', lineHeight: 1.55, maxWidth: 460 }}>Elegí cómo trabajar: dejá que el Copiloto arme los nodos por vos, o seguí el asistente paso a paso.</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <button onClick={() => setView('campaign')} className="cv-lift" style={{ background: '#fff', color: '#4a2fd0', border: 'none', borderRadius: 12, padding: '13px 24px', fontWeight: 800, fontSize: 14, cursor: 'pointer', boxShadow: '0 12px 28px -10px #000a', display: 'inline-flex', alignItems: 'center', gap: 8 }}>✨ Crear campaña UGC</button>
              <button onClick={() => setView('studio')} style={{ background: 'transparent', color: 'rgba(255,255,255,.9)', border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 30, height: 30, borderRadius: '50%', border: '1.5px solid #ffffff44', display: 'grid', placeItems: 'center', fontSize: 11 }}>▶</span>Ver cómo funciona
              </button>
            </div>
          </div>
          <div style={{ flex: '1 1 340px', minWidth: 280, maxWidth: 520, alignSelf: 'stretch', minHeight: 190 }} className="hero-thumbs"><HeroGraph /></div>
        </div>
      </div>

      {/* Modos */}
      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 19, marginBottom: 16 }}>Empezá una creación</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16, marginBottom: 34 }}>
        {MODES.map(m => (
          <button key={m.key} onClick={() => setView(m.key)} className="cv-lift" style={{ position: 'relative', overflow: 'hidden', textAlign: 'left', cursor: 'pointer', borderRadius: 18, border: '1px solid #ffffff1a', padding: '20px 22px', minHeight: 196, background: m.grad, display: 'flex', flexDirection: 'column' }}>
            <div style={{ position: 'absolute', right: -12, bottom: 6, top: 44, width: '48%', opacity: 0.92, pointerEvents: 'none' }}><ModePreview kind={m.kind} /></div>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', background: 'rgba(0,0,0,.28)', borderRadius: 999, padding: '4px 11px', textTransform: 'uppercase', letterSpacing: 0.6, width: 'fit-content', zIndex: 2 }}>{m.tag}</span>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18, color: '#fff', margin: '16px 0 7px', zIndex: 2, maxWidth: '62%' }}>{m.title}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.82)', lineHeight: 1.5, zIndex: 2, maxWidth: '58%', flex: 1 }}>{m.desc}</div>
            <div style={{ zIndex: 2, marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(4px)', color: '#fff', fontWeight: 700, fontSize: 13, borderRadius: 9, padding: '8px 14px', width: 'fit-content' }}>{m.cta} →</div>
          </button>
        ))}
      </div>

      {/* Tus creativos recientes */}
      {gallery.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 19 }}>Tus creativos recientes</div>
            <button onClick={() => setView('history')} className="cv-lift" style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: 10, padding: '8px 15px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Ver todos →</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 16 }}>
            {gallery.map(it => {
              const isVideo = !!it.video_url;
              const badge = /ugc/i.test(it.type || '') || /ugc/i.test(it.name || '') ? 'UGC' : 'ANUNCIO';
              const date = it.created_at ? new Date(it.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
              return (
                <div key={it.id} onClick={() => setView('history')} className="cv-card cv-thumb" style={{ overflow: 'hidden', cursor: 'pointer', padding: 0 }}>
                  <div style={{ aspectRatio: '16/10', background: '#16162a', overflow: 'hidden', position: 'relative' }}>
                    {isVideo ? <video src={it.video_url} muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : it.output_url ? <img src={it.output_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 26, color: '#3a3a5e' }}>🎨</div>}
                    <span style={{ position: 'absolute', top: 9, left: 9, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, color: '#fff', background: badge === 'UGC' ? 'rgba(124,92,252,.9)' : 'rgba(0,0,0,.55)', borderRadius: 6, padding: '3px 8px' }}>{badge}</span>
                    {isVideo && <span style={{ position: 'absolute', bottom: 9, right: 9, fontSize: 10, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,.6)', borderRadius: 6, padding: '2px 7px' }}>▶</span>}
                  </div>
                  <div style={{ padding: '11px 12px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name || 'Creativo'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                      <span style={{ fontSize: 11.5, color: C.textMuted }}>{date}</span>
                      <span style={{ fontSize: 15, color: C.textDim, lineHeight: 1 }}>⋯</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ credits, view, setView, onNew }: { credits: number; view: string; setView: (v: 'launcher' | 'studio' | 'campaign' | 'history') => void; onNew: () => void }) {
  const TABS: [('launcher' | 'studio' | 'campaign' | 'history'), string][] = [['launcher', 'Inicio'], ['studio', 'Studio'], ['campaign', '🎬 Campaña UGC'], ['history', 'Mis creativos']];
  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px clamp(16px,3vw,40px)', borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.bg, zIndex: 5 }}>
      <div>
        <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: -0.5 }}>AI Creative Studio</div>
        <div style={{ fontSize: 12, color: C.textMuted }}>Subí tu producto → la IA hace todo</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', gap: 4, background: C.surface, borderRadius: 10, padding: 3, border: `1px solid ${C.border}` }}>
          {TABS.map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: view === v ? C.accent : 'transparent', color: view === v ? '#fff' : C.textMuted, whiteSpace: 'nowrap' }}>
              {label}
            </button>
          ))}
        </div>
        <div title="Créditos IA" style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.accentDim, border: `1px solid ${C.borderBright}`, borderRadius: 10, padding: '7px 12px', fontSize: 13, fontWeight: 700, color: C.accent }}>⚡ {credits}</div>
        <Btn onClick={onNew}>+ Crear nuevo</Btn>
      </div>
    </header>
  );
}

// ── Step rail ─────────────────────────────────────────────────────────────────
function StepRail({ step }: { step: number }) {
  return (
    <aside style={{ width: 210, borderRight: `1px solid ${C.border}`, padding: '28px 18px', display: 'flex', flexDirection: 'column', gap: 4 }} className="studio-rail">
      <div style={{ height: 4, background: C.surface2, borderRadius: 4, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(step / STEPS.length) * 100}%`, background: C.grad, transition: 'width .4s ease' }} />
      </div>
      {STEPS.map((label, i) => {
        const n = i + 1, active = n === step, done = n < step;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, background: active ? C.accentDim : 'transparent' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, background: done ? C.gradGreen : active ? C.grad : C.surface2, color: done || active ? '#fff' : C.textMuted }}>{done ? '✓' : n}</div>
            <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? C.text : done ? C.textMuted : C.textDim }}>{label}</span>
          </div>
        );
      })}
    </aside>
  );
}

// ── PASO 1: Producto ──────────────────────────────────────────────────────────
function StepProducto({ s, patchProduct, onAnalyze, onNext, onAddImages, onRemoveImage }: any) {
  const fileRef = useRef<HTMLInputElement>(null);
  const p = s.product as ProductInfo;
  const imgs: string[] = s.images ?? [];
  const canNext = !!(p.name?.trim() || imgs.length);
  return (
    <StepShell title="Contanos del producto" subtitle="Subí una o varias fotos y/o completá los datos. La IA genera en base a TODAS las fotos que subas.">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,320px) 1fr', gap: 22 }} className="prod-grid">
        <div>
          {imgs.length === 0 ? (
            <div onClick={() => fileRef.current?.click()} style={{ aspectRatio: '3/4', borderRadius: 14, border: `1.5px dashed ${C.borderBright}`, background: C.surface, display: 'grid', placeItems: 'center', cursor: 'pointer', overflow: 'hidden' }}>
              <div style={{ textAlign: 'center', color: C.textMuted }}><div style={{ fontSize: 32 }}>📷</div><div style={{ fontSize: 13, marginTop: 8 }}>Subir foto(s) del producto</div><div style={{ fontSize: 11, marginTop: 4 }}>Podés subir varias</div></div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {imgs.map((im, i) => (
                <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}` }}>
                  <img src={im} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <button onClick={() => onRemoveImage(i)} title="Quitar" style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 6, border: 'none', background: '#000a', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>×</button>
                </div>
              ))}
              <button onClick={() => fileRef.current?.click()} style={{ aspectRatio: '1', borderRadius: 10, border: `1.5px dashed ${C.borderBright}`, background: C.surface, color: C.textMuted, cursor: 'pointer', fontSize: 22 }}>+</button>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { if (e.target.files?.length) onAddImages(e.target.files); e.currentTarget.value = ''; }} />
          {imgs.length > 0 && <Btn ghost small style={{ marginTop: 10, width: '100%' }} onClick={onAnalyze}>🧠 Analizar con IA ({imgs.length} foto{imgs.length > 1 ? 's' : ''})</Btn>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Nombre" value={p.name} onChange={v => patchProduct({ name: v })} placeholder="Ej: Zapatillas Nike Air Max" />
          <Field label="Descripción" textarea value={p.description} onChange={v => patchProduct({ description: v })} placeholder="Características, beneficios…" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Field label="Precio" value={money(p.price)} onChange={v => patchProduct({ price: v })} placeholder="$19.999" />
            <Field label="Precio anterior" value={money(p.oldPrice)} onChange={v => patchProduct({ oldPrice: v })} placeholder="$29.999" />
            <Field label="Descuento" value={money(p.discount)} onChange={v => patchProduct({ discount: v })} placeholder="30%" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Categoría" value={p.category} onChange={v => patchProduct({ category: v })} placeholder="Calzado" />
            <Field label="CTA" value={p.cta} onChange={v => patchProduct({ cta: v })} placeholder="Comprá ahora" />
          </div>
          <Field label="Características (separadas por coma)" value={(p.features ?? []).join(', ')} onChange={v => patchProduct({ features: v.split(',').map(x => x.trim()).filter(Boolean) })} placeholder="Liviana, resistente, envío gratis" />
          {!s.imageBase64 && (p.name || p.description) && <Btn ghost small onClick={onAnalyze}>🧠 Completar con IA</Btn>}
        </div>
      </div>
      <NavRow onNext={onNext} nextDisabled={!canNext} nextLabel="Continuar" />
    </StepShell>
  );
}

// ── PASO 2: Objetivo ──────────────────────────────────────────────────────────
function StepObjetivo({ s, setObjective, onBack, onNext }: any) {
  return (
    <StepShell title="¿Qué querés conseguir?" subtitle="La IA adapta el concepto creativo a tu objetivo.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
        {OBJECTIVES.map(o => {
          const sel = s.objective === o.key;
          return (
            <button key={o.key} onClick={() => setObjective(o.key)} style={{ textAlign: 'left', padding: 16, borderRadius: 14, cursor: 'pointer', background: sel ? C.accentDim : C.surface, border: `1.5px solid ${sel ? C.accent : C.border}`, transition: 'all .15s' }}>
              <div style={{ fontSize: 26, marginBottom: 8 }}>{o.emoji}</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{o.label}</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{o.desc}</div>
            </button>
          );
        })}
      </div>
      <NavRow onBack={onBack} onNext={onNext} nextLabel="Continuar" />
    </StepShell>
  );
}

// ── PASO 3: Estilo ────────────────────────────────────────────────────────────
function StepEstilo({ s, setStyle, onBack, onNext }: any) {
  return (
    <StepShell title="Elegí un estilo visual" subtitle="Con “Auto”, la IA decide el mejor estilo según tu producto y objetivo.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
        {STYLES.map(st => {
          const sel = s.style === st.key;
          return (
            <button key={st.key} onClick={() => setStyle(st.key)} style={{ padding: '14px 12px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: sel ? C.accentDim : C.surface, border: `1.5px solid ${sel ? C.accent : C.border}`, color: sel ? C.text : C.textMuted }}>
              {st.label}
            </button>
          );
        })}
      </div>
      <NavRow onBack={onBack} onNext={onNext} nextLabel="Crear estrategia →" />
    </StepShell>
  );
}

// ── PASO 4: Imagen ────────────────────────────────────────────────────────────
function StepImagen({ s, setFormat, setBrief, onGen, onRegen, onPick, onDownload, onBack, onNext }: any) {
  const has = s.variants.length > 0;
  const [hd, setHd] = useState(false);
  const q = hd ? 'premium' : undefined;
  return (
    <StepShell title="Generá la imagen" subtitle={s.strategy?.concept ? `Concepto: ${s.strategy.concept}` : 'La IA crea 3 variantes; elegí la que más te guste.'}>
      {/* Brief: qué imagen querés — texto libre o comandos "/" */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: C.textMuted, display: 'block', marginBottom: 6 }}>¿Cómo querés la imagen? <span style={{ color: C.textDim }}>(texto libre o comandos <b style={{ color: C.accent }}>/</b>)</span></label>
        <input value={s.brief ?? ''} onChange={e => setBrief(e.target.value)} placeholder="Ej: /product /ad /appetite /studio /white  —  o: 'tipo catálogo para marketplace'"
          style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 13px', color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
          {['/product', '/ad', '/hero', '/appetite', '/studio', '/premium', '/white', '/closeup', '/hyperreal', '/scroll-stopping'].map(cmd => (
            <button key={cmd} type="button" onClick={() => setBrief(((s.brief ?? '').trim() + ' ' + cmd).trim())}
              style={{ fontSize: 10.5, fontFamily: "'DM Mono',monospace", color: C.textMuted, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>{cmd}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {FORMATS.map(f => (
          <button key={f.key} onClick={() => setFormat(f.key)} style={{ padding: '9px 14px', borderRadius: 10, cursor: 'pointer', background: s.format === f.key ? C.accentDim : C.surface, border: `1.5px solid ${s.format === f.key ? C.accent : C.border}`, color: C.text, fontSize: 13 }}>
            <b>{f.label}</b> <span style={{ color: C.textMuted, fontSize: 11 }}>· {f.sub}</span>
          </button>
        ))}
      </div>

      {/* Calidad: Económica (barata) por defecto; HD cuesta más */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.textMuted }}>Calidad:</span>
        {[{ v: false, t: 'Económica', d: 'más barata' }, { v: true, t: 'HD', d: 'mejor · cuesta más' }].map(o => (
          <button key={o.t} onClick={() => setHd(o.v)} style={{ padding: '7px 13px', borderRadius: 9, cursor: 'pointer', background: hd === o.v ? C.accentDim : C.surface, border: `1.5px solid ${hd === o.v ? C.accent : C.border}`, color: C.text, fontSize: 12.5 }}>
            <b>{o.t}</b> <span style={{ color: C.textMuted, fontSize: 10.5 }}>· {o.d}</span>
          </button>
        ))}
      </div>

      {!has ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: '48px 0', border: `1.5px dashed ${C.border}`, borderRadius: 16, background: C.surface }}>
          <div style={{ fontSize: 34 }}>🎨</div>
          <Btn style={{ marginTop: 16 }} onClick={() => onGen(q)}>Generar 3 variantes</Btn>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 14 }}>
          {s.variants.map((v: ImageVariant) => {
            const sel = s.selectedImage?.url === v.url;
            return (
              <div key={v.key} style={{ borderRadius: 14, overflow: 'hidden', border: `2px solid ${sel ? C.accent : C.border}`, background: C.surface }}>
                <div style={{ aspectRatio: s.format === '1:1' ? '1' : s.format === '4:5' ? '4/5' : '9/16', background: C.surface2 }}>
                  <img src={v.url} alt={v.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{v.label}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>{v.description}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn small onClick={() => onPick(v)} ghost={!sel} style={{ flex: 1 }}>{sel ? '✓ Elegida' : 'Usar esta'}</Btn>
                    <Btn small ghost onClick={() => onDownload(v)} title="Descargar PNG">⬇</Btn>
                    <Btn small ghost onClick={() => onRegen(v.key, q)} title="Regenerar">🔄</Btn>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <NavRow onBack={onBack} onNext={onNext} nextDisabled={!s.selectedImage} nextLabel="Continuar a video →" />
    </StepShell>
  );
}

// ── PASO 5: Video ─────────────────────────────────────────────────────────────
function StepVideo({ s, costs, onGen, onUGC, onBack, onNext }: any) {
  const [dur, setDur] = useState<'5' | '10'>('5');
  const [mode, setMode] = useState<'product' | 'ugc'>('product');
  return (
    <StepShell title="Convertí la imagen en video" subtitle="Video de producto (anima tu imagen) o UGC con una persona IA usando tu producto. Podés saltar este paso.">
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, background: C.surface, borderRadius: 12, padding: 4, border: `1px solid ${C.border}`, maxWidth: 380 }}>
        {([['product', '🎬 Video de producto'], ['ugc', '🎭 UGC (persona IA)']] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setMode(k)} style={{ flex: 1, padding: '9px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: mode === k ? C.accent : 'transparent', color: mode === k ? '#fff' : C.textMuted }}>{lbl}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,300px) 1fr', gap: 22 }} className="prod-grid">
        <div style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.border}`, background: C.surface2, aspectRatio: s.format === '1:1' ? '1' : s.format === '4:5' ? '4/5' : '9/16' }}>
          {s.videoUrl
            ? <video src={s.videoUrl} autoPlay loop muted playsInline controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : s.selectedImage && <img src={s.selectedImage.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        </div>
        <div>
          {mode === 'product' ? (
            <>
              <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 8 }}>Duración</div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
                {(['5', '10'] as const).map(d => (
                  <button key={d} onClick={() => setDur(d)} style={{ flex: 1, padding: '12px', borderRadius: 10, cursor: 'pointer', background: dur === d ? C.accentDim : C.surface, border: `1.5px solid ${dur === d ? C.accent : C.border}`, color: C.text }}>
                    <b>{d}s</b> <span style={{ fontSize: 11, color: C.textMuted }}>· {d === '10' ? costs.video10 : costs.video5} créditos</span>
                  </button>
                ))}
              </div>
              {dur === '10' && <Banner tone="amber">⚠️ El video de 10s consume más créditos.</Banner>}
              <Btn style={{ marginTop: 14 }} onClick={() => onGen(dur)} disabled={!s.selectedImage}>🎬 {s.videoUrl ? 'Regenerar' : 'Generar'} video</Btn>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 4 }}>UGC automático</div>
              <p style={{ fontSize: 13, color: C.textMuted, marginTop: 0 }}>La IA elige un creador virtual, el escenario y el guion según tu producto, y graba un Reel de 10s (persona 100% sintética).</p>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>Costo: <b style={{ color: C.accent }}>{costs.ugc_video_10 ?? 10} créditos</b></div>
              <Btn onClick={onUGC}>🎭 {s.videoUrl ? 'Regenerar' : 'Generar'} UGC automático</Btn>
            </>
          )}
        </div>
      </div>
      <NavRow onBack={onBack} onNext={onNext} nextLabel={s.videoUrl ? 'Continuar →' : 'Saltar video →'} />
    </StepShell>
  );
}

// ── PASO 6: Copy ──────────────────────────────────────────────────────────────
function StepCopy({ s, onGen, onPick, onBack, onNext }: any) {
  const has = s.copyVariants.length > 0;
  const LABEL: Record<string, string> = { conversion: '🔥 Conversión', emotional: '💜 Emocional', professional: '💼 Profesional' };
  return (
    <StepShell title="Copy publicitario" subtitle="La IA escribe título, texto, CTA, descripción y hashtags. Elegí el tono.">
      {!has ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: '48px 0', border: `1.5px dashed ${C.border}`, borderRadius: 16, background: C.surface }}>
          <div style={{ fontSize: 34 }}>✍️</div>
          <Btn style={{ marginTop: 16 }} onClick={onGen}>Generar copy</Btn>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
          {s.copyVariants.map((c: CopyVariant) => {
            const sel = s.selectedCopy?.key === c.key;
            return (
              <button key={c.key} onClick={() => onPick(c)} style={{ textAlign: 'left', padding: 16, borderRadius: 14, cursor: 'pointer', background: sel ? C.accentDim : C.surface, border: `2px solid ${sel ? C.accent : C.border}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, marginBottom: 8 }}>{LABEL[c.key] ?? c.key}</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{c.title}</div>
                <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 8, lineHeight: 1.5 }}>{c.body}</div>
                <div style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>{c.cta}</div>
                <div style={{ fontSize: 11, color: C.blue, marginTop: 8 }}>{(c.hashtags ?? []).map(h => h.startsWith('#') ? h : '#' + h).join(' ')}</div>
              </button>
            );
          })}
        </div>
      )}
      {has && <div style={{ marginTop: 12 }}><Btn ghost small onClick={onGen}>🔄 Regenerar copy</Btn></div>}
      <NavRow onBack={onBack} onNext={onNext} nextDisabled={!s.selectedCopy} nextLabel="Ver resultado →" />
    </StepShell>
  );
}

// ── PASO 7: Resultado ─────────────────────────────────────────────────────────
function StepResultado({ s, onRegenImage, onRegenVideo, onRegenCopy, onCampaign, onNew }: any) {
  const c: CopyVariant | undefined = s.selectedCopy;
  const copyText = c ? `${c.title}\n\n${c.body}\n\n${c.cta}\n\n${(c.hashtags ?? []).map((h: string) => h.startsWith('#') ? h : '#' + h).join(' ')}` : '';
  const [copied, setCopied] = useState(false);
  const doCopy = () => { navigator.clipboard?.writeText(copyText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{ fontSize: 30 }}>✨</div>
        <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26, margin: '6px 0 2px' }}>Tu creativo está listo</h2>
        <div style={{ color: C.textMuted, fontSize: 14 }}>Descargá, copiá o creá una campaña.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,340px) 1fr', gap: 24, alignItems: 'start' }} className="prod-grid">
        <div style={{ borderRadius: 16, overflow: 'hidden', border: `1px solid ${C.border}`, background: C.surface2, aspectRatio: s.format === '1:1' ? '1' : s.format === '4:5' ? '4/5' : '9/16' }}>
          {s.videoUrl
            ? <video src={s.videoUrl} autoPlay loop muted playsInline controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : s.selectedImage && <img src={s.selectedImage.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        </div>
        <div>
          {c && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>{c.title}</div>
              <div style={{ fontSize: 14, color: C.textMuted, lineHeight: 1.6, marginBottom: 10 }}>{c.body}</div>
              <div style={{ display: 'inline-block', background: C.gradGreen, color: '#04140d', fontWeight: 700, fontSize: 13, padding: '7px 14px', borderRadius: 9 }}>{c.cta}</div>
              <div style={{ fontSize: 12, color: C.blue, marginTop: 12 }}>{(c.hashtags ?? []).map(h => h.startsWith('#') ? h : '#' + h).join(' ')}</div>
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {s.selectedImage && <a href={s.selectedImage.url} download="creativo.png" target="_blank" rel="noreferrer" style={aBtn}>⬇ Imagen</a>}
            {s.videoUrl && <a href={s.videoUrl} download="creativo.mp4" target="_blank" rel="noreferrer" style={aBtn}>⬇ Video</a>}
            {c && <Btn ghost small onClick={doCopy}>{copied ? '✓ Copiado' : '📋 Copiar copy'}</Btn>}
          </div>
          <div style={{ height: 1, background: C.border, margin: '18px 0' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <Btn ghost small onClick={onRegenImage}>🔄 Otra imagen</Btn>
            <Btn ghost small onClick={onRegenVideo}>🔄 Otro video</Btn>
            <Btn ghost small onClick={onRegenCopy}>🔄 Otro copy</Btn>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
            <Btn onClick={onCampaign}>🚀 Crear campaña</Btn>
            <Btn ghost onClick={onNew}>+ Nuevo creativo</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Historial ─────────────────────────────────────────────────────────────────
function History() {
  const [items, setItems] = useState<any[] | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [filter, setFilter] = useState<'image' | 'video' | 'template' | 'fav'>('image');
  const load = () => creativeApi.list().then(setItems).catch(() => setItems([]));
  const loadProjects = () => workspaceApi.listProjects().then(setProjects).catch(() => setProjects([]));
  useEffect(() => { load(); loadProjects(); }, []);
  const del = async (id: string) => { await creativeApi.remove(id).catch(() => {}); load(); };
  const fav = async (id: string) => { await creativeApi.favorite(id).catch(() => {}); load(); };
  const delProject = async (id: string) => { await workspaceApi.removeProject(id).catch(() => {}); loadProjects(); };
  if (!items) return <div style={{ padding: 40 }}><Spinner size={24} /></div>;

  const FILTERS: [typeof filter, string][] = [['image', '🖼️ Imágenes'], ['video', '🎬 Videos'], ['template', '📁 Plantillas'], ['fav', '⭐ Favoritos']];
  const shown = filter === 'template' ? [] : items.filter(it => filter === 'fav' ? it.is_favorite : filter === 'video' ? it.video_url : (it.output_url && !it.video_url));

  return (
    <div style={{ padding: '28px clamp(16px,3vw,40px)' }}>
      <div style={{ marginBottom: 6 }}>
        <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 22, margin: 0 }}>Mis creativos</h2>
        <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>Todo lo que generás se guarda solo acá. No se pierde nada.</div>
      </div>
      <div style={{ display: 'flex', gap: 6, margin: '16px 0 18px', flexWrap: 'wrap' }}>
        {FILTERS.map(([k, lbl]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding: '8px 15px', borderRadius: 9, border: `1px solid ${filter === k ? C.accent : C.border}`, background: filter === k ? C.accentDim : 'transparent', color: filter === k ? C.text : C.textMuted, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {lbl} <span style={{ opacity: 0.6, fontSize: 11 }}>({k === 'template' ? projects.length : k === 'fav' ? items.filter(i => i.is_favorite).length : k === 'video' ? items.filter(i => i.video_url).length : items.filter(i => i.output_url && !i.video_url).length})</span>
          </button>
        ))}
      </div>

      {filter === 'template' ? (
        projects.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: C.textMuted }}><div style={{ fontSize: 30, marginBottom: 8 }}>📁</div>Todavía no guardaste ninguna plantilla. En una campaña, tocá <b>💾 Guardar</b> y queda acá para reutilizar.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 16 }}>
            {projects.map(p => (
              <div key={p.id} style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.border}`, background: C.surface }}>
                <div style={{ aspectRatio: '3/4', background: C.surface2 }}>
                  {p.thumbnail_url ? <img src={p.thumbnail_url} alt={p.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: C.textDim, fontSize: 30 }}>📁</div>}
                </div>
                <div style={{ padding: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 8px' }}>{new Date(p.created_at).toLocaleDateString()} · {p.credits_used ?? 0} créditos</div>
                  <Btn small ghost onClick={() => delProject(p.id)}>🗑️ Borrar</Btn>
                </div>
              </div>
            ))}
          </div>
        )
      ) : shown.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: C.textMuted }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🖼️</div>
          {items.length === 0 ? 'Tu biblioteca está vacía. Creá tu primera campaña y empezá a generar contenido — se guarda solo.' : 'No hay creativos en esta sección.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 16 }}>
          {shown.map(it => (
            <div key={it.id} style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.border}`, background: C.surface, position: 'relative' }}>
              <button onClick={() => fav(it.id)} title="Favorito" style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, background: '#000a', border: 'none', borderRadius: 8, padding: '4px 7px', cursor: 'pointer', fontSize: 14 }}>{it.is_favorite ? '⭐' : '☆'}</button>
              <div style={{ aspectRatio: '3/4', background: C.surface2 }}>
                {it.video_url ? <video src={it.video_url} muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : it.output_url ? <img src={it.output_url} alt={it.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: C.textDim }}>🎨</div>}
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                <div style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 8px' }}>{new Date(it.created_at).toLocaleDateString()} · {it.credits_used ?? 0} créditos</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {it.video_url && <a href={it.video_url} download target="_blank" rel="noreferrer" style={{ ...aBtn, padding: '6px 10px', fontSize: 12 }}>⬇ Video</a>}
                  {it.output_url && !it.video_url && <a href={it.output_url} download target="_blank" rel="noreferrer" style={{ ...aBtn, padding: '6px 10px', fontSize: 12 }}>⬇</a>}
                  <Btn small ghost onClick={() => del(it.id)}>🗑️</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Primitivos UI ─────────────────────────────────────────────────────────────
function StepShell({ title, subtitle, children }: any) {
  return (
    <div>
      <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 24, margin: '0 0 4px' }}>{title}</h2>
      {subtitle && <p style={{ color: C.textMuted, fontSize: 14, margin: '0 0 22px', maxWidth: 620 }}>{subtitle}</p>}
      {children}
    </div>
  );
}

function NavRow({ onBack, onNext, nextDisabled, nextLabel }: any) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
      {onBack ? <Btn ghost onClick={onBack}>← Volver</Btn> : <span />}
      {onNext && <Btn onClick={onNext} disabled={nextDisabled}>{nextLabel ?? 'Continuar'}</Btn>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, textarea }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string; textarea?: boolean }) {
  const st: React.CSSProperties = { width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', color: C.text, fontSize: 13, outline: 'none', fontFamily: 'inherit' };
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>{label}</span>
      {textarea
        ? <textarea value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ ...st, minHeight: 70, resize: 'vertical' }} />
        : <input value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={st} />}
    </label>
  );
}

function Btn({ children, onClick, ghost, small, disabled, style, title }: any) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      padding: small ? '7px 12px' : '10px 18px', borderRadius: 10, fontSize: small ? 13 : 14, fontWeight: 600,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
      border: ghost ? `1px solid ${C.border}` : 'none', background: ghost ? 'transparent' : C.accent, color: ghost ? C.text : '#fff',
      transition: 'all .15s', ...style,
    }}>{children}</button>
  );
}

const aBtn: React.CSSProperties = { padding: '7px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: C.green, color: '#04140d', textDecoration: 'none', display: 'inline-block' };

function Banner({ tone, children }: { tone: 'red' | 'amber'; children: any }) {
  const bg = tone === 'red' ? C.redDim : C.amberDim;
  const bd = tone === 'red' ? C.red : C.amber;
  return <div style={{ background: bg, border: `1px solid ${bd}`, color: bd, borderRadius: 10, padding: '10px 14px', fontSize: 13, margin: '0 0 14px' }}>{children}</div>;
}

function Overlay({ children, onClose }: { children: any; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#000a', display: 'grid', placeItems: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.surface, border: `1px solid ${C.borderBright}`, borderRadius: 16, padding: 26, maxWidth: 380, width: '100%' }}>{children}</div>
    </div>
  );
}

function LoadingState({ msgs }: { msgs: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % msgs.length), 1800); return () => clearInterval(t); }, [msgs.length]);
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: '70px 0', textAlign: 'center' }}>
      <div style={{ position: 'relative', width: 64, height: 64, marginBottom: 22 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `3px solid ${C.surface2}`, borderTopColor: C.accent, animation: 'studiospin 1s linear infinite' }} />
      </div>
      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17 }}>{msgs[i]}</div>
      <div style={{ fontSize: 13, color: C.textMuted, marginTop: 6 }}>La IA está trabajando…</div>
      <style>{`@keyframes studiospin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
