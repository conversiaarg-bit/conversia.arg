import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../../components/ui';
import FileUploadZone, { type UploadFile } from '../../components/ui/FileUploadZone';
import { uploadsApi } from '../../api/uploads';
import { aiApi } from '../../api/ai';
import { campaignsApi, type MetaAccount } from '../../api/campaigns';
import { generateCreativeImage } from '../../utils/creativeCanvas';
import { editProductImage, generateProductImage } from '../../utils/openaiImageEdit';
import { C } from '../../styles/theme';

const STEP_META = [
  { title: 'Producto', sub: 'Información del producto' },
  { title: 'IA analiza', sub: 'Análisis inteligente' },
  { title: 'Creativos', sub: 'Generación de contenido' },
  { title: 'Publicar', sub: 'Lanzar campaña' },
];

// ── Estilos y campos reutilizables del paso 1 ────────────────────────────────
const cardBig: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 };
const inputBase: React.CSSProperties = { width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', color: C.text, fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const upLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: C.textMuted, marginBottom: 9 };
const tipBanner: React.CSSProperties = { marginTop: 4, padding: '12px 14px', background: C.accentDim, border: `1px solid ${C.accent}33`, borderRadius: 10, fontSize: 12.5, color: C.accent, lineHeight: 1.5 };
const fieldIconStyle = (top = '50%'): React.CSSProperties => ({ position: 'absolute', left: 14, top, transform: top === '50%' ? 'translateY(-50%)' : 'none', fontSize: 15, color: C.textMuted, pointerEvents: 'none' });

function Field({ label, req, sub, counter, children }: { label: string; req?: boolean; sub?: string; counter?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: C.textMuted, marginBottom: 8 }}>
        {label}{req && <span style={{ color: '#a78bfa', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {(sub || counter) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, gap: 8 }}>
          <span style={{ fontSize: 11, color: C.textDim }}>{sub}</span>
          {counter && <span style={{ fontSize: 11, color: C.textDim, flexShrink: 0 }}>{counter}</span>}
        </div>
      )}
    </div>
  );
}

function IconInput({ icon, ...rest }: { icon: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={fieldIconStyle()}>{icon}</span>
      <input {...rest} style={{ ...inputBase, paddingLeft: 40 }} />
    </div>
  );
}

function MoneyInput({ currency, setCurrency, ...rest }: { currency: Currency; setCurrency: (c: Currency) => void } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ display: 'flex' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: C.surface2, border: `1px solid ${C.border}`, borderRight: 'none', borderRadius: '10px 0 0 10px', padding: '0 8px 0 12px' }}>
        <span style={{ color: C.textMuted, fontSize: 14 }}>$</span>
        <select value={currency} onChange={e => setCurrency(e.target.value as Currency)} style={{ background: 'transparent', border: 'none', color: C.text, fontSize: 13, fontWeight: 600, outline: 'none', cursor: 'pointer' }}>
          <option value="USD">USD</option><option value="ARS">ARS</option>
        </select>
      </div>
      <input {...rest} style={{ ...inputBase, borderRadius: '0 10px 10px 0', flex: 1, minWidth: 0 }} />
    </div>
  );
}

const CREATIVE_CONFIGS = [
  { fmt: '9:16' as const, label: 'Reel principal', from: '#1a0528', to: '#3d0f6b', emoji: '🎬', best: true },
  { fmt: '1:1' as const, label: 'Feed cuadrado', from: '#050528', to: '#0f1a6b', emoji: '📸', best: false },
  { fmt: '4:5' as const, label: 'Story', from: '#281a05', to: '#6b4f0f', emoji: '📱', best: false },
];

const ZONES_AR = [
  'Todo Argentina', 'AMBA (Buenos Aires + GBA)', 'CABA', 'GBA Norte', 'GBA Sur', 'GBA Oeste',
  'Córdoba', 'Rosario', 'Mendoza', 'Tucumán', 'Salta', 'Mar del Plata',
];

interface AiStrategy {
  hook: string;
  headline?: string;
  body?: string;
  cta?: string;
  audience?: { description?: string; age_min?: number; age_max?: number };
  format?: string;
  styleNotes?: string;
  whatsappMessage?: string;
  hooks_variants?: string[];
  reasoning?: string;
}

type Currency = 'USD' | 'ARS';
type Gender = 'Todos' | 'Masculino' | 'Femenino';

const OBJECTIVE_MAP: Record<string, 'whatsapp' | 'traffic' | 'leads' | 'conversions'> = {
  'WhatsApp': 'whatsapp', 'Tráfico web': 'traffic', 'Conversiones': 'conversions', 'Reconocimiento de marca': 'traffic',
};

export default function NewCampaign() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [analyzing, setAnalyzing] = useState(false);
  const [strategy, setStrategy] = useState<AiStrategy | null>(null);
  const [analyzeError, setAnalyzeError] = useState('');

  // Publicación en Meta
  const [metaAccounts, setMetaAccounts] = useState<MetaAccount[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [published, setPublished] = useState(false);
  useEffect(() => {
    campaignsApi.getMetaAccounts()
      .then(r => setMetaAccounts(((r.data as any)?.data ?? r.data ?? []) as MetaAccount[]))
      .catch(() => setMetaAccounts([]));
  }, []);

  // Step 1 form
  const [form, setForm] = useState({ name: '', price: '', desc: '', budget: '25', objective: 'WhatsApp' });
  const [currency, setCurrency] = useState<Currency>('USD');
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  // Step 3: audience & zone config
  const [gender, setGender] = useState<Gender>('Todos');
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(55);
  const [zone, setZone] = useState('Todo Argentina');
  const [interests, setInterests] = useState('');

  // File uploads
  const [mainFiles, setMainFiles] = useState<UploadFile[]>([]);
  const [extraFiles, setExtraFiles] = useState<UploadFile[]>([]);

  const [creativeImages, setCreativeImages] = useState<string[]>([]);
  const [generatingImages, setGeneratingImages] = useState(false);
  const [fluxError, setFluxError] = useState('');
  const [productPhotoUrl, setProductPhotoUrl] = useState<string | null>(null);

  const handleUpload = useCallback(async (files: File[], onProgress: (pct: number) => void) => {
    const res = await uploadsApi.upload(files, onProgress);
    return (res.data as any)?.data?.files ?? [];
  }, []);

  // Generate AI images when entering step 3
  useEffect(() => {
    if (step !== 3 || !strategy) return;
    const hook = strategy.hook || form.name || 'Oferta especial';
    const product = form.name || 'Producto';
    const style = strategy.styleNotes ?? 'Hook urgencia';

    // productPhotoUrl is set explicitly in goToCreatives() — no stale closure issue
    void productPhotoUrl;

    setGeneratingImages(true);
    setFluxError('');

    if (false) {
      // (placeholder — photo editing now goes through the shared Promise.all below)
    } else {
      // No photo uploaded — show canvas placeholder then replace with FLUX.1
      Promise.all(
        CREATIVE_CONFIGS.map(cfg =>
          generateCreativeImage({ hook, product, format: cfg.fmt, style, avatarEmoji: cfg.emoji, gradientFrom: cfg.from, gradientTo: cfg.to })
        )
      ).then(placeholders => setCreativeImages(placeholders));

      const description = form.desc || undefined;
      const photoUrl2 = productPhotoUrl;
      Promise.all(
        CREATIVE_CONFIGS.map(cfg =>
          (photoUrl2
            ? editProductImage(photoUrl2, product, style, cfg.fmt, hook, description)
            : generateProductImage(product, style, cfg.fmt, hook, description)
          ).catch((err: any) => {
            const msg = err?.response?.data?.message ?? err?.message ?? String(err);
            setFluxError(`Usando plantilla — IA sin configurar. (${String(msg).slice(0, 90)})`);
            return generateCreativeImage({ hook, product, format: cfg.fmt, style, avatarEmoji: cfg.emoji, gradientFrom: cfg.from, gradientTo: cfg.to });
          })
        )
      ).then(images => {
        setCreativeImages(images);
        setGeneratingImages(false);
      });
    }
  }, [step, productPhotoUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAnalysis = async () => {
    if (!form.name.trim() && !form.desc.trim()) return;
    setAnalyzing(true);
    setAnalyzeError('');
    setStrategy(null);
    try {
      const res = await aiApi.analyzeCampaign(
        form.name || 'Producto sin nombre',
        form.desc || form.name,
        form.objective,
      );
      const data = (res.data as any)?.data ?? res.data;
      setStrategy(data);
    } catch {
      setStrategy({
        hook: '¿Todavía pagás de más?',
        headline: form.name || 'Oferta especial',
        cta: 'Escribinos por WhatsApp',
        audience: { description: 'Compradores online 18-40', age_min: 18, age_max: 40 },
        format: '9_16',
        styleNotes: 'Texto grande, fondo oscuro, urgencia',
        whatsappMessage: 'Hola, vi tu anuncio. ¿Tenés disponibilidad?',
      });
      setAnalyzeError('IA sin conexión — usando estrategia de respaldo');
    }
    setAnalyzing(false);
  };

  const goToCreatives = () => {
    if (!strategy) return;
    // Capture photo URL NOW, before changing step — avoids stale closure in useEffect
    const photoUrl = extraFiles[0]?.preview || mainFiles[0]?.preview || null;
    setProductPhotoUrl(photoUrl);
    setStep(3);
  };

  const displayStrategy = strategy ?? {
    hook: '—', audience: { description: '—' }, format: '9_16', cta: '—', styleNotes: '—',
  };

  const account = metaAccounts?.[0];
  const buildTargeting = () => {
    const t: Record<string, any> = { age_min: ageMin, age_max: ageMax, geo_locations: { countries: ['AR'] } };
    if (gender === 'Masculino') t.genders = [1];
    else if (gender === 'Femenino') t.genders = [2];
    return t;
  };
  const createAndPublish = async () => {
    if (!account) { setPublishError('Conectá Meta Ads en Integraciones para poder publicar.'); return; }
    setPublishing(true); setPublishError('');
    try {
      const budgetUsd = Math.max(1, Math.round(currency === 'ARS' ? (+form.budget || 0) / 1100 : (+form.budget || 0)) || 25);
      const created = await campaignsApi.create({
        name: form.name || 'Nueva campaña',
        metaAccountId: account.id,
        objective: OBJECTIVE_MAP[form.objective] ?? 'whatsapp',
        dailyBudgetUsd: budgetUsd,
        whatsappMessage: strategy?.whatsappMessage,
        targeting: buildTargeting(),
      });
      const id = (created.data as any)?.data?.id ?? (created.data as any)?.id;
      await campaignsApi.publish(id);
      setPublished(true);
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.response?.data?.error;
      setPublishError(Array.isArray(msg) ? msg.join(', ') : (msg || 'No se pudo publicar en Meta. Revisá la conexión y los datos de la cuenta.'));
    }
    setPublishing(false);
  };

  const btnStyle = (active: boolean) => ({
    padding: '5px 13px', borderRadius: 6, fontSize: 11, border: `1px solid ${active ? C.accent : C.border}`,
    background: active ? C.accentDim : 'transparent', color: active ? C.accent : C.textMuted, cursor: 'pointer' as const,
  });

  return (
    <div className="content fade-in" translate="no">
      <div style={{ marginBottom: 26 }}>
        <div style={{ height: 4, borderRadius: 3, background: C.surface, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ height: '100%', width: `${(step / 4) * 100}%`, background: C.grad, borderRadius: 3, transition: 'width .3s ease' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {STEP_META.map((s, i) => {
            const n = i + 1, active = step === n, done = step > n;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 15,
                  background: active ? C.grad : done ? C.greenDim : C.surface,
                  color: active ? '#fff' : done ? C.green : C.textMuted,
                  border: active ? 'none' : `1px solid ${C.border}`,
                  boxShadow: active ? '0 8px 20px -6px rgba(124,92,252,.6)' : 'none',
                }}>{done ? '✓' : n}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: active || done ? C.text : C.textMuted, whiteSpace: 'nowrap' }}>{s.title}</div>
                  <div style={{ fontSize: 12, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Step 1: Product data ─────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="g2" style={{ gap: 20, alignItems: 'start' }}>
          {/* Izquierda: información del producto */}
          <div style={cardBig}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 18 }}>Información del producto</div>
            <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 20 }}>Completá los datos principales de tu producto</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <Field label="Nombre del producto" req counter={`${form.name.length}/100`}>
                <IconInput icon="🏷️" placeholder="ej. Nike Air Max 270" value={form.name} maxLength={100} onChange={e => set('name', e.target.value)} />
              </Field>

              <Field label="Precio de venta" req sub={currency === 'ARS' ? `≈ $${Math.round(parseFloat(form.price || '0') / 1100).toLocaleString('es-AR')} USD` : `≈ $${Math.round(parseFloat(form.price || '0') * 1100).toLocaleString('es-AR')} ARS`}>
                <MoneyInput currency={currency} setCurrency={setCurrency} value={form.price} placeholder="99.00" onChange={e => set('price', e.target.value)} />
              </Field>

              <Field label="Descripción" req counter={`${form.desc.length}/500`}>
                <div style={{ position: 'relative' }}>
                  <span style={fieldIconStyle('12px')}>✏️</span>
                  <textarea value={form.desc} maxLength={500} onChange={e => set('desc', e.target.value)} placeholder="¿Qué hace especial este producto?"
                    style={{ ...inputBase, paddingLeft: 40, paddingTop: 12, minHeight: 96, resize: 'vertical', lineHeight: 1.5 }} />
                </div>
              </Field>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Presupuesto diario" req sub={currency === 'ARS' ? `≈ $${Math.round(parseFloat(form.budget || '0') / 1100)} USD/día` : `≈ $${Math.round(parseFloat(form.budget || '0') * 1100).toLocaleString('es-AR')} ARS/día`}>
                  <MoneyInput currency={currency} setCurrency={setCurrency} value={form.budget} placeholder="25" type="number" onChange={e => set('budget', e.target.value)} />
                </Field>
                <Field label="Objetivo principal" req sub="¿Dónde querés que lleguen tus clientes?">
                  <div style={{ position: 'relative' }}>
                    <span style={fieldIconStyle()}>🎯</span>
                    <select value={form.objective} onChange={e => set('objective', e.target.value)} style={{ ...inputBase, paddingLeft: 40, cursor: 'pointer', appearance: 'none' }}>
                      <option>WhatsApp</option>
                      <option>Tráfico web</option>
                      <option>Conversiones</option>
                      <option>Reconocimiento de marca</option>
                    </select>
                    <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: C.textMuted, pointerEvents: 'none', fontSize: 11 }}>▾</span>
                  </div>
                </Field>
              </div>

              <div style={tipBanner}>💡 <b style={{ fontWeight: 700 }}>Consejo:</b> Sé específico en la descripción para que la IA pueda crear mejores anuncios</div>
            </div>
          </div>

          {/* Derecha: material del producto */}
          <div style={cardBig}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 18 }}>Material del producto</div>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 7, padding: '4px 10px' }}>Opcional</span>
            </div>
            <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 20 }}>Subí el material que quieres usar en tu campaña</div>

            <label style={upLabel}>Video o imagen principal</label>
            <div style={{ marginBottom: 20 }}>
              <FileUploadZone
                accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
                multiple={false} maxSizeMB={500} icon="🎬" tall cta="Seleccionar archivo"
                label="Arrastrá tu video o hacé clic para subir"
                hint="MP4, MOV, JPG, PNG · Máx. 500 MB"
                value={mainFiles} onChange={setMainFiles} onUpload={handleUpload}
              />
            </div>

            <label style={upLabel}>Fotos adicionales</label>
            <div style={{ marginBottom: 16 }}>
              <FileUploadZone
                accept="image/jpeg,image/png,image/webp"
                multiple={true} maxSizeMB={50} icon="🖼️" tall cta="Seleccionar archivos"
                label="Arrastrá tus fotos o hacé clic para subir"
                hint="JPG, PNG, WebP · Máx. 50 MB por foto"
                value={extraFiles} onChange={setExtraFiles} onUpload={handleUpload}
              />
            </div>

            <div style={tipBanner}>😃 La IA puede crear versiones virales automáticamente con tu material</div>
          </div>
        </div>
      )}

      {/* ── Step 2: AI analysis ─────────────────────────────────────────────── */}
      {step === 2 && (
        <div style={{ ...cardBig, maxWidth: 560, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', padding: '14px 0' }}>
            {!strategy && !analyzing && (
              <>
                <div style={{ width: 60, height: 60, borderRadius: '50%', background: C.grad, display: 'grid', placeItems: 'center', fontSize: 28, margin: '0 auto 14px', boxShadow: '0 12px 28px -10px rgba(124,92,252,.7)' }}>🤖</div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 7 }}>Listo para analizar</div>
                <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 18, lineHeight: 1.6 }}>
                  La IA va a analizar tu producto y crear la estrategia perfecta de Meta Ads: hook viral, audiencia, copy y formato ideal.
                </div>
                <button className="btn btn-p" style={{ padding: '10px 24px' }} onClick={runAnalysis}>🤖 Iniciar análisis IA</button>
              </>
            )}

            {analyzing && (
              <>
                <div style={{ width: 60, height: 60, borderRadius: '50%', background: C.grad, display: 'grid', placeItems: 'center', fontSize: 28, margin: '0 auto 14px', boxShadow: '0 12px 28px -10px rgba(124,92,252,.7)' }}>🤖</div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 18 }}>IA analizando...</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', marginBottom: 18 }}>
                  {['Analizando Meta Ad Library...', 'Detectando hooks virales...', 'Generando copy estratégico...', 'Definiendo segmentación ideal...'].map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: C.textMuted }}>
                      <Spinner /> {t}
                    </div>
                  ))}
                </div>
              </>
            )}

            {strategy && !analyzing && (
              <div style={{ textAlign: 'left' }}>
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  <div style={{ fontSize: 30 }}>✅</div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, marginTop: 5 }}>Análisis completado</div>
                  {analyzeError && <div style={{ fontSize: 11, color: C.amber, marginTop: 5 }}>⚠️ {analyzeError}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {([
                    ['Gancho', displayStrategy.hook],
                    ['Tono', displayStrategy.styleNotes ?? 'Urgencia + beneficio directo'],
                    ['Formato', displayStrategy.format?.replace('_', ':') ?? '9:16'],
                    ['Audiencia', displayStrategy.audience?.description ?? '—'],
                    ['CTA', displayStrategy.cta ?? '—'],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}22`, fontSize: 13 }}>
                      <span style={{ color: C.textMuted, flexShrink: 0, marginRight: 12 }}>{k}</span>
                      <span style={{ color: C.text, fontWeight: 500, textAlign: 'right', maxWidth: '60%', lineHeight: 1.4 }}>{v}</span>
                    </div>
                  ))}
                </div>
                {strategy.hooks_variants && strategy.hooks_variants.length > 0 && (
                  <div style={{ marginTop: 14, padding: '10px 12px', background: C.accentDim, borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: C.accent, fontWeight: 600, marginBottom: 6 }}>Variantes de hook</div>
                    {strategy.hooks_variants.map((h, i) => (
                      <div key={i} style={{ fontSize: 12, color: C.text, padding: '3px 0' }}>• {h}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Step 3: Audience config + Generated creatives ───────────────────── */}
      {step === 3 && (
        <div className="g2" style={{ gap: 16 }}>
          {/* Left: Audience & Location */}
          <div style={cardBig}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, marginBottom: 14 }}>Audiencia y zona</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="fg">
                <label className="flbl">Sexo</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['Todos', 'Masculino', 'Femenino'] as Gender[]).map(g => (
                    <button key={g} onClick={() => setGender(g)} style={btnStyle(gender === g)}>{g}</button>
                  ))}
                </div>
              </div>

              <div className="fg">
                <label className="flbl">Rango de edad: {ageMin}–{ageMax} años</label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input type="range" min={13} max={65} value={ageMin}
                    onChange={e => setAgeMin(Math.min(+e.target.value, ageMax - 1))}
                    style={{ flex: 1, accentColor: C.accent }} />
                  <input type="range" min={13} max={65} value={ageMax}
                    onChange={e => setAgeMax(Math.max(+e.target.value, ageMin + 1))}
                    style={{ flex: 1, accentColor: C.accent }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textMuted, fontFamily: "'DM Mono',monospace", marginTop: 3 }}>
                  <span>Desde {ageMin}</span><span>Hasta {ageMax}</span>
                </div>
              </div>

              <div className="fg">
                <label className="flbl">Zona geográfica</label>
                <select className="fsel" value={zone} onChange={e => setZone(e.target.value)}>
                  {ZONES_AR.map(z => <option key={z}>{z}</option>)}
                </select>
              </div>

              <div className="fg">
                <label className="flbl">Intereses (separados por coma)</label>
                <input className="finput" placeholder="ej. moda, calzado, deporte, estilo de vida" value={interests} onChange={e => setInterests(e.target.value)} />
                <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>La IA usa estos intereses para afinar la segmentación</div>
              </div>

              {strategy?.audience && (
                <div style={{ padding: '9px 12px', background: C.accentDim, border: `1px solid ${C.accent}33`, borderRadius: 8, fontSize: 12, color: C.accent }}>
                  💡 IA sugiere: <strong>{strategy.audience.description}</strong>
                  {strategy.audience.age_min && <span> · {strategy.audience.age_min}–{strategy.audience.age_max} años</span>}
                </div>
              )}
            </div>
          </div>

          {/* Right: Generated creatives */}
          {(() => {
            // Read photo directly from file state — always up-to-date, no closure issues
            const photoUrl = extraFiles[0]?.preview || mainFiles[0]?.preview || null;
            void strategy?.hook;
            void form.name;

            return (
              <div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, marginBottom: 14 }}>
                  Creativos generados por IA
                  {photoUrl && <span style={{ fontSize: 10, color: C.green, marginLeft: 8, fontFamily: "'DM Mono',monospace" }}>✓ usando tu foto</span>}
                </div>

                {!photoUrl && generatingImages && (
                  <div style={{ background: C.accentDim, border: `1px solid ${C.accent}44`, borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.accent, marginBottom: 10 }}>
                    <Spinner size={12} /> Generando imágenes con FLUX.1-schnell... (20-30s)
                  </div>
                )}
                {!photoUrl && fluxError && !generatingImages && (
                  <div style={{ background: '#2a1500', border: '1px solid #f97316', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#f97316', wordBreak: 'break-all', marginBottom: 10 }}>
                    ⚠️ FLUX: {fluxError}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  {CREATIVE_CONFIGS.map((cfg, i) => (
                    <div key={i} style={{ background: C.surface, border: `1.5px solid ${i === 0 ? C.accent : C.border}`, borderRadius: 10, overflow: 'hidden', transition: 'all .2s' }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = i === 0 ? C.accent : C.border)}>

                      <div style={{
                        aspectRatio: cfg.fmt === '9:16' ? '9/16' : cfg.fmt === '4:5' ? '4/5' : '1',
                        position: 'relative', overflow: 'hidden',
                        background: `linear-gradient(135deg,${cfg.from},${cfg.to})`,
                      }}>
                        {cfg.best && (
                          <div style={{ position: 'absolute', top: 8, right: 8, background: C.accent, color: '#fff', fontSize: 9, padding: '2px 7px', borderRadius: 4, zIndex: 10 }}>★ Rec.</div>
                        )}

                                {creativeImages[i] ? (
                          /* ── FLUX.1 or canvas generated image ── */
                          <img src={creativeImages[i]} alt={cfg.label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6 }}>
                            <Spinner size={16} />
                            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: 'rgba(255,255,255,.4)' }}>{cfg.fmt}</div>
                          </div>
                        )}
                      </div>

                      <div style={{ padding: '8px 10px' }}>
                        <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 2 }}>{cfg.label}</div>
                        <div style={{ fontSize: 9, color: C.textMuted, fontFamily: "'DM Mono',monospace", marginBottom: 7 }}>{cfg.fmt}</div>
                        {(photoUrl || creativeImages[i]) && (
                          <a href={photoUrl || creativeImages[i]} download={`creativo-${cfg.fmt.replace(':', '-')}.jpg`}
                            style={{ display: 'block', textAlign: 'center', fontSize: 10, padding: '4px', border: `1px solid ${C.border}`, borderRadius: 5, color: C.textMuted, textDecoration: 'none', background: C.bg }}>
                            📥 Descargar
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Step 4: Publish ─────────────────────────────────────────────────── */}
      {step === 4 && (
        <div className="g2" style={{ gap: 16 }}>
          <div style={cardBig}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, marginBottom: 14 }}>Configuración final</div>
            {metaAccounts === null ? (
              <div style={{ padding: '9px 12px', background: C.surface2, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, color: C.textMuted, marginBottom: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Spinner size={12} /> Verificando conexión con Meta…
              </div>
            ) : account ? (
              <div style={{ padding: '9px 12px', background: C.greenDim, borderRadius: 8, border: `1px solid ${C.green}33`, fontSize: 12, color: C.green, marginBottom: 13 }}>
                ✅ Meta Ads conectado · <b>{account.name}</b>{account.whatsapp_number ? ' · WhatsApp vinculado' : ''}
              </div>
            ) : (
              <div style={{ padding: '10px 12px', background: C.amberDim, borderRadius: 8, border: `1px solid ${C.amber}44`, fontSize: 12, color: C.amber, marginBottom: 13 }}>
                ⚠️ No hay una cuenta de Meta conectada. <a href="/dashboard/integrations" style={{ color: C.amber, textDecoration: 'underline', fontWeight: 700 }}>Conectá Meta Ads</a> para poder publicar.
              </div>
            )}
            {[
              ['Campaña', form.name || 'Nueva campaña IA'],
              ['Presupuesto', `${form.budget} ${currency}/día`],
              ['Objetivo', form.objective],
              ['Formatos', 'Reel + Story + Feed'],
              ['Sexo', gender],
              ['Edad', `${ageMin}–${ageMax} años`],
              ['Zona', zone],
              ['Intereses', interests || 'IA optimizará automáticamente'],
              ['Hook IA', strategy?.hook ?? '—'],
              ['Pixel Meta', 'Vinculado ✓'],
              ['Material subido', `${mainFiles.filter(f => f.status === 'done').length} principal + ${extraFiles.filter(f => f.status === 'done').length} adicional`],
            ].map(([k, v], i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: `1px solid ${C.border}22` }}>
                <span style={{ color: C.textMuted }}>{k}</span><span style={{ fontWeight: 500, maxWidth: '55%', textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={cardBig}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, marginBottom: 14 }}>Preview WhatsApp</div>
            <div style={{ background: '#0d1117', borderRadius: 10, padding: 14, fontSize: 12 }}>
              <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 8, fontFamily: "'DM Mono',monospace" }}>WhatsApp Business</div>
              <div style={{ background: '#1f2937', borderRadius: '10px 10px 10px 2px', padding: '9px 11px', marginBottom: 7, maxWidth: '80%', lineHeight: 1.5 }}>
                {strategy?.whatsappMessage ?? 'Hola, vi tu anuncio. ¿Tenés disponibilidad?'}
              </div>
              <div style={{ background: '#1a3a2a', borderRadius: '10px 10px 2px 10px', padding: '9px 11px', marginLeft: 'auto', maxWidth: '80%', lineHeight: 1.5 }}>¡Hola! Sí 🎉 ¿Cuál es tu talle?</div>
            </div>

            {published ? (
              <div style={{ marginTop: 13, padding: 14, background: C.greenDim, border: `1px solid ${C.green}44`, borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 26 }}>🎉</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.green, margin: '4px 0 2px' }}>¡Campaña publicada en Meta!</div>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>Ya está activa. Los leads de WhatsApp van a entrar automáticamente.</div>
                <button className="btn btn-p" style={{ width: '100%', padding: '10px' }} onClick={() => navigate('/dashboard/campaigns')}>Ver mis campañas →</button>
              </div>
            ) : (
              <>
                {publishError && <div style={{ marginTop: 12, padding: '9px 12px', background: C.redDim, border: `1px solid ${C.red}`, borderRadius: 8, fontSize: 12, color: C.red }}>⚠️ {publishError}</div>}
                <button className="btn btn-p" style={{ width: '100%', marginTop: 13, padding: '11px', fontSize: 14, opacity: publishing || !account ? 0.6 : 1 }} onClick={createAndPublish} disabled={publishing || !account}>
                  {publishing ? <><Spinner size={14} color="#fff" /> Publicando en Meta…</> : '🚀 Publicar en Meta Ads'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Navigation ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        <button className="btn btn-g" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1}>← Volver</button>

        {step === 2 && !strategy && !analyzing ? (
          <button className="btn btn-p" onClick={runAnalysis}>🤖 Analizar con IA</button>
        ) : step === 2 && strategy ? (
          <button className="btn btn-p" onClick={goToCreatives}>🎨 Generar creativos →</button>
        ) : step < 4 ? (
          <button className="btn btn-p" onClick={() => setStep(step + 1)} disabled={step === 2 && analyzing}>
            {analyzing ? <><Spinner size={14} color="#fff" /> Analizando...</> : 'Continuar →'}
          </button>
        ) : published ? (
          <button className="btn btn-p" style={{ background: C.green }} onClick={() => navigate('/dashboard/campaigns')}>Ver campañas →</button>
        ) : (
          <button className="btn btn-p" style={{ background: C.green, opacity: publishing || !account ? 0.6 : 1 }} onClick={createAndPublish} disabled={publishing || !account}>
            {publishing ? <><Spinner size={14} color="#fff" /> Publicando…</> : '🚀 Publicar en Meta'}
          </button>
        )}
      </div>
    </div>
  );
}
