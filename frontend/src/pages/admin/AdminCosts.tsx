import { useEffect, useMemo, useState } from 'react';
import { C } from '../../styles/theme';
import { Spinner } from '../../components/ui';
import { creditsApi, type Plan } from '../../api/credits';

// Panel del CEO: monitoreo de gasto real de IA, márgenes y precios de venta sugeridos.
export default function AdminCosts() {
  const [metrics, setMetrics] = useState<any>(null);
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [creditValueUsd, setCreditValueUsd] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [targetMargin, setTargetMargin] = useState(70); // % margen objetivo

  // Editables (persistidos en este navegador)
  const [infra, setInfra] = useState<{ name: string; amt: number }[]>(() => {
    try { const s = localStorage.getItem('cv_infra'); if (s) return JSON.parse(s); } catch { /* */ }
    return [{ name: 'Railway (backend + DB)', amt: 5 }, { name: 'Vercel (frontend)', amt: 0 }, { name: 'AWS S3 (almacenamiento)', amt: 2 }, { name: 'Dominio', amt: 1 }, { name: 'Otros', amt: 0 }];
  });
  const [clientsByPlan, setClientsByPlan] = useState<Record<string, number>>(() => {
    try { const s = localStorage.getItem('cv_clients'); if (s) return JSON.parse(s); } catch { /* */ } return {};
  });
  const [usagePct, setUsagePct] = useState<number>(() => {
    try { const s = localStorage.getItem('cv_usage'); if (s) return +s; } catch { /* */ } return 80;
  });
  useEffect(() => { try { localStorage.setItem('cv_infra', JSON.stringify(infra)); } catch { /* */ } }, [infra]);
  useEffect(() => { try { localStorage.setItem('cv_clients', JSON.stringify(clientsByPlan)); } catch { /* */ } }, [clientsByPlan]);
  useEffect(() => { try { localStorage.setItem('cv_usage', String(usagePct)); } catch { /* */ } }, [usagePct]);

  useEffect(() => {
    creditsApi.adminMetrics().then(setMetrics).catch(() => setMetrics({}));
    creditsApi.costs().then(r => { setCosts(r.costs || {}); setCreditValueUsd(r.creditValueUsd || 0); }).catch(() => {});
    creditsApi.plans().then(r => setPlans(r.plans || [])).catch(() => {});
  }, []);

  const m = metrics ?? {};
  const aiCost = +(m.ai_cost_usd ?? 0);
  const creditsUsed = +(m.credits_used ?? 0);
  const revenue = creditsUsed * creditValueUsd;          // ingreso por créditos consumidos
  const margin = revenue - aiCost;                        // margen bruto USD
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
  const costPerCredit = creditsUsed > 0 ? aiCost / creditsUsed : 0;   // costo real mezclado por crédito
  const gens = (+(m.images ?? 0)) + (+(m.videos ?? 0));

  // Precio de venta sugerido por crédito para el margen objetivo (sobre el costo real mezclado)
  const suggestedCreditPrice = costPerCredit > 0 ? costPerCredit / (1 - targetMargin / 100) : 0;

  // Costo vs precio por operación
  const pc = m.providerCostUsd ?? {};
  const ops = useMemo(() => ([
    { label: 'Imagen estándar · gpt-image-2', cost: +(pc.image ?? 0), credits: costs.image_standard ?? costs.image ?? 0 },
    { label: 'Imagen premium · gpt-image-2', cost: +(pc.imagePremium ?? 0), credits: costs.image_premium ?? 0 },
    { label: 'Video 10s · Seedance 1.5 Pro', cost: +(pc.video10 ?? 0), credits: costs.video_10 ?? costs.ugc_video_10 ?? 0 },
  ].filter(o => o.credits > 0 || o.cost > 0)), [pc, costs]);

  const money = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
  const pctColor = (p: number) => p >= 60 ? C.green : p >= 30 ? C.amber : C.red;

  // ── Gasto real del software (este mes) ──────────────────────────────────────
  const infraTotal = infra.reduce((a, b) => a + (+b.amt || 0), 0);
  const aiMonth = +(m.ai_cost_month_usd ?? aiCost);        // gasto IA del mes (o acumulado si el backend no lo trae)
  const revenueReal = +(m.revenue_usd ?? 0);               // ingreso real acumulado (recargas aprobadas)
  const revenueMonth = +(m.revenue_month_usd ?? 0);        // ingreso real del mes
  const softwareCostMonth = aiMonth + infraTotal;          // gasto total del software este mes
  const netMonth = revenueMonth - softwareCostMonth;       // ganancia neta real del mes
  const costRef = costPerCredit > 0 ? costPerCredit : 0.06; // costo de referencia por crédito (conservador sin datos)

  // ── Proyección por clientes / suscripciones ─────────────────────────────────
  const proj = plans.map(p => {
    const n = clientsByPlan[p.key] ?? 0;
    const income = (p.priceUsd ?? 0) * n;
    const aiCostTotal = (p.monthlyCredits ?? 0) * (usagePct / 100) * costRef * n;
    return { p, n, income, aiCostTotal, marginUsd: income - aiCostTotal };
  });
  const projIncome = proj.reduce((a, b) => a + b.income, 0);
  const projAiCost = proj.reduce((a, b) => a + b.aiCostTotal, 0);
  const projNet = projIncome - projAiCost - infraTotal;
  const projMarginPct = projIncome > 0 ? (projNet / projIncome) * 100 : 0;
  const refPlan = plans.find(p => p.key === 'pro') ?? plans[1] ?? plans[0];
  const refContribution = refPlan ? (refPlan.priceUsd - (refPlan.monthlyCredits * (usagePct / 100) * costRef)) : 0;
  const breakEven = refContribution > 0 ? Math.ceil(infraTotal / refContribution) : 0;

  if (!metrics) return <div style={{ padding: 20 }}><Spinner size={24} /></div>;

  return (
    <div style={{ padding: '4px 2px', color: C.text }}>
      <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 22, margin: '0 0 4px' }}>Costos & Precios</h2>
      <p style={{ color: C.textMuted, fontSize: 13, margin: '0 0 22px' }}>Gasto real de las herramientas de IA, margen del negocio y precios de venta sugeridos. Datos privados del CEO.</p>

      {/* Resumen del negocio */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 14 }}>
        <Stat label="Gasto IA (real)" value={money(aiCost)} color={C.amber} sub="Costo de proveedores" />
        <Stat label="Ingreso (créditos)" value={money(revenue)} color={C.blue} sub={`${creditsUsed.toLocaleString()} créditos usados`} />
        <Stat label="Margen bruto" value={money(margin)} color={margin >= 0 ? C.green : C.red} sub={`${marginPct.toFixed(1)}% sobre ingreso`} />
        <Stat label="Costo / crédito" value={money(costPerCredit)} sub={`Se vende a ${money(creditValueUsd)}`} />
        <Stat label="Generaciones" value={gens.toLocaleString()} sub={`${m.images ?? 0} img · ${m.videos ?? 0} video`} />
        <Stat label="Fallidas" value={m.failed ?? 0} color={C.red} sub={`${m.active_users ?? 0} usuarios activos`} />
      </div>

      {/* Barra de margen */}
      <div style={{ ...card, marginBottom: 26 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 8 }}>
          <span style={{ color: C.textMuted }}>Reparto del ingreso</span>
          <span><b style={{ color: C.amber }}>{money(aiCost)}</b> costo · <b style={{ color: C.green }}>{money(margin)}</b> margen</span>
        </div>
        <div style={{ height: 14, borderRadius: 8, overflow: 'hidden', display: 'flex', background: C.surface2 }}>
          <div style={{ width: `${revenue > 0 ? Math.min(100, (aiCost / revenue) * 100) : 0}%`, background: C.amber }} />
          <div style={{ flex: 1, background: C.green }} />
        </div>
      </div>

      {/* Costo vs precio por operación */}
      <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, margin: '0 0 12px' }}>Costo vs. precio por operación</h3>
      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 26 }}>
        <Row head cells={['Operación', 'Costo IA', 'Créditos', 'Precio usuario', 'Margen', 'Markup']} />
        {ops.length === 0 ? <div style={{ padding: 16, color: C.textMuted, fontSize: 13 }}>Sin datos de costos configurados.</div> : ops.map(o => {
          const price = o.credits * creditValueUsd;
          const mg = price - o.cost;
          const mgp = price > 0 ? (mg / price) * 100 : 0;
          const markup = o.cost > 0 ? price / o.cost : 0;
          return <Row key={o.label} cells={[
            o.label, money(o.cost), `${o.credits}`, money(price),
            <span style={{ color: pctColor(mgp), fontWeight: 700 }}>{money(mg)} · {mgp.toFixed(0)}%</span>,
            o.cost > 0 ? `${markup.toFixed(1)}×` : '—',
          ]} />;
        })}
      </div>

      {/* Precios de proveedor cargados */}
      <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, margin: '0 0 12px' }}>Precios de proveedor cargados (oficiales)</h3>
      <div style={{ ...card, marginBottom: 26 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
          <Mini label="Imagen estándar" value={money(+(pc.image ?? 0))} sub="OpenAI · gpt-image-2" />
          <Mini label="Imagen premium" value={money(+(pc.imagePremium ?? 0))} sub="OpenAI · gpt-image-2 (alta)" />
          <Mini label="Video 10s" value={money(+(pc.video10 ?? 0))} color={C.amber} sub="Seedance 1.5 Pro · fal.ai" />
          <Mini label="Copy" value={money(+(pc.copy ?? 0))} sub="OpenAI · gpt-4o-mini" />
          <Mini label="Voz TTS (~30s)" value={money(+(pc.tts ?? 0))} sub="OpenAI · gpt-4o-mini-tts" />
        </div>
        <p style={{ fontSize: 12, color: C.textMuted, marginTop: 12, lineHeight: 1.6 }}>
          Precios de lista de los proveedores (OpenAI · fal.ai/Seedance), configurables al valor exacto de tu factura por variables de entorno.
          <b style={{ color: C.text }}> Cuando cargues las keys, el gasto real = estos precios × el uso real</b> (segundos de video, cantidad de imágenes/copys/voces) y se registra por cada generación en el gasto de IA.
        </p>
      </div>

      {/* Calculadora de precio objetivo */}
      <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, margin: '0 0 12px' }}>Calculadora de precio de venta</h3>
      <div style={{ ...card, marginBottom: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, color: C.textMuted }}>Margen objetivo</label>
          <input type="range" min={0} max={90} value={targetMargin} onChange={e => setTargetMargin(+e.target.value)} style={{ flex: 1, minWidth: 180, accentColor: C.accent }} />
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 22, color: pctColor(targetMargin), minWidth: 56 }}>{targetMargin}%</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginTop: 16 }}>
          <Mini label="Costo real / crédito" value={money(costPerCredit)} />
          <Mini label="Precio sugerido / crédito" value={money(suggestedCreditPrice)} color={C.green} />
          <Mini label="Precio actual / crédito" value={money(creditValueUsd)} color={creditValueUsd >= suggestedCreditPrice ? C.green : C.amber} />
        </div>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '12px 0 0' }}>
          Para un margen del <b>{targetMargin}%</b> deberías cobrar <b style={{ color: C.green }}>{money(suggestedCreditPrice)}</b> por crédito
          {costPerCredit > 0 ? '.' : ' (aún sin datos reales de gasto; se calcula al generar con IA).'}
          {creditValueUsd > 0 && suggestedCreditPrice > 0 && (creditValueUsd >= suggestedCreditPrice
            ? ' Tu precio actual ya supera ese margen. ✅'
            : ' Tu precio actual queda por debajo — conviene subirlo. ⚠️')}
        </p>
      </div>

      {/* Uso por modelo */}
      <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, margin: '0 0 12px' }}>Gasto por modelo</h3>
      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 26 }}>
        <Row head cells={['Proveedor', 'Modelo', 'Usos', 'Costo IA']} />
        {(m.byModel ?? []).length === 0 ? <div style={{ padding: 16, color: C.textMuted, fontSize: 13 }}>Todavía no hay generaciones registradas.</div> :
          (m.byModel as any[]).map((r, i) => <Row key={i} cells={[r.provider, r.model, `${r.n}`, money(+r.cost)]} />)}
      </div>

      {/* Gasto real de la IA (la key de OpenAI/Seedance) */}
      <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, margin: '0 0 4px' }}>Gasto real de la IA</h3>
      <p style={{ color: C.textMuted, fontSize: 13, margin: '0 0 12px' }}>Lo que se consume de las API keys (OpenAI / Seedance), estimado por operación. Acumulado: <b style={{ color: C.amber }}>{money(aiCost)}</b> · este mes: <b style={{ color: C.amber }}>{money(aiMonth)}</b></p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16, marginBottom: 26 }}>
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <Row head cells={['Día', 'Generaciones', 'Gasto IA']} />
          {(m.byDay ?? []).length === 0 ? <div style={{ padding: 16, color: C.textMuted, fontSize: 13 }}>Sin gasto todavía.</div> :
            (m.byDay as any[]).map((r, i) => <Row key={i} cells={[r.day, `${r.n}`, money(+r.cost)]} />)}
        </div>
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <Row head cells={['Operación', 'Usos', 'Gasto IA']} />
          {(m.byOperation ?? []).length === 0 ? <div style={{ padding: 16, color: C.textMuted, fontSize: 13 }}>Sin gasto todavía.</div> :
            (m.byOperation as any[]).map((r, i) => <Row key={i} cells={[r.operation, `${r.n}`, money(+r.cost)]} />)}
        </div>
      </div>

      {/* Gasto real del software */}
      <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, margin: '0 0 12px' }}>Gasto real del software (este mes)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16, marginBottom: 26 }}>
        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Infraestructura fija / mes <span style={{ color: C.textDim, fontWeight: 400, fontSize: 12 }}>(editable)</span></div>
          {infra.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input value={it.name} onChange={e => setInfra(inf => inf.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} style={{ ...inputS, flex: 1 }} />
              <span style={{ color: C.textDim }}>$</span>
              <input type="number" value={it.amt} onChange={e => setInfra(inf => inf.map((x, j) => j === i ? { ...x, amt: +e.target.value } : x))} style={{ ...inputS, width: 76, textAlign: 'right' }} />
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 4, fontWeight: 700 }}><span>Total infra</span><span style={{ color: C.amber }}>{money(infraTotal)}/mes</span></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Stat label="Gasto IA (este mes)" value={money(aiMonth)} color={C.amber} sub="Proveedores de IA (pago por uso)" />
          <Stat label="Gasto total del software" value={money(softwareCostMonth)} color={C.amber} sub={`IA ${money(aiMonth)} + infra ${money(infraTotal)}`} />
          <Stat label="Ingreso real (recargas del mes)" value={money(revenueMonth)} color={C.blue} sub={`Acumulado histórico: ${money(revenueReal)}`} />
          <Stat label="Ganancia neta del mes" value={money(netMonth)} color={netMonth >= 0 ? C.green : C.red} sub={netMonth >= 0 ? 'En positivo ✅' : 'En rojo — revisá precios/uso ⚠️'} />
        </div>
      </div>

      {/* Comparación por clientes / suscripciones */}
      <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, margin: '0 0 12px' }}>Comparación por clientes / suscripciones</h3>
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, color: C.textMuted }}>Uso de créditos por cliente</label>
          <input type="range" min={10} max={100} value={usagePct} onChange={e => setUsagePct(+e.target.value)} style={{ flex: 1, minWidth: 160, accentColor: C.accent }} />
          <b style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, color: pctColor(100 - usagePct) }}>{usagePct}%</b>
          <span style={{ fontSize: 12, color: C.textDim }}>· costo ref. <b style={{ color: C.textMuted }}>{money(costRef)}</b>/crédito {costPerCredit > 0 ? '(real)' : '(estimado)'}</span>
        </div>
      </div>
      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 12 }}>
        <Row head cells={['Plan', 'Clientes', 'Precio', 'Ingreso', 'Costo IA', 'Ganancia']} />
        {proj.length === 0 ? <div style={{ padding: 16, color: C.textMuted, fontSize: 13 }}>Sin planes cargados.</div> : proj.map(({ p, n, income, aiCostTotal, marginUsd }) => (
          <Row key={p.key} cells={[
            p.name,
            <input type="number" value={n} onChange={e => setClientsByPlan(c => ({ ...c, [p.key]: Math.max(0, +e.target.value) }))} style={{ ...inputS, width: 66, textAlign: 'right' }} />,
            money(p.priceUsd ?? 0), money(income), money(aiCostTotal),
            <span style={{ color: marginUsd >= 0 ? C.green : C.red, fontWeight: 700 }}>{money(marginUsd)}</span>,
          ]} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 26 }}>
        <Stat label="Ingreso proyectado" value={money(projIncome)} color={C.blue} sub="Suscripciones / mes" />
        <Stat label="Costo total (IA + infra)" value={money(projAiCost + infraTotal)} color={C.amber} sub={`IA ${money(projAiCost)} + infra ${money(infraTotal)}`} />
        <Stat label="Ganancia neta proyectada" value={money(projNet)} color={projNet >= 0 ? C.green : C.red} sub={`${projMarginPct.toFixed(0)}% de margen`} />
        <Stat label="Punto de equilibrio" value={breakEven > 0 ? `${breakEven} ${refPlan?.name ?? ''}` : '—'} sub="clientes para cubrir la infra" />
      </div>

      {/* Planes vs costo */}
      {plans.length > 0 && (
        <>
          <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, margin: '0 0 12px' }}>Planes: precio vs. costo estimado</h3>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <Row head cells={['Plan', 'Precio', 'Créditos/mes', 'Costo si consume todo', 'Margen']} />
            {plans.map(p => {
              const planCost = (p.monthlyCredits ?? 0) * costPerCredit;
              const mg = (p.priceUsd ?? 0) - planCost;
              const mgp = p.priceUsd > 0 ? (mg / p.priceUsd) * 100 : 0;
              return <Row key={p.key} cells={[
                p.name, money(p.priceUsd ?? 0), `${(p.monthlyCredits ?? 0).toLocaleString()}`,
                costPerCredit > 0 ? money(planCost) : '—',
                costPerCredit > 0 ? <span style={{ color: pctColor(mgp), fontWeight: 700 }}>{money(mg)} · {mgp.toFixed(0)}%</span> : '—',
              ]} />;
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color = C.text, sub }: { label: string; value: any; color?: string; sub?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 24, color, margin: '2px 0' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.textDim }}>{sub}</div>}
    </div>
  );
}
function Mini({ label, value, color = C.text, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ background: C.surface2, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: C.textDim, marginTop: 3, fontFamily: "'DM Mono',monospace" }}>{sub}</div>}
    </div>
  );
}
function Row({ cells, head }: { cells: React.ReactNode[]; head?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `2fr repeat(${cells.length - 1}, 1fr)`, gap: 8, padding: '11px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 13, alignItems: 'center', background: head ? C.surface2 : 'transparent', color: head ? C.textMuted : C.text, fontWeight: head ? 700 : 500, textTransform: head ? 'uppercase' : 'none', letterSpacing: head ? 0.5 : 0 }}>
      {cells.map((c, i) => <div key={i} style={{ textAlign: i === 0 ? 'left' : 'right', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c}</div>)}
    </div>
  );
}

const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 };
const inputS: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 9px', color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' };
