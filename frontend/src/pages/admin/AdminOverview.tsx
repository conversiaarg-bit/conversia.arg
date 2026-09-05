import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { C } from '../../styles/theme';
import { adminApi } from '../../api/admin';

const money = (n: number) => `$${(n || 0).toLocaleString('es-AR')}`;
const timeAgo = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'recién';
  if (d < 3600) return `hace ${Math.floor(d / 60)}min`;
  if (d < 86400) return `hace ${Math.floor(d / 3600)}h`;
  return new Date(iso).toLocaleDateString('es-AR');
};

export default function AdminOverview() {
  const navigate = useNavigate();
  const [dash, setDash] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);

  useEffect(() => {
    adminApi.dashboard().then(setDash).catch(() => setDash({}));
    adminApi.audit({ limit: 6 }).then(a => setAudit(Array.isArray(a) ? a : [])).catch(() => setAudit([]));
  }, []);

  const users = dash?.users ?? {};
  const subs = dash?.subscriptions ?? {};
  const mrr = (+subs.mrr_cents || 0) / 100;
  const activeUsers = +users.active || 0;
  const suspended = +users.suspended || 0;
  const arr = mrr * 12;
  const plans: [string, number, string, number][] = [
    ['Scale — $199/mes', +subs.scale || 0, C.accent, 199],
    ['Growth — $99/mes', +subs.growth || 0, C.blue, 99],
    ['Starter — $49/mes', +subs.starter || 0, C.green, 49],
  ];
  const maxPlan = Math.max(1, ...plans.map(p => p[1]));

  return (
    <div className="page fa">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 22, marginBottom: 3 }}>Panel de Administración</div>
        <div style={{ fontSize: 13, color: C.textMuted }}>Vista global del sistema {dash === null && '· cargando…'}</div>
      </div>

      <div className="g5" style={{ marginBottom: 18 }}>
        {[
          { label: 'MRR', value: money(mrr), color: C.green, cls: 'green' },
          { label: 'Usuarios activos', value: `${activeUsers}`, color: C.accent, cls: 'purple' },
          { label: 'Nuevos (30d)', value: `${+users.new_30d || 0}`, color: C.blue, cls: 'blue' },
          { label: 'Suspendidos', value: `${suspended}`, color: C.amber, cls: 'amber', sub: suspended ? 'Requieren atención' : 'Ninguno' },
          { label: 'ARR', value: money(arr), color: C.green, cls: 'green' },
        ].map(kpi => (
          <div key={kpi.label} className={`kpi ${kpi.cls} fa`}>
            <div className="kpi-lbl">{kpi.label}</div>
            <div className="kpi-val">{kpi.value}</div>
            {kpi.sub && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{kpi.sub}</div>}
          </div>
        ))}
      </div>

      <div className="g2" style={{ marginBottom: 18 }}>
        <div className="card">
          <div className="sec-head"><div><div className="sec-title">Distribución de planes</div></div></div>
          {plans.every(p => p[1] === 0) ? (
            <div style={{ fontSize: 13, color: C.textMuted, padding: '8px 0 14px' }}>Todavía no hay suscripciones activas.</div>
          ) : plans.map(([plan, n, col]) => (
            <div key={plan} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
                <span>{plan}</span>
                <span style={{ color: C.textMuted, fontFamily: "'DM Mono',monospace" }}>{n} usuario{n !== 1 ? 's' : ''}</span>
              </div>
              <div className="prog"><div className="prog-bar" style={{ width: `${(n / maxPlan) * 100}%`, background: col }} /></div>
            </div>
          ))}
          <button className="btn btn-g btn-sm" onClick={() => navigate('/admin/billing')}>Ver facturación</button>
        </div>

        <div className="card">
          <div className="sec-head"><div className="sec-title">Actividad reciente</div></div>
          {audit.length === 0 ? (
            <div style={{ fontSize: 13, color: C.textMuted, padding: '8px 0' }}>Sin actividad registrada todavía.</div>
          ) : audit.map((a, i) => (
            <div key={a.id ?? i} className="act-item">
              <div className="act-dot" style={{ background: a.action?.includes('suspend') || a.action?.includes('delete') ? '#ff4d6a' : a.action?.includes('create') ? '#00d68f' : C.accent }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500 }}>{a.action}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{a.full_name || a.email || 'sistema'}</div>
              </div>
              <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'DM Mono',monospace", whiteSpace: 'nowrap' }}>{a.created_at ? timeAgo(a.created_at) : ''}</div>
            </div>
          ))}
          <button className="btn btn-g btn-sm" style={{ marginTop: 12 }} onClick={() => navigate('/admin/audit')}>Ver todo el log →</button>
        </div>
      </div>

      <div className="g3">
        {[
          { icon: '👥', title: 'Nuevo usuario', sub: 'Crear cuenta manualmente', color: C.accent, path: '/admin/users' },
          { icon: '📢', title: 'Enviar anuncio', sub: 'Comunicar a todos los clientes', color: C.blue, path: '/admin/comms' },
          { icon: '🚩', title: 'Feature flags', sub: 'Activar/desactivar funciones', color: C.amber, path: '/admin/flags' },
        ].map(a => (
          <div key={a.path} className="card" style={{ cursor: 'pointer', transition: 'all .15s' }} onClick={() => navigate(a.path)}
            onMouseEnter={e => (e.currentTarget.style.borderColor = a.color)}
            onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
            <div style={{ fontSize: 22, marginBottom: 9 }}>{a.icon}</div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{a.title}</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>{a.sub}</div>
            <div style={{ marginTop: 10, fontSize: 11, color: a.color, fontFamily: "'DM Mono',monospace" }}>EJECUTAR →</div>
          </div>
        ))}
      </div>
    </div>
  );
}
