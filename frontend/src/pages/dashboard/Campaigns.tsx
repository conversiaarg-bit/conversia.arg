import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Filter, Plus, Play, Pause, RefreshCw,
  TrendingUp, TrendingDown, ChevronUp, ChevronDown,
  BarChart2, Users, DollarSign, MoreVertical, Zap, Award, Rocket,
} from 'lucide-react';
import { Tag, Spinner } from '../../components/ui';
import {
  campaignsApi, type CampaignRow,
  formatBudget, formatSpent, formatCpc, normalizeCtr, normalizeRoas,
} from '../../api/campaigns';

const STATUS_COLORS: Record<string, string> = {
  active:     '#00d68f',
  optimizing: '#ffb347',
  paused:     '#ff4d6a',
};

export default function Campaigns() {
  const navigate  = useNavigate();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [actionId,  setActionId]  = useState<string | null>(null);
  const [search,    setSearch]    = useState('');
  const [filter,    setFilter]    = useState('Todas');
  const [toast,     setToast]     = useState('');
  const [sortKey,   setSortKey]   = useState<string>('leads');
  const [sortAsc,   setSortAsc]   = useState(false);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3200); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await campaignsApi.getAll({ limit: 50 });
      const list = (res.data as any)?.data?.campaigns ?? (res.data as any)?.campaigns ?? [];
      setCampaigns(Array.isArray(list) ? list : []);
    } catch { setCampaigns([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleCampaign = async (c: CampaignRow) => {
    setActionId(c.id);
    try {
      if (c.status === 'active' || c.status === 'optimizing') {
        await campaignsApi.pause(c.id);
        setCampaigns(p => p.map(x => x.id === c.id ? { ...x, status: 'paused' } : x));
        showToast(`Campaña pausada: "${c.name}"`);
      } else {
        await campaignsApi.resume(c.id);
        setCampaigns(p => p.map(x => x.id === c.id ? { ...x, status: 'active' } : x));
        showToast(`Campaña activada: "${c.name}"`);
      }
    } catch {
      showToast('Conectá Meta Ads para gestionar campañas');
    }
    setActionId(null);
  };

  const publishCampaign = async (c: CampaignRow) => {
    setActionId(c.id);
    try {
      await campaignsApi.publish(c.id);
      setCampaigns(p => p.map(x => x.id === c.id ? { ...x, status: 'active' } : x));
      showToast(`Campaña publicada en Meta: "${c.name}"`);
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'No se pudo publicar. Conectá Meta Ads y revisá los datos de la campaña.');
    }
    setActionId(null);
  };

  const handleSort = (key: string) => {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(false); }
  };

  const tagVariant = (s: string) => s === 'active' ? 'tg' : s === 'paused' ? 'tr' : s === 'optimizing' ? 'ta' : 'tb';
  const statusLabel = (s: string) => s === 'active' ? 'Activa' : s === 'paused' ? 'Pausada' : s === 'optimizing' ? 'Optimizando' : s === 'draft' ? 'Borrador' : s;

  const filtered = campaigns
    .filter(c => {
      const matchSearch = c.name.toLowerCase().includes(search.toLowerCase());
      const matchFilter =
        filter === 'Todas' ||
        (filter === 'Activas' && (c.status === 'active' || c.status === 'optimizing')) ||
        (filter === 'Pausadas' && c.status === 'paused');
      return matchSearch && matchFilter;
    })
    .sort((a, b) => {
      let va: number, vb: number;
      if (sortKey === 'roas')   { va = parseFloat(a.roas ?? '0'); vb = parseFloat(b.roas ?? '0'); }
      else if (sortKey === 'ctr') { va = parseFloat(a.ctr ?? '0'); vb = parseFloat(b.ctr ?? '0'); }
      else if (sortKey === 'leads') { va = a.leads; vb = b.leads; }
      else if (sortKey === 'spent') { va = a.total_spent_cents; vb = b.total_spent_cents; }
      else return 0;
      return sortAsc ? va - vb : vb - va;
    });

  const summaryStats = {
    active:  campaigns.filter(c => c.status === 'active' || c.status === 'optimizing').length,
    paused:  campaigns.filter(c => c.status === 'paused').length,
    leads:   campaigns.reduce((s, c) => s + c.leads, 0),
    spent:   campaigns.reduce((s, c) => s + c.total_spent_cents, 0),
  };

  const SortIcon = ({ k }: { k: string }) =>
    sortKey === k
      ? sortAsc ? <ChevronUp size={11} className="text-accent" /> : <ChevronDown size={11} className="text-accent" />
      : null;

  return (
    <div className="content">

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: .96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: .96 }}
            transition={{ duration: .2 }}
            className="fixed top-4 right-4 z-[999] bg-surface border border-border rounded-xl px-4 py-3 text-[13px] text-text flex items-center gap-2.5"
            style={{ boxShadow: '0 8px 32px #00000066' }}
          >
            <span className="w-2 h-2 rounded-full bg-green flex-shrink-0" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-5">
        <h1 className="font-syne font-extrabold" style={{ fontSize: 26, margin: '0 0 4px' }}>Campañas</h1>
        <div className="text-muted text-[14px]">Gestioná y optimizá todas tus campañas en un solo lugar.</div>
      </div>

      {/* ── Summary strip ─────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25 }}
        className="g4 mb-5"
      >
        {[
          { label: 'Activas',       value: summaryStats.active, sub: 'Campañas en ejecución', icon: TrendingUp,   color: '#00d68f' },
          { label: 'Pausadas',      value: summaryStats.paused, sub: 'Campañas pausadas',     icon: TrendingDown, color: '#ff4d6a' },
          { label: 'Leads totales', value: summaryStats.leads,  sub: 'Leads generados',       icon: Users,        color: '#7c5cfc' },
          { label: 'Gasto total',   value: `$${(summaryStats.spent / 100).toLocaleString('es-AR')}`, sub: 'Total invertido', icon: DollarSign, color: '#ffb347' },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: .22, delay: i * .06 }}
              className="card"
              style={{ padding: 16 }}
            >
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: s.color + '1a' }}>
                  <Icon size={16} style={{ color: s.color }} />
                </div>
                <Spark seed={i + 2} color={s.color} />
              </div>
              <div className="text-[10px] text-muted font-mono uppercase tracking-wider" style={{ marginTop: 12 }}>{s.label}</div>
              <div className="font-syne font-bold" style={{ fontSize: 26, lineHeight: 1.1, color: s.color }}>{s.value}</div>
              <div className="text-[11px] text-dim" style={{ marginTop: 2 }}>{s.sub}</div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25, delay: .1 }}
        className="flex items-center gap-3 mb-4 flex-wrap"
      >
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            className="finput"
            placeholder="Buscar campaña..."
            style={{ paddingLeft: 32, maxWidth: 240, width: 240 }}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Filter */}
        <div className="relative flex items-center gap-1 bg-bg border border-border rounded-lg overflow-hidden">
          <Filter size={12} className="text-muted ml-2.5 flex-shrink-0" />
          <select
            className="fsel"
            style={{ border: 'none', background: 'transparent', paddingLeft: 6, width: 120 }}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            <option>Todas</option>
            <option>Activas</option>
            <option>Pausadas</option>
          </select>
        </div>

        <button onClick={load} disabled={loading} className="btn btn-g flex items-center gap-1.5" style={{ padding: '7px 12px', fontSize: 12 }}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>

        <div className="ml-auto flex items-center gap-2">
          {loading && <Spinner size={16} />}
          <span className="text-[11px] text-muted font-mono">{filtered.length} campaña{filtered.length !== 1 ? 's' : ''}</span>
          <button
            onClick={() => navigate('/dashboard/new-campaign')}
            className="btn btn-p flex items-center gap-1.5"
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            <Plus size={13} />
            Nueva
          </button>
        </div>
      </motion.div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25, delay: .15 }}
        className="card"
        style={{ padding: 0, overflow: 'hidden' }}
      >
        <div className="tbl-scroll">
          <table style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Campaña</th>
                <th>Estado</th>
                <th>Presupuesto</th>
                <th
                  className="cursor-pointer select-none hover:text-text transition-colors"
                  onClick={() => handleSort('spent')}
                >
                  <div className="flex items-center gap-1">Gastado <SortIcon k="spent" /></div>
                </th>
                <th
                  className="cursor-pointer select-none hover:text-text transition-colors"
                  onClick={() => handleSort('ctr')}
                >
                  <div className="flex items-center gap-1">CTR <SortIcon k="ctr" /></div>
                </th>
                <th>CPC</th>
                <th
                  className="cursor-pointer select-none hover:text-text transition-colors"
                  onClick={() => handleSort('leads')}
                >
                  <div className="flex items-center gap-1">Leads <SortIcon k="leads" /></div>
                </th>
                <th
                  className="cursor-pointer select-none hover:text-text transition-colors"
                  onClick={() => handleSort('roas')}
                >
                  <div className="flex items-center gap-1">ROAS <SortIcon k="roas" /></div>
                </th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '48px 20px' }}>
                    <div className="flex flex-col items-center gap-3">
                      <BarChart2 size={32} className="text-dim" />
                      <div className="text-[13px] text-muted">No hay campañas que coincidan</div>
                      <button className="btn btn-p" style={{ fontSize: 12 }} onClick={() => navigate('/dashboard/new-campaign')}>
                        <Plus size={13} /> Crear campaña
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {filtered.map((c, i) => {
                const roas = parseFloat(c.roas ?? '0');
                const roasColor = roas >= 3 ? '#00d68f' : roas >= 1.5 ? '#ffb347' : '#ff4d6a';
                const isActive = c.status === 'active' || c.status === 'optimizing';
                const sc = STATUS_COLORS[c.status] ?? '#666688';
                const pct = Math.min(100, Math.round(c.total_spent_cents / Math.max(1, c.daily_budget_cents * 30) * 100));
                return (
                  <motion.tr
                    key={c.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * .04 }}
                  >
                    <td style={{ paddingLeft: 20 }}>
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0" style={{ width: 38, height: 38, borderRadius: 11, background: sc + '22', border: `1px solid ${sc}44`, display: 'grid', placeItems: 'center', fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 15, color: sc }}>
                          {(c.name || '?').trim().charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className="text-[13px] font-semibold text-text" style={{ whiteSpace: 'nowrap' }}>{c.name}</div>
                          <div className="text-[11px] text-muted flex items-center gap-1.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: sc }} />
                            {c.impressions ? `${(c.impressions / 1000).toFixed(1)}K impresiones` : 'Campaña Meta Ads'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><Tag t={tagVariant(c.status) as any}>{statusLabel(c.status)}</Tag></td>
                    <td className="font-mono text-[12px]">{formatBudget(c.daily_budget_cents)}<div className="text-dim text-[10px]">Diario</div></td>
                    <td style={{ minWidth: 130 }}>
                      <div className="font-mono text-[12px]">{formatSpent(c.total_spent_cents)}</div>
                      <div style={{ height: 5, borderRadius: 3, background: 'var(--surface2,#1a1a2e)', overflow: 'hidden', margin: '4px 0 3px', maxWidth: 110 }}>
                        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: pct >= 90 ? '#ff4d6a' : '#00d68f' }} />
                      </div>
                      <div className="text-dim text-[10px]">{pct}% del presupuesto</div>
                    </td>
                    <td className="font-mono text-[12px]" style={{ color: parseFloat(c.ctr ?? '0') >= 4 ? '#00d68f' : undefined }}>{normalizeCtr(c.ctr)}</td>
                    <td className="font-mono text-[12px]">{formatCpc(c.cpc_cents)}</td>
                    <td className="font-mono text-[13px] font-semibold" style={{ color: '#7c5cfc' }}>{c.leads}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold" style={{ color: roasColor }}>{normalizeRoas(c.roas)}</span>
                        <Spark seed={i + roas} color={roasColor} w={46} h={20} />
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        {c.status === 'draft' ? (
                          <button
                            className="btn btn-p flex items-center gap-1.5"
                            style={{ padding: '5px 11px', fontSize: 11 }}
                            onClick={() => publishCampaign(c)}
                            disabled={actionId === c.id}
                          >
                            {actionId === c.id ? <Spinner size={11} /> : <><Rocket size={11} /> Publicar</>}
                          </button>
                        ) : (
                          <button
                            className={`btn ${isActive ? 'btn-d' : 'btn-green'} flex items-center gap-1.5`}
                            style={{ padding: '5px 11px', fontSize: 11 }}
                            onClick={() => toggleCampaign(c)}
                            disabled={actionId === c.id}
                          >
                            {actionId === c.id
                              ? <Spinner size={11} />
                              : isActive ? <><Pause size={11} /> Pausar</> : <><Play size={11} /> Activar</>
                            }
                          </button>
                        )}
                        <button className="flex-shrink-0" style={{ background: 'transparent', border: 'none', color: 'var(--muted,#8a8aa0)', cursor: 'pointer', padding: 4, borderRadius: 6 }} title="Más opciones"><MoreVertical size={15} /></button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* ── Insights de rendimiento ───────────────────────────────────────── */}
      {campaigns.length > 0 && (() => {
        const byCtr = [...campaigns].sort((a, b) => parseFloat(b.ctr ?? '0') - parseFloat(a.ctr ?? '0'))[0];
        const byLeads = [...campaigns].sort((a, b) => b.leads - a.leads)[0];
        const byRoas = [...campaigns].sort((a, b) => parseFloat(b.roas ?? '0') - parseFloat(a.roas ?? '0'))[0];
        const first = (n: string) => (n || '').split(' ')[0];
        return (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25, delay: .2 }}
            className="card mt-5 flex items-center gap-5 flex-wrap"
            style={{ padding: '16px 20px' }}
          >
            <div className="flex items-center gap-3" style={{ marginRight: 'auto' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#7c5cfc22' }}>
                <BarChart2 size={18} style={{ color: '#7c5cfc' }} />
              </div>
              <div>
                <div className="font-syne font-bold text-[15px]">Insights de rendimiento</div>
                <div className="text-muted text-[12px]">Tus campañas activas están funcionando muy bien.</div>
              </div>
            </div>
            {[
              { icon: TrendingUp, label: 'Mejor CTR', value: normalizeCtr(byCtr.ctr), sub: first(byCtr.name), color: '#00d68f' },
              { icon: Zap, label: 'Más leads', value: `${byLeads.leads}`, sub: first(byLeads.name), color: '#7c5cfc' },
              { icon: Award, label: 'Mejor ROAS', value: normalizeRoas(byRoas.roas), sub: first(byRoas.name), color: '#ffb347' },
            ].map(s => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="flex items-center gap-2.5">
                  <Icon size={16} style={{ color: s.color }} />
                  <div>
                    <div className="text-[10px] text-muted uppercase tracking-wide">{s.label}</div>
                    <div className="font-syne font-bold text-[16px]" style={{ color: s.color, lineHeight: 1.1 }}>{s.value}</div>
                    <div className="text-dim text-[10px]">{s.sub}</div>
                  </div>
                </div>
              );
            })}
            <button onClick={() => navigate('/dashboard/reports')} className="btn btn-g" style={{ fontSize: 12, padding: '8px 14px' }}>Ver reporte completo</button>
          </motion.div>
        );
      })()}

    </div>
  );
}

// Mini sparkline decorativo (tendencia suave determinística, sin datos inventados)
function Spark({ seed, color, w = 64, h = 26 }: { seed: number; color: string; w?: number; h?: number }) {
  const pts = Array.from({ length: 12 }, (_, i) => 10 + ((Math.sin(seed * 1.3 + i * 0.9) + 1) / 2) * 16 + i * 0.5);
  const max = Math.max(...pts), min = Math.min(...pts), span = max - min || 1;
  const d = pts.map((v, i) => `${(i * (w / 11)).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block', flexShrink: 0 }}>
      <polyline points={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
    </svg>
  );
}
