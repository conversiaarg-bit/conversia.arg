import { useState, useEffect } from 'react';
import { Tag } from '../../components/ui';
import { C } from '../../styles/theme';
import { adminApi } from '../../api/admin';

const timeAgo = (iso: string) => {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'recién';
  if (d < 3600) return `hace ${Math.floor(d / 60)}min`;
  if (d < 86400) return `hace ${Math.floor(d / 3600)}h`;
  return new Date(iso).toLocaleDateString('es-AR');
};
const mapAudit = (a: any) => ({
  id: a.id, user: a.full_name || a.email || 'sistema', action: a.action || '', entity: a.entity || '',
  detail: a.entity_id || (a.meta && typeof a.meta === 'object' ? Object.values(a.meta).join(' · ') : '') || '',
  time: timeAgo(a.created_at), ip: a.ip_address || a.ip || '—',
});

function actionColor(action: string) {
  if (action.includes('suspend') || action.includes('block')) return C.red;
  if (action.includes('create') || action.includes('activate')) return C.green;
  if (action.includes('impersonate')) return C.amber;
  return C.accent;
}

function actionTag(action: string): 'tr' | 'tg' | 'ta' | 'tp' {
  if (action.includes('suspend') || action.includes('block')) return 'tr';
  if (action.includes('create') || action.includes('activate')) return 'tg';
  if (action.includes('impersonate')) return 'ta';
  return 'tp';
}

export default function AdminAudit() {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ReturnType<typeof mapAudit>[]>([]);
  useEffect(() => { adminApi.audit({ limit: 100 }).then(a => setItems((Array.isArray(a) ? a : []).map(mapAudit))).catch(() => setItems([])); }, []);

  const filtered = items.filter(a =>
    !search || a.user.toLowerCase().includes(search.toLowerCase()) || a.action.toLowerCase().includes(search.toLowerCase()) || (a.detail || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page fa">
      <div className="sec-head">
        <div>
          <div className="sec-title">Audit Log</div>
          <div className="sec-sub">Registro de todas las acciones administrativas</div>
        </div>
        <Tag t="tg">{items.length} entradas</Tag>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input className="finput" placeholder="🔍 Buscar por usuario, acción o detalle..." style={{ maxWidth: 360 }} value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="tbl-scroll">
          <table>
            <thead>
              <tr><th>Acción</th><th>Usuario</th><th>Entidad</th><th>Detalle</th><th>IP</th><th>Tiempo</th></tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: actionColor(a.action), flexShrink: 0 }} />
                      <Tag t={actionTag(a.action)}>{a.action}</Tag>
                    </div>
                  </td>
                  <td style={{ fontSize: 13, fontWeight: 500 }}>{a.user}</td>
                  <td><Tag t="tk">{a.entity}</Tag></td>
                  <td style={{ fontSize: 12, color: C.textMuted }}>{a.detail}</td>
                  <td style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: C.textDim }}>{a.ip}</td>
                  <td style={{ fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap' }}>{a.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
