import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AreaChart, Area, BarChart, Bar, ResponsiveContainer,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Users, DollarSign,
  Download, RefreshCw, Zap, ChevronRight, Brain,
  BarChart3,
} from 'lucide-react';
import { Tag, Spinner } from '../../components/ui';
import { reportsApi, type ReportRow } from '../../api/reports';
import api from '../../api/client';

/* ── Static data ──────────────────────────────────────────────────────────── */

// Datos reales — vacíos hasta que haya campañas/generaciones.
const MOCK_CAMPAIGNS: { id: number; name: string; roas: string; leads: number; ctr: string; spent: string }[] = [];
const WEEKLY_DATA: { day: string; roas: number; leads: number; cpm: number }[] = [];

const INSIGHT_TYPE_ICON: Record<string, string>             = { scale: '🚀', pause: '⏸️', optimize: '🎯', info: '💡', warning: '⚠️' };
const INSIGHT_TYPE_TAG:  Record<string, 'tg'|'ta'|'tb'|'tr'> = { scale: 'tg', warning: 'ta', info: 'tb', optimize: 'tb', pause: 'tr' };

const tooltipStyle = {
  background: '#0f0f1a', border: '1px solid #1c1c2e',
  borderRadius: 8, fontSize: 11, color: '#e8e8f4',
  boxShadow: '0 8px 24px #00000066',
};

/* ── PDF generator (unchanged logic) ─────────────────────────────────────── */
function generatePDF(rows: typeof MOCK_CAMPAIGNS, insights?: any[]) {
  const date = new Date().toLocaleDateString('es-AR');
  const rowsHtml = rows.map(c => `
    <tr>
      <td>${c.name}</td>
      <td class="${parseFloat(c.roas) >= 3 ? 'green' : 'red'}">${c.roas}</td>
      <td>${c.ctr}</td><td>${c.spent}</td>
      <td class="purple">${c.leads}</td>
    </tr>`).join('');
  const insightSection = insights?.length ? `
    <h2>🤖 Insights IA</h2>
    <ul>${insights.map(i => `<li><strong>${i.title ?? i.t ?? ''}</strong>: ${i.detail ?? i.action ?? ''}</li>`).join('')}</ul>
  ` : '';
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Informe — ${date}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#1a1a2e;padding:40px}
.header{background:linear-gradient(135deg,#7c5cfc,#4da6ff);color:#fff;padding:28px 32px;border-radius:12px;margin-bottom:28px}
.header h1{font-size:22px;font-weight:800;margin-bottom:4px}.header p{font-size:13px;opacity:.8}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px}
.kpi{border:1px solid #e0e0f0;border-radius:10px;padding:16px;text-align:center}
.kpi-lbl{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}
.kpi-val{font-size:26px;font-weight:800}
.green{color:#00b877}.red{color:#e0003c}.purple{color:#7c5cfc}.amber{color:#e08800}
h2{font-size:16px;font-weight:700;margin:24px 0 14px;border-bottom:2px solid #f0f0ff;padding-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:28px}
th{text-align:left;padding:8px 10px;background:#f8f8ff;color:#666;font-size:10px;text-transform:uppercase;border-bottom:2px solid #e0e0f0}
td{padding:9px 10px;border-bottom:1px solid #f0f0f8}
ul{padding-left:20px;display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:1.6;margin-bottom:20px}
.footer{text-align:center;font-size:11px;color:#aaa;border-top:1px solid #f0f0f8;padding-top:18px;margin-top:28px}
</style></head><body>
<div class="header"><h1>📊 Informe CONVERSIA ADS — ${date}</h1><p>Generado automáticamente a las 20:00 hs</p></div>
<div class="kpis">
  <div class="kpi"><div class="kpi-lbl">ROAS Promedio</div><div class="kpi-val green">3.8x</div></div>
  <div class="kpi"><div class="kpi-lbl">Leads WhatsApp</div><div class="kpi-val purple">342</div></div>
  <div class="kpi"><div class="kpi-lbl">CPC Promedio</div><div class="kpi-val">$0.52</div></div>
  <div class="kpi"><div class="kpi-lbl">Gasto Total</div><div class="kpi-val amber">$1,358</div></div>
</div>
<h2>📣 Detalle de campañas</h2>
<table><thead><tr><th>Campaña</th><th>ROAS</th><th>CTR</th><th>Gasto</th><th>Leads</th></tr></thead><tbody>${rowsHtml}</tbody></table>
${insightSection}
<div class="footer">CONVERSIA ADS · Informe automático · ${date}</div>
</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `informe-${date.replace(/\//g, '-')}.html`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export default function Reports() {
  const [downloading,        setDownloading]        = useState(false);
  const [generatingReport,   setGeneratingReport]   = useState(false);
  const [generatingInsights, setGeneratingInsights] = useState(false);
  const [reports,            setReports]            = useState<ReportRow[]>([]);
  const [aiInsights,         setAiInsights]         = useState<any[]>([]);
  const [loadingReports,     setLoadingReports]     = useState(true);
  const [toast,              setToast]              = useState('');

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500); };

  const loadReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      const res  = await reportsApi.getAll();
      const list = (res.data as any)?.data?.reports ?? (res.data as any)?.reports ?? [];
      if (Array.isArray(list)) setReports(list);
    } catch { /* keep empty */ }
    setLoadingReports(false);
  }, []);

  useEffect(() => { loadReports(); }, [loadReports]);

  const handlePDF = () => {
    setDownloading(true);
    setTimeout(() => { generatePDF(MOCK_CAMPAIGNS, aiInsights); setDownloading(false); }, 400);
  };

  const handleGenerateReport = async () => {
    setGeneratingReport(true);
    try {
      await reportsApi.generate();
      await loadReports();
      showToast('Informe generado correctamente');
    } catch {
      showToast('Sin datos de campaña para generar informe');
    }
    setGeneratingReport(false);
  };

  const handleGenerateInsights = async () => {
    setGeneratingInsights(true);
    try {
      const res  = await api.post('/ai/insights', { campaigns: MOCK_CAMPAIGNS });
      const data = (res.data as any)?.data ?? res.data;
      if (Array.isArray(data) && data.length > 0) { setAiInsights(data); showToast('Insights de IA generados'); }
    } catch {
      showToast('IA no disponible — configurá ANTHROPIC_API_KEY en Railway');
    }
    setGeneratingInsights(false);
  };

  const latestReport   = reports[0];
  const latestInsights = latestReport?.insights ?? [];

  const displayInsights: { i: string; t: string; detail?: string; x: 'tg'|'ta'|'tb'|'tr' }[] =
    aiInsights.length > 0
      ? aiInsights.map(ins => ({ i: INSIGHT_TYPE_ICON[ins.type] ?? '💡', t: ins.title, detail: ins.detail, x: INSIGHT_TYPE_TAG[ins.type] ?? 'tb' }))
      : latestInsights.length > 0
      ? latestInsights.map((ins: any) => ({ i: INSIGHT_TYPE_ICON[ins.type] ?? '💡', t: ins.title, detail: ins.detail ?? ins.action, x: INSIGHT_TYPE_TAG[ins.type] ?? 'tb' }))
      : [] as { i: string; t: string; detail: string; x: 'tg' | 'ta' | 'tb' }[];

  const campaignRows = latestReport?.summary
    ? MOCK_CAMPAIGNS.map((c, i) => ({
        ...c,
        roas: i === 0 ? `${(latestReport.summary.avgRoas ?? 4.1).toFixed(1)}x` : c.roas,
        leads: i === 0 ? latestReport.summary.totalLeads : c.leads,
      }))
    : MOCK_CAMPAIGNS;

  const fadeUp = (delay = 0) => ({
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: .25, delay },
  });

  return (
    <div className="content">

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
            transition={{ duration: .2 }}
            className="fixed top-4 right-4 z-[999] bg-surface border border-border rounded-xl px-4 py-3 text-[13px] text-text flex items-center gap-2.5"
            style={{ boxShadow: '0 8px 32px #00000066' }}
          >
            <span className="w-2 h-2 rounded-full bg-green flex-shrink-0" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <motion.div {...fadeUp(0)} className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="font-syne font-extrabold text-[22px] text-text leading-tight mb-1">Reportes & Analytics</h2>
          <p className="text-[13px] text-muted">
            {loadingReports ? 'Cargando...' : latestReport
              ? `Último informe: ${new Date(latestReport.created_at).toLocaleDateString('es-AR')}`
              : 'Resumen de rendimiento de campañas'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-g flex items-center gap-1.5" style={{ fontSize: 12 }}
            onClick={handleGenerateInsights} disabled={generatingInsights}>
            {generatingInsights ? <Spinner size={12} /> : <Brain size={13} />}
            Insights IA
          </button>
          <button className="btn btn-g flex items-center gap-1.5" style={{ fontSize: 12 }}
            onClick={handleGenerateReport} disabled={generatingReport}>
            {generatingReport ? <Spinner size={12} /> : <Zap size={13} />}
            Generar
          </button>
          <button className="btn btn-p flex items-center gap-1.5" style={{ fontSize: 12 }}
            onClick={handlePDF} disabled={downloading}>
            {downloading ? <Spinner size={12} /> : <Download size={13} />}
            Descargar PDF
          </button>
        </div>
      </motion.div>

      {/* ── KPI strip ───────────────────────────────────────────────────────── */}
      <div className="g4 mb-5">
        {[
          { label: 'ROAS promedio',  value: latestReport ? `${(latestReport.summary.avgRoas ?? 3.8).toFixed(1)}x` : '3.8x', change: '+0.4x esta semana',   icon: TrendingUp,   color: '#00d68f' },
          { label: 'CPM promedio',   value: '$4.20',  change: '-$0.80 vs anterior',     icon: TrendingDown, color: '#4da6ff' },
          { label: 'Leads totales',  value: latestReport ? String(latestReport.summary.totalLeads ?? 342) : '342', change: '+5% vs mes ant.', icon: Users, color: '#7c5cfc' },
          { label: 'Costo / lead',   value: '$1.80',  change: '-$0.40 vs mes ant.',     icon: DollarSign,   color: '#ffb347' },
        ].map((k, i) => {
          const Icon = k.icon;
          return (
            <motion.div key={k.label} {...fadeUp(i * .06)} className="card" style={{ padding: '14px 16px' }}>
              <div className="flex items-start justify-between mb-2">
                <span className="text-[10px] text-muted font-mono uppercase tracking-wider">{k.label}</span>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: k.color + '1a' }}>
                  <Icon size={14} style={{ color: k.color }} />
                </div>
              </div>
              <div className="font-syne font-bold text-[26px] leading-none mb-1" style={{ color: k.color }}>{k.value}</div>
              <div className="text-[11px]" style={{ color: '#00d68f' }}>▲ {k.change}</div>
            </motion.div>
          );
        })}
      </div>

      {/* ── Charts row ──────────────────────────────────────────────────────── */}
      <div className="g2 mb-5">

        {/* ROAS + Leads area chart */}
        <motion.div {...fadeUp(.15)} className="card" style={{ padding: 18 }}>
          <div className="sh mb-4">
            <div>
              <div className="sh-title">ROAS semanal</div>
              <div className="sh-sub">Evolución últimos 7 días</div>
            </div>
            <Tag t="tg">+14% semana</Tag>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={WEEKLY_DATA} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-roas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00d68f" stopOpacity={.25} />
                  <stop offset="100%" stopColor="#00d68f" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1c1c2e" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: '#666688', fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#666688', fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: '#272740' }} />
              <Area type="monotone" dataKey="roas" stroke="#00d68f" strokeWidth={2} fill="url(#grad-roas)" dot={false} name="ROAS" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Leads bar chart */}
        <motion.div {...fadeUp(.2)} className="card" style={{ padding: 18 }}>
          <div className="sh mb-4">
            <div>
              <div className="sh-title">Leads por día</div>
              <div className="sh-sub">WhatsApp + formularios</div>
            </div>
            <Tag t="tp">342 total</Tag>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={WEEKLY_DATA} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1c1c2e" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: '#666688', fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#666688', fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#1c1c2e' }} />
              <Bar dataKey="leads" fill="#7c5cfc" radius={[4, 4, 0, 0]} name="Leads" />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* ── Campaign performance + Insights ─────────────────────────────────── */}
      <div className="g2 mb-5">

        {/* Campaign performance */}
        <motion.div {...fadeUp(.25)} className="card" style={{ padding: 18 }}>
          <div className="sh mb-4">
            <div>
              <div className="sh-title flex items-center gap-2">
                <BarChart3 size={14} className="text-muted" />
                Rendimiento por campaña
              </div>
              <div className="sh-sub">ROAS vs objetivo (3x mínimo)</div>
            </div>
          </div>
          <div className="flex flex-col gap-3.5">
            {campaignRows.map(c => {
              const roas  = parseFloat(c.roas);
              const pct   = Math.min(100, roas / 6 * 100);
              const color = roas >= 3 ? '#00d68f' : roas >= 2 ? '#ffb347' : '#ff4d6a';
              return (
                <div key={c.id}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[12px] font-medium text-text truncate pr-2">{c.name}</span>
                    <span className="font-mono text-[12px] font-semibold flex-shrink-0" style={{ color }}>{c.roas}</span>
                  </div>
                  <div className="h-1.5 bg-border rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                      transition={{ duration: .6, delay: .3 }}
                      className="h-full rounded-full"
                      style={{ background: color }}
                    />
                  </div>
                  <div className="flex justify-between mt-1 text-[10px] text-muted font-mono">
                    <span>{c.leads} leads</span>
                    <span>CTR {c.ctr}</span>
                    <span>{c.spent}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {reports.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-[10px] text-muted font-mono uppercase tracking-wider mb-2.5">Historial de informes</div>
              {reports.slice(0, 4).map(r => (
                <div key={r.id} className="flex justify-between items-center py-1.5 border-b border-border/20 text-[12px]">
                  <span className="text-text">{new Date(r.period_start).toLocaleDateString('es-AR')} — {r.type}</span>
                  <Tag t="tb">{r.summary.totalLeads} leads</Tag>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* AI Insights */}
        <motion.div {...fadeUp(.3)} className="card" style={{ padding: 18 }}>
          <div className="sh mb-4">
            <div>
              <div className="sh-title flex items-center gap-2">
                Insights IA
                <div className="ai-dots"><div className="ai-dot" /><div className="ai-dot" /><div className="ai-dot" /></div>
              </div>
              <div className="sh-sub">Recomendaciones generadas por Claude</div>
            </div>
            <button
              onClick={handleGenerateInsights} disabled={generatingInsights}
              className="flex items-center gap-1.5 text-[11px] text-accent hover:opacity-80 transition-opacity font-mono disabled:opacity-50"
            >
              <RefreshCw size={11} className={generatingInsights ? 'animate-spin' : ''} />
              Actualizar
            </button>
          </div>

          {generatingInsights ? (
            <div className="flex justify-center py-8"><Spinner size={20} /></div>
          ) : (
            <div className="flex flex-col gap-1">
              {displayInsights.map((ins, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl hover:bg-surface2 transition-colors cursor-pointer group">
                  <span className="text-[16px] flex-shrink-0 mt-0.5">{ins.i}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-text">{ins.t}</div>
                    {ins.detail && <div className="text-[11px] text-muted mt-0.5">{ins.detail}</div>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Tag t={ins.x}>{ins.x === 'tg' ? 'Bien' : ins.x === 'ta' ? 'Atención' : ins.x === 'tr' ? 'Pausar' : 'Info'}</Tag>
                    <ChevronRight size={12} className="text-dim group-hover:text-muted transition-colors" />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 p-3 bg-green/10 border border-green/20 rounded-xl flex items-center justify-between">
            <div className="text-[12px] text-green flex items-center gap-2">
              <Zap size={12} />
              Próximo informe hoy a las 20:00 hs
            </div>
            <button
              className="text-[11px] text-green hover:opacity-80 font-mono transition-opacity"
              onClick={handleGenerateReport} disabled={generatingReport}
            >
              {generatingReport ? <Spinner size={10} /> : 'Generar ahora →'}
            </button>
          </div>
        </motion.div>
      </div>

    </div>
  );
}
