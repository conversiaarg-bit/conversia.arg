import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Users, Target, DollarSign,
  Megaphone, ArrowRight, Sparkles, Wand2, BarChart3,
  RefreshCw, Zap, ChevronUp, ChevronDown,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { Tag, Spinner } from '../../components/ui';
import { campaignsApi, type CampaignRow, type DashboardSummary, normalizeCtr, normalizeRoas } from '../../api/campaigns';
import { aiApi } from '../../api/ai';
import { creativeApi } from '../../api/creative';

function HomeHero({ navigate }: { navigate: (p: string) => void }) {
  const [thumbs, setThumbs] = useState<any[]>([]);
  useEffect(() => { creativeApi.list().then(l => setThumbs(l.slice(0, 4))).catch(() => {}); }, []);
  return (
    <div className="cv-fade-in" style={{ position: 'relative', borderRadius: 24, padding: 'clamp(28px,4vw,46px)', marginBottom: 26, overflow: 'hidden', background: 'radial-gradient(120% 140% at 0% 0%, #8b6bff 0%, #6b3ff0 42%, #3f2bb8 78%, #1a1440 100%)' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 90% at 100% 0%, #4da6ff33, transparent 60%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, opacity: 0.4, background: 'radial-gradient(circle at 1px 1px, #ffffff14 1px, transparent 0) 0 0/26px 26px', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', zIndex: 2, maxWidth: 600 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: 1.5, textTransform: 'uppercase', background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.22)', borderRadius: 999, padding: '5px 12px', marginBottom: 16, backdropFilter: 'blur(6px)' }}>✦ Conversia Studio</div>
        <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 'clamp(28px,4.4vw,46px)', color: '#fff', lineHeight: 1.03, letterSpacing: -0.5, margin: '0 0 14px' }}>Creá anuncios que venden,<br />con Inteligencia Artificial</h1>
        <p style={{ fontSize: 15.5, color: 'rgba(255,255,255,.82)', margin: '0 0 24px', lineHeight: 1.55, maxWidth: 500 }}>Subí tu producto y obtené una campaña completa — imágenes, video UGC, copy y formatos para Meta — en minutos, sin diseñador.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/dashboard/creatives')} className="cv-lift" style={{ background: '#fff', color: '#4a2fd0', border: 'none', borderRadius: 13, padding: '13px 24px', fontWeight: 800, fontSize: 14.5, cursor: 'pointer', boxShadow: '0 10px 24px -8px #0007' }}>+ Crear campaña</button>
          <button onClick={() => navigate('/dashboard/projects')} className="cv-lift" style={{ background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.3)', borderRadius: 13, padding: '13px 22px', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', backdropFilter: 'blur(6px)' }}>Mis proyectos</button>
        </div>
      </div>
      {/* Vitrina: tus creativos flotando (o marcos vacíos elegantes) */}
      <div style={{ position: 'absolute', right: 'clamp(-40px,-2vw,-10px)', top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 12, zIndex: 1 }} className="hero-thumbs">
        {[0, 1, 2, 3].map(i => {
          const it = thumbs[i];
          return (
            <div key={i} className="cv-thumb" style={{ width: 104, height: 176, borderRadius: 16, overflow: 'hidden', transform: `translateY(${i % 2 ? 18 : -18}px) rotate(${i % 2 ? 2 : -2}deg)`, border: '1px solid rgba(255,255,255,.28)', background: 'rgba(255,255,255,.1)', boxShadow: '0 16px 40px -16px #000a', backdropFilter: 'blur(2px)' }}>
              {it?.video_url ? <video src={it.video_url} muted loop autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : it?.output_url ? <img src={it.output_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', background: 'linear-gradient(160deg,#ffffff22,#ffffff08)' }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TOOLS = [
  { emoji: '🎬', name: 'Campaña UGC', desc: 'Video con persona IA usando tu producto', to: '/dashboard/creatives', grad: 'linear-gradient(135deg,#7c5cfc,#4a2fd0)' },
  { emoji: '🖼️', name: 'Anuncio de imagen', desc: 'Tu producto en creativos publicitarios', to: '/dashboard/creatives', grad: 'linear-gradient(135deg,#4da6ff,#2b6fd0)' },
  { emoji: '🎥', name: 'Video de producto', desc: 'Animá tu imagen en un reel', to: '/dashboard/creatives', grad: 'linear-gradient(135deg,#ff6ea9,#c92e7a)' },
  { emoji: '🧑‍🎤', name: 'Avatares', desc: 'Elegí o subí tu creador virtual', to: '/dashboard/brand', grad: 'linear-gradient(135deg,#00d68f,#00a06a)' },
  { emoji: '✍️', name: 'Copy publicitario', desc: 'Hooks, títulos, descripciones y CTA', to: '/dashboard/creatives', grad: 'linear-gradient(135deg,#ffb347,#e6902a)' },
  { emoji: '🎨', name: 'Mi marca', desc: 'Productos, voces y kit de marca', to: '/dashboard/brand', grad: 'linear-gradient(135deg,#a78bfa,#7c5cfc)' },
  { emoji: '🗂️', name: 'Proyectos', desc: 'Tus campañas guardadas', to: '/dashboard/projects', grad: 'linear-gradient(135deg,#5eead4,#14b8a6)' },
  { emoji: '📊', name: 'Reportes', desc: 'Rendimiento de tus campañas', to: '/dashboard/reports', grad: 'linear-gradient(135deg,#818cf8,#4f46e5)' },
];

function HomeTools({ navigate }: { navigate: (p: string) => void }) {
  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 16 }}>Herramientas</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 14 }}>
        {TOOLS.map(t => (
          <button key={t.name} onClick={() => navigate(t.to)} className="cv-card" style={{ textAlign: 'left', display: 'flex', gap: 14, alignItems: 'center', padding: 18, cursor: 'pointer', position: 'relative' }}>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: t.grad, display: 'grid', placeItems: 'center', fontSize: 22, flexShrink: 0, boxShadow: '0 8px 20px -8px #0009' }}>{t.emoji}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: '#e8e8f4' }}>{t.name}</div>
              <div style={{ fontSize: 12, color: '#666688', marginTop: 2 }}>{t.desc}</div>
            </div>
            <span style={{ color: '#666688', fontSize: 16, opacity: 0.7 }}>→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function HomeGallery({ navigate }: { navigate: (p: string) => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { creativeApi.list().then(setItems).catch(() => setItems([])); }, []);
  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 18 }}>Tus creativos</div>
        <button onClick={() => navigate('/dashboard/creatives')} className="cv-lift" style={{ background: 'transparent', border: '1px solid #1c1c2e', color: '#e8e8f4', borderRadius: 10, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Ver todos →</button>
      </div>
      {items && items.length === 0 ? (
        <div className="cv-card" style={{ padding: 52, textAlign: 'center', color: '#666688' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✨</div>
          <div style={{ color: '#e8e8f4', fontWeight: 700, marginBottom: 4 }}>Tu galería está vacía</div>
          <div style={{ fontSize: 14, marginBottom: 16 }}>Generá tu primera campaña y empezá a crear contenido que vende.</div>
          <button onClick={() => navigate('/dashboard/creatives')} className="cv-lift" style={{ background: 'linear-gradient(135deg,#7c5cfc,#4da6ff)', color: '#fff', border: 'none', borderRadius: 11, padding: '11px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>+ Crear campaña</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(158px,1fr))', gap: 14 }}>
          {(items ?? []).slice(0, 12).map(it => (
            <div key={it.id} onClick={() => navigate('/dashboard/creatives')} className="cv-card cv-thumb" style={{ overflow: 'hidden', cursor: 'pointer', padding: 0 }}>
              <div style={{ aspectRatio: '3/4', background: '#16162a', overflow: 'hidden' }}>
                {it.video_url ? <video src={it.video_url} muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : it.output_url ? <img src={it.output_url} alt={it.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#333355' }}>🎨</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Mock data ──────────────────────────────────────────────────────────────── */

// Datos reales — arrancan vacíos hasta que haya campañas/generaciones.
const MOCK_CAMPAIGNS: CampaignRow[] = [];
const MOCK_INSIGHTS: any[] = [];
const PERF_DATA: { day: string; roas: number; leads: number; ctr: number }[] = [];

const SPARKLINE_DATA = {
  roas:    [3, 5, 4, 7, 6, 8, 9, 11],
  leads:   [20, 25, 30, 28, 35, 38, 40, 45],
  active:  [4, 5, 5, 6, 6, 7, 7, 8],
  spent:   [60, 80, 70, 90, 95, 100, 110, 120],
};

const TYPE_TAG:  Record<string, 'tg' | 'tr' | 'ta' | 'tb'> = { scale: 'tg', pause: 'tr', warning: 'ta', optimize: 'tb', info: 'tb' };
const TYPE_ICON: Record<string, string> = { scale: '🚀', pause: '⏸️', optimize: '🎯', info: '💡', warning: '⚠️' };

/* ── Greeting ───────────────────────────────────────────────────────────────── */
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

/* ── Sparkline component ────────────────────────────────────────────────────── */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const d = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={d} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone" dataKey="v"
          stroke={color} strokeWidth={1.5}
          fill={`url(#spark-${color.replace('#', '')})`}
          dot={false} isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── Status helpers ─────────────────────────────────────────────────────────── */
const tagV = (s: string) => s === 'active' ? 'tg' : s === 'paused' ? 'tr' : 'ta';
const tagL = (s: string) => s === 'active' ? 'Activa' : s === 'paused' ? 'Pausada' : 'Optimizando';

/* ── Tooltip styles ─────────────────────────────────────────────────────────── */
const tooltipStyle = {
  background: '#0f0f1a',
  border: '1px solid #1c1c2e',
  borderRadius: 8,
  fontSize: 11,
  color: '#e8e8f4',
  boxShadow: '0 8px 24px #00000066',
};

/* ── Fade-up animation variant ──────────────────────────────────────────────── */
const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: .3, delay, ease: [.4, 0, .2, 1] as any },
});

/* ── Component ──────────────────────────────────────────────────────────────── */

export default function DashOverview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const firstName = user?.fullName?.split(' ')[0] ?? 'Equipo';

  const [campaigns, setCampaigns] = useState<CampaignRow[]>(MOCK_CAMPAIGNS);
  const [summary, setSummary]     = useState<DashboardSummary | null>(null);
  const [insights, setInsights]   = useState<any[]>(MOCK_INSIGHTS);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [campRes, sumRes] = await Promise.all([
          campaignsApi.getAll({ limit: 5 }),
          campaignsApi.getDashboardSummary(),
        ]);
        const list = (campRes.data as any)?.data?.campaigns ?? (campRes.data as any)?.campaigns ?? [];
        const sum  = (sumRes.data as any)?.data ?? sumRes.data;
        if (Array.isArray(list) && list.length > 0) setCampaigns(list);
        if (sum) setSummary(sum);
      } catch { /* keep mock */ }
      setLoading(false);
    })();
  }, []);

  const refreshInsights = async () => {
    setLoadingInsights(true);
    try {
      const res = await aiApi.analyzeUrl('', `Generá insights para ${campaigns.length} campañas`);
      const data = (res.data as any)?.data ?? res.data;
      if (Array.isArray(data) && data.length > 0) setInsights(data);
    } catch { /* keep mock */ }
    setLoadingInsights(false);
  };

  const activeCount   = summary?.campaigns?.active ?? campaigns.filter(c => c.status === 'active' || c.status === 'optimizing').length;
  const totalLeads    = summary?.metrics?.total_leads ? parseInt(String(summary.metrics.total_leads)) : campaigns.reduce((s, c) => s + c.leads, 0);
  const avgRoas       = summary?.metrics?.avg_roas ? parseFloat(summary.metrics.avg_roas).toFixed(1) + 'x' : '4.1x';
  const totalSpentUsd = summary?.metrics?.total_spent ? `$${(parseInt(String(summary.metrics.total_spent)) / 100).toFixed(0)}` : '$1,117';
  const leadsToday    = summary?.leadsToday ?? 14;

  const kpis = [
    {
      label: 'ROAS promedio',
      value: loading ? '—' : avgRoas,
      change: '+0.4x vs semana',
      up: true,
      icon: TrendingUp,
      color: '#00d68f',
      spark: SPARKLINE_DATA.roas,
    },
    {
      label: 'Leads totales',
      value: loading ? '—' : String(totalLeads),
      change: `+${leadsToday} hoy`,
      up: true,
      icon: Users,
      color: '#7c5cfc',
      spark: SPARKLINE_DATA.leads,
    },
    {
      label: 'Campañas activas',
      value: loading ? '—' : String(activeCount),
      change: 'en ejecución',
      up: true,
      icon: Target,
      color: '#4da6ff',
      spark: SPARKLINE_DATA.active,
    },
    {
      label: 'Gasto acumulado',
      value: loading ? '—' : totalSpentUsd,
      change: 'este período',
      up: false,
      icon: DollarSign,
      color: '#ffb347',
      spark: SPARKLINE_DATA.spent,
    },
  ];

  return (
    <div className="content">

      {/* ── Home: hero + herramientas + galería ─────────────────────────────── */}
      <div style={{ fontSize: 13, color: '#666688', marginBottom: 14 }}>{greeting()}, {firstName} 👋</div>
      <HomeHero navigate={navigate} />
      <HomeTools navigate={navigate} />
      <HomeGallery navigate={navigate} />

      {/* ── Resumen (métricas) ──────────────────────────────────────────────── */}
      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, marginBottom: 14 }}>Resumen</div>

      {/* ── KPI cards ───────────────────────────────────────────────────────── */}
      <div className="g4 mb-5">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <motion.div key={kpi.label} {...fadeUp(i * .06)} className="card" style={{ padding: 16 }}>
              <div className="flex items-start justify-between mb-3">
                <span className="text-[10px] text-muted font-mono uppercase tracking-wider leading-tight">{kpi.label}</span>
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: kpi.color + '1a' }}
                >
                  <Icon size={15} style={{ color: kpi.color }} />
                </div>
              </div>
              <div className="font-syne font-bold text-[28px] leading-none mb-1.5" style={{ color: kpi.color }}>
                {kpi.value}
              </div>
              <div className="flex items-center gap-1 text-[11px] mb-3" style={{ color: kpi.up ? '#00d68f' : '#ffb347' }}>
                {kpi.up ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {kpi.change}
              </div>
              <Sparkline data={kpi.spark} color={kpi.color} />
            </motion.div>
          );
        })}
      </div>

      {/* ── Performance chart + Campaigns ───────────────────────────────────── */}
      <div className="g2 mb-5">

        {/* Chart */}
        <motion.div {...fadeUp(.15)} className="card" style={{ padding: 18 }}>
          <div className="sh mb-4">
            <div>
              <div className="sh-title">Rendimiento semanal</div>
              <div className="sh-sub">ROAS + Leads últimos 7 días</div>
            </div>
            <Tag t="tg">En vivo</Tag>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={PERF_DATA} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1c1c2e" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: '#666688', fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#666688', fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: '#272740' }} />
              <Line type="monotone" dataKey="roas"  stroke="#00d68f" strokeWidth={2} dot={false} name="ROAS" />
              <Line type="monotone" dataKey="leads" stroke="#7c5cfc" strokeWidth={2} dot={false} name="Leads" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-3">
            {[{ color: '#00d68f', label: 'ROAS' }, { color: '#7c5cfc', label: 'Leads' }].map(l => (
              <div key={l.label} className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className="w-3 h-0.5 rounded-full" style={{ background: l.color }} />
                {l.label}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Campaigns table */}
        <motion.div {...fadeUp(.2)} className="card" style={{ padding: 18 }}>
          <div className="sh mb-4">
            <div>
              <div className="sh-title">Campañas recientes</div>
              <div className="sh-sub">{loading ? 'Cargando...' : 'Rendimiento actual'}</div>
            </div>
            <button
              onClick={() => navigate('/dashboard/campaigns')}
              className="flex items-center gap-1 text-[11px] text-muted hover:text-accent transition-colors font-mono"
            >
              Ver todas <ArrowRight size={11} />
            </button>
          </div>
          {loading ? (
            <div className="flex justify-center py-8"><Spinner size={20} /></div>
          ) : (
            <div className="flex flex-col gap-2">
              {campaigns.slice(0, 4).map(c => {
                const roas = parseFloat(c.roas ?? '0');
                return (
                  <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface2 transition-colors cursor-pointer" onClick={() => navigate('/dashboard/campaigns')}>
                    <div
                      className="w-2 h-8 rounded-full flex-shrink-0"
                      style={{ background: c.status === 'active' ? '#00d68f' : c.status === 'paused' ? '#ff4d6a' : '#ffb347' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-text truncate">{c.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Tag t={tagV(c.status) as any}>{tagL(c.status)}</Tag>
                        <span className="text-[10px] text-muted font-mono">{c.leads} leads</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div
                        className="font-mono text-[13px] font-semibold"
                        style={{ color: roas >= 3 ? '#00d68f' : roas >= 2 ? '#ffb347' : '#ff4d6a' }}
                      >
                        {normalizeRoas(c.roas)}
                      </div>
                      <div className="text-[10px] text-muted font-mono">{normalizeCtr(c.ctr)} CTR</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>

      {/* ── AI Insights + Quick actions ──────────────────────────────────────── */}
      <div className="g2 mb-5">

        {/* Insights */}
        <motion.div {...fadeUp(.25)} className="card" style={{ padding: 18 }}>
          <div className="sh mb-4">
            <div>
              <div className="sh-title flex items-center gap-2">
                Insights IA
                <div className="ai-dots"><div className="ai-dot" /><div className="ai-dot" /><div className="ai-dot" /></div>
              </div>
              <div className="sh-sub">Recomendaciones inteligentes</div>
            </div>
            <button
              onClick={refreshInsights}
              disabled={loadingInsights}
              className="flex items-center gap-1.5 text-[11px] text-accent hover:opacity-80 transition-opacity font-mono disabled:opacity-50"
            >
              <RefreshCw size={11} className={loadingInsights ? 'animate-spin' : ''} />
              Actualizar
            </button>
          </div>
          {loadingInsights ? (
            <div className="flex justify-center py-8"><Spinner size={20} /></div>
          ) : (
            <div className="flex flex-col gap-1">
              {insights.map((ins: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-surface2 transition-colors cursor-pointer">
                  <span className="text-[16px] flex-shrink-0 mt-0.5">
                    {TYPE_ICON[ins.type ?? ins.x] ?? '💡'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-text leading-tight">{ins.title ?? ins.t}</div>
                    <div className="text-[11px] text-muted mt-0.5 leading-tight">{ins.detail}</div>
                  </div>
                  <Tag t={TYPE_TAG[ins.type] ?? 'tb'}>
                    {ins.action ?? (ins.x === 'tg' ? 'Escalar' : ins.x === 'tr' ? 'Pausar' : 'Optimizar')}
                  </Tag>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Quick actions */}
        <motion.div {...fadeUp(.3)} className="flex flex-col gap-3">
          {[
            { icon: Sparkles,  label: 'Nueva campaña',   sub: 'IA la configura en 60 seg', color: '#7c5cfc', path: '/dashboard/new-campaign' },
            { icon: Wand2,     label: 'Generar creativos', sub: 'Video + imágenes automáticas', color: '#4da6ff', path: '/dashboard/creatives' },
            { icon: BarChart3, label: 'Ver informes',    sub: 'Análisis con insights de IA', color: '#00d68f', path: '/dashboard/reports' },
          ].map(({ icon: Icon, label, sub, color, path }, i) => (
            <motion.div
              key={path}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: .3, delay: .3 + i * .08 }}
              onClick={() => navigate(path)}
              className="card flex items-center gap-4 cursor-pointer group hover:border-[color:var(--c)] transition-all duration-200"
              style={{ '--c': color + '66', padding: '14px 16px' } as React.CSSProperties}
              onMouseEnter={e => (e.currentTarget.style.borderColor = color + '66')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '')}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: color + '1a' }}
              >
                <Icon size={18} style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-syne font-semibold text-[13px] text-text">{label}</div>
                <div className="text-[11px] text-muted mt-0.5">{sub}</div>
              </div>
              <ArrowRight size={16} className="text-muted group-hover:text-accent transition-colors" style={{ color: undefined }} />
            </motion.div>
          ))}

          {/* Activity summary */}
          <motion.div
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .3, delay: .56 }}
            className="card"
            style={{ padding: '14px 16px' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Zap size={13} className="text-accent" />
              <span className="text-[11px] text-muted font-mono uppercase tracking-wider">Actividad reciente</span>
            </div>
            {thumbs.length === 0 ? (
              <div className="text-[12px] text-muted" style={{ padding: '6px 0' }}>Sin actividad reciente todavía.</div>
            ) : thumbs.slice(0, 3).map((t: any, i: number) => (
              <div key={t.id ?? i} className="act-item">
                <div className="act-dot mt-1.5 flex-shrink-0" style={{ background: '#4da6ff' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-text leading-tight" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name || 'Creativo generado con IA'}</div>
                  <div className="text-[10px] text-muted mt-0.5 font-mono">{t.created_at ? new Date(t.created_at).toLocaleDateString('es-AR') : ''}</div>
                </div>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </div>

      {/* ── Metrics bottom strip ─────────────────────────────────────────────── */}
      <motion.div {...fadeUp(.35)} className="g4">
        {[
          { label: 'CTR promedio',  value: '4.2%',  icon: TrendingUp,   color: '#00d68f' },
          { label: 'CPC promedio',  value: '$0.38', icon: DollarSign,   color: '#7c5cfc' },
          { label: 'Impresiones',   value: '63.7K', icon: Megaphone,    color: '#4da6ff' },
          { label: 'Conversiones',  value: '12.3%', icon: TrendingDown, color: '#ffb347' },
        ].map((m, i) => {
          const Icon = m.icon;
          return (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: .25, delay: .38 + i * .05 }}
              className="card flex items-center gap-3"
              style={{ padding: '12px 14px' }}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: m.color + '1a' }}>
                <Icon size={15} style={{ color: m.color }} />
              </div>
              <div>
                <div className="text-[10px] text-muted font-mono uppercase tracking-wider leading-none mb-1">{m.label}</div>
                <div className="font-syne font-bold text-[18px] leading-none" style={{ color: m.color }}>{m.value}</div>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

    </div>
  );
}
