import { useState, useEffect, useCallback } from 'react';
import { Tag, Spinner } from '../../components/ui';
import { integrationsApi, type Integration } from '../../api/integrations';
import { metaAdsApi, type MetaAsset } from '../../api/metaAds';
import { C } from '../../styles/theme';

const unwrap = (res: any) => res?.data?.data ?? res?.data ?? res;

type IntegId = 'meta' | 'whatsapp' | 'stripe' | 'instagram';

const INIT_FORMS = {
  meta: { accessToken: '', adAccountId: '', pixelId: '', pageId: '', businessId: '' },
  whatsapp: { phoneNumberId: '', accessToken: '', businessAccountId: '' },
  stripe: { secretKey: '', webhookSecret: '' },
  instagram: { accountId: '' },
};

const REQUIRED: Record<IntegId, string[]> = {
  meta: ['accessToken', 'adAccountId'],
  whatsapp: ['phoneNumberId', 'accessToken'],
  stripe: ['secretKey'],
  instagram: [],
};

export default function Integrations() {
  const [forms, setForms] = useState(INIT_FORMS);
  const [connected, setConnected] = useState<Record<IntegId, boolean>>({ meta: false, whatsapp: false, stripe: false, instagram: false });
  const [loading, setLoading] = useState<Record<IntegId, boolean>>({ meta: false, whatsapp: false, stripe: false, instagram: false });
  const [errors, setErrors] = useState<Record<IntegId, string>>({ meta: '', whatsapp: '', stripe: '', instagram: '' });
  const [success, setSuccess] = useState<Record<IntegId, string>>({ meta: '', whatsapp: '', stripe: '', instagram: '' });
  const [fetching, setFetching] = useState(true);

  // ── Meta vía OAuth (conectar con Facebook) ──
  const [meta, setMeta] = useState<{ connected: boolean; name?: string }>({ connected: false });
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaNotice, setMetaNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [picker, setPicker] = useState<{ adAccounts: MetaAsset[]; pages: MetaAsset[]; ad: string; page: string } | null>(null);

  const refreshMeta = useCallback(async () => {
    try {
      const accts = unwrap(await metaAdsApi.getAccounts()) as any[];
      if (Array.isArray(accts) && accts.length) setMeta({ connected: true, name: accts[0].name });
      else setMeta({ connected: false });
    } catch { /* sin conexión */ }
  }, []);

  const connectMeta = async () => {
    setMetaBusy(true); setMetaNotice(null);
    try {
      const { url } = unwrap(await metaAdsApi.oauthUrl()) as { url: string };
      window.location.href = url; // el usuario autoriza en Facebook y vuelve al callback
    } catch (e: any) {
      setMetaNotice({ ok: false, text: e?.response?.data?.message || 'Meta no está configurado en el servidor todavía.' });
      setMetaBusy(false);
    }
  };
  const openPicker = async () => {
    try {
      const a = unwrap(await metaAdsApi.assets()) as { adAccounts: MetaAsset[]; pages: MetaAsset[] };
      setPicker({ adAccounts: a.adAccounts || [], pages: a.pages || [], ad: a.adAccounts?.[0]?.id || '', page: a.pages?.[0]?.id || '' });
    } catch (e: any) { setMetaNotice({ ok: false, text: e?.response?.data?.message || 'No se pudieron traer las cuentas.' }); }
  };
  const saveSelection = async () => {
    if (!picker) return;
    setMetaBusy(true);
    try {
      await metaAdsApi.select(picker.ad, picker.page || undefined);
      setPicker(null); await refreshMeta();
      setMetaNotice({ ok: true, text: '✓ Cuenta y página actualizadas.' });
    } catch (e: any) { setMetaNotice({ ok: false, text: e?.response?.data?.message || 'No se pudo guardar la selección.' }); }
    setMetaBusy(false);
  };
  const disconnectMeta = async () => {
    setMetaBusy(true);
    try { await metaAdsApi.disconnect(); setMeta({ connected: false }); setMetaNotice(null); } catch { /* ignore */ }
    setMetaBusy(false);
  };
  useEffect(() => { refreshMeta(); }, [refreshMeta]);

  // Al volver del login de Facebook, Meta nos redirige con ?meta=connected|error
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const m = p.get('meta');
    if (m === 'connected') setMetaNotice({ ok: true, text: `✓ Meta conectado${p.get('name') ? ` · ${p.get('name')}` : ''}` });
    else if (m === 'error') setMetaNotice({ ok: false, text: `No se pudo conectar: ${p.get('msg') || 'error de Meta'}` });
    if (m) {
      if (p.get('select')) openPicker();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setF = (id: IntegId, k: string, v: string) => {
    setForms(p => ({ ...p, [id]: { ...p[id], [k]: v } }));
    setErrors(p => ({ ...p, [id]: '' }));
    setSuccess(p => ({ ...p, [id]: '' }));
  };

  const loadIntegrations = useCallback(async () => {
    setFetching(true);
    try {
      const res = await integrationsApi.getAll();
      const list: Integration[] = (res.data as any)?.data ?? res.data ?? [];
      const newConnected = { ...connected };
      const newForms = { ...INIT_FORMS } as typeof INIT_FORMS;

      list.forEach(integ => {
        if (integ.status === 'connected' && integ.type in newConnected) {
          (newConnected as any)[integ.type] = true;
          (newForms as any)[integ.type] = { ...(newForms as any)[integ.type], ...integ.config };
        }
      });

      setConnected(newConnected);
      setForms(newForms);
    } catch {
      // API not reachable — start fresh
    }
    setFetching(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadIntegrations(); }, [loadIntegrations]);

  const connect = async (id: IntegId) => {
    const f = forms[id] as Record<string, string>;
    const missing = REQUIRED[id].filter(k => !f[k]?.trim());
    if (missing.length) {
      setErrors(p => ({ ...p, [id]: `${missing.join(', ')} son requeridos` }));
      return;
    }

    setLoading(p => ({ ...p, [id]: true }));
    try {
      await integrationsApi.save(id, f);
      setConnected(p => ({ ...p, [id]: true }));
      setSuccess(p => ({ ...p, [id]: '✓ Conectado y validado correctamente' }));
    } catch (e: any) {
      // Mostrar el error real (token inválido, cuenta inaccesible, etc.) — no fingir éxito
      const msg = e?.response?.data?.message || e?.response?.data?.error || 'No se pudo conectar. Verificá las credenciales.';
      setErrors(p => ({ ...p, [id]: Array.isArray(msg) ? msg.join(', ') : String(msg) }));
    }
    setLoading(p => ({ ...p, [id]: false }));
  };

  const disconnect = async (id: IntegId) => {
    try { await integrationsApi.disconnect(id); } catch { /* continue */ }
    setConnected(p => ({ ...p, [id]: false }));
    setForms(p => ({ ...p, [id]: Object.fromEntries(Object.keys(p[id]).map(k => [k, ''])) as typeof p[typeof id] }));
    setSuccess(p => ({ ...p, [id]: '' }));
  };

  function IntegCard({ id, icon, title, color, required, hint, children }: {
    id: IntegId; icon: string; title: string; color: string; required?: boolean; hint?: string; children: React.ReactNode;
  }) {
    const isConn = connected[id];
    return (
      <div className="cv-card fade-in" style={{ marginBottom: 16, padding: 20, border: isConn ? `1.5px solid ${C.green}55` : `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
          <span style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, background: `${color}22`, border: `1px solid ${color}44`, display: 'grid', placeItems: 'center', fontSize: 23 }}>{icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 16 }}>{title}</span>
              {required && !isConn && <Tag t="tr">Requerido</Tag>}
              {isConn ? <Tag t="tg">● Conectado</Tag> : <Tag t="tb">○ Sin conectar</Tag>}
            </div>
            {hint && <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 3 }}>{hint}</div>}
          </div>
          {isConn && (
            <button className="btn btn-d" style={{ fontSize: 12, padding: '5px 11px' }} onClick={() => disconnect(id)}>Desconectar</button>
          )}
        </div>
        {errors[id] && <div className="err-box">{errors[id]}</div>}
        {success[id] && <div className="ok-box">{success[id]}</div>}
        {!isConn && (
          <>
            {children}
            <button
              className="btn btn-p"
              style={{ marginTop: 13, padding: '9px 20px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={() => connect(id)}
              disabled={loading[id]}
            >
              {loading[id] ? <><Spinner color="#fff" /> Guardando...</> : `Conectar ${title}`}
            </button>
          </>
        )}
        {isConn && (
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {Object.entries(forms[id]).filter(([, v]) => v).map(([k]) => (
              <div key={k} style={{ background: C.greenDim, border: `1px solid ${C.green}33`, borderRadius: 5, padding: '3px 9px', fontSize: 10, color: C.green, fontFamily: "'DM Mono',monospace" }}>
                {k} ✓
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (fetching) {
    return <div className="content fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}><Spinner size={28} /></div>;
  }

  return (
    <div className="content fade-in" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26, margin: '0 0 5px' }}>Integraciones</h1>
        <div style={{ fontSize: 14, color: C.textMuted }}>Conectá tus cuentas para activar la automatización completa. Las credenciales se cifran con AES-256-GCM.</div>
        <div style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: C.textMuted, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 999, padding: '6px 13px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.green }} />
          {(meta.connected ? 1 : 0) + (['whatsapp', 'stripe', 'instagram'] as IntegId[]).filter(k => connected[k]).length} de 4 conectadas
        </div>
      </div>

      <div className="cv-card fade-in" style={{ marginBottom: 16, padding: 20, border: meta.connected ? `1.5px solid ${C.green}55` : `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
          <span style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, background: '#1877f222', border: '1px solid #1877f244', display: 'grid', placeItems: 'center', fontSize: 23 }}>📘</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 16 }}>Meta Ads</span>
              {!meta.connected && <Tag t="tr">Requerido</Tag>}
              {meta.connected ? <Tag t="tg">● Conectado</Tag> : <Tag t="tb">○ Sin conectar</Tag>}
            </div>
            <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 3 }}>Conectá Facebook e Instagram para crear y publicar campañas.</div>
          </div>
          {meta.connected && <button className="btn btn-d" style={{ fontSize: 12, padding: '5px 11px' }} onClick={disconnectMeta} disabled={metaBusy}>Desconectar</button>}
        </div>

        {metaNotice && <div className={metaNotice.ok ? 'ok-box' : 'err-box'}>{metaNotice.text}</div>}

        {meta.connected ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
              <span style={{ color: C.green }}>✓</span> Cuenta activa: <b>{meta.name || 'Meta'}</b>
              <button onClick={openPicker} style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '5px 11px', fontSize: 12, cursor: 'pointer' }}>Cambiar cuenta</button>
            </div>
            {picker && (
              <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 13, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="fg">
                  <label className="flbl">Cuenta publicitaria</label>
                  <select className="fsel" value={picker.ad} onChange={e => setPicker({ ...picker, ad: e.target.value })}>
                    {picker.adAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label className="flbl">Página de Facebook</label>
                  <select className="fsel" value={picker.page} onChange={e => setPicker({ ...picker, page: e.target.value })}>
                    <option value="">— Sin página —</option>
                    {picker.pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-p" style={{ fontSize: 13, padding: '8px 16px' }} onClick={saveSelection} disabled={metaBusy}>{metaBusy ? 'Guardando…' : 'Guardar'}</button>
                  <button className="btn btn-d" style={{ fontSize: 13, padding: '8px 16px' }} onClick={() => setPicker(null)}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 14, lineHeight: 1.55 }}>
              Autorizás una vez en Facebook y Conversia trae tus cuentas publicitarias y páginas automáticamente. No necesitás copiar ningún token.
            </div>
            <button onClick={connectMeta} disabled={metaBusy}
              style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#1877f2', color: '#fff', border: 'none', borderRadius: 11, padding: '11px 20px', fontSize: 14, fontWeight: 700, cursor: metaBusy ? 'wait' : 'pointer', opacity: metaBusy ? 0.7 : 1 }}>
              {metaBusy ? <Spinner color="#fff" /> : <span style={{ fontSize: 17 }}>📘</span>}
              {metaBusy ? 'Redirigiendo…' : 'Conectar con Facebook'}
            </button>

            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: C.textMuted }}>Opción avanzada: pegar un token manualmente</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 12 }}>
                <div className="fg">
                  <label className="flbl">Access Token <span style={{ color: C.red }}>*</span></label>
                  <input className="finput" type="password" placeholder="EAAxxxxxxxxxxxxxxxxx..." value={forms.meta.accessToken} onChange={e => setF('meta', 'accessToken', e.target.value)} />
                </div>
                <div className="g2" style={{ gap: 11 }}>
                  <div className="fg">
                    <label className="flbl">Ad Account ID <span style={{ color: C.red }}>*</span></label>
                    <input className="finput" placeholder="act_123456789" value={forms.meta.adAccountId} onChange={e => setF('meta', 'adAccountId', e.target.value)} />
                  </div>
                  <div className="fg">
                    <label className="flbl">Page ID (Facebook)</label>
                    <input className="finput" placeholder="123456789" value={forms.meta.pageId} onChange={e => setF('meta', 'pageId', e.target.value)} />
                  </div>
                </div>
                {errors.meta && <div className="err-box">{errors.meta}</div>}
                <button className="btn btn-p" style={{ fontSize: 13, padding: '9px 18px', alignSelf: 'flex-start' }} disabled={loading.meta}
                  onClick={async () => { await connect('meta'); refreshMeta(); }}>
                  {loading.meta ? <><Spinner color="#fff" /> Guardando…</> : 'Conectar con token'}
                </button>
              </div>
            </details>
          </>
        )}
      </div>

      <IntegCard id="whatsapp" icon="💬" title="WhatsApp Business API" color="#25d366" required hint="Requerido para redirigir leads con tracking de conversaciones">
        <div style={{ background: C.accentDim, border: `1px solid ${C.accent}33`, borderRadius: 8, padding: '9px 12px', marginBottom: 13, fontSize: 12, color: C.accent }}>
          💡 Necesitás WhatsApp Business API (Meta).
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div className="fg">
            <label className="flbl">Phone Number ID <span style={{ color: C.red }}>*</span></label>
            <input className="finput" placeholder="123456789" value={forms.whatsapp.phoneNumberId} onChange={e => setF('whatsapp', 'phoneNumberId', e.target.value)} />
          </div>
          <div className="fg">
            <label className="flbl">Business Account ID</label>
            <input className="finput" placeholder="123456789" value={forms.whatsapp.businessAccountId} onChange={e => setF('whatsapp', 'businessAccountId', e.target.value)} />
          </div>
          <div className="fg">
            <label className="flbl">Access Token <span style={{ color: C.red }}>*</span></label>
            <input className="finput" type="password" placeholder="EAAxxxxxxxxxxxxxxxxx..." value={forms.whatsapp.accessToken} onChange={e => setF('whatsapp', 'accessToken', e.target.value)} />
          </div>
        </div>
      </IntegCard>

      <IntegCard id="stripe" icon="💳" title="Stripe" color="#635bff" hint="Para gestionar pagos propios si ofrecés tu plataforma a clientes">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div className="fg">
            <label className="flbl">Secret Key <span style={{ color: C.red }}>*</span></label>
            <input className="finput" type="password" placeholder="sk_live_xxxxxxxxxx..." value={forms.stripe.secretKey} onChange={e => setF('stripe', 'secretKey', e.target.value)} />
          </div>
          <div className="fg">
            <label className="flbl">Webhook Secret</label>
            <input className="finput" type="password" placeholder="whsec_xxxxxxxxxx..." value={forms.stripe.webhookSecret} onChange={e => setF('stripe', 'webhookSecret', e.target.value)} />
          </div>
        </div>
      </IntegCard>

      <IntegCard id="instagram" icon="📸" title="Instagram Business" color="#e1306c" hint="Para anuncios en Instagram Stories y Reels">
        <div className="fg">
          <label className="flbl">Instagram Account ID</label>
          <input className="finput" placeholder="17841xxxxxxxxx" value={forms.instagram.accountId} onChange={e => setF('instagram', 'accountId', e.target.value)} />
        </div>
        <div style={{ marginTop: 9, fontSize: 12, color: C.textMuted }}>Debe estar vinculado a la Page de Facebook configurada en Meta Ads.</div>
      </IntegCard>
    </div>
  );
}
