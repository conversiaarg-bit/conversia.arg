import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import LogoMark from '../components/LogoMark';
import { useAuth } from '../hooks/useAuth';
import { Spinner } from '../components/ui';
import type { Plan } from '../types';

interface LocationState { plan?: Plan; tab?: 'login' | 'register' }

const FEATURES = [
  'Campañas Meta Ads con IA',
  'Generación de creativos automática',
  'Insights en tiempo real',
  'WhatsApp marketing integrado',
  'Reportes diarios automatizados',
];

export default function AuthPage() {
  const navigate   = useNavigate();
  const { state: locState } = useLocation() as { state: LocationState | null };
  const { login, register }  = useAuth();

  const plan = locState?.plan ?? null;
  const [tab,     setTab]     = useState<'login' | 'register'>(locState?.tab ?? 'login');
  const [form,    setForm]    = useState({ email: '', password: '', name: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState('');
  const [ok,      setOk]      = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const set = (k: string, v: string) => { setForm(p => ({ ...p, [k]: v })); setErr(''); };

  const doLogin = async () => {
    if (!form.email || !form.password) { setErr('Completá todos los campos'); return; }
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate('/dashboard');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setErr(msg ?? 'Email o contraseña incorrectos');
    } finally { setLoading(false); }
  };

  const doRegister = async () => {
    if (!form.email || !form.password || !form.name) { setErr('Completá todos los campos'); return; }
    if (form.password.length < 8) { setErr('Contraseña mínimo 8 caracteres'); return; }
    if (form.password !== form.confirm) { setErr('Las contraseñas no coinciden'); return; }
    setLoading(true);
    try {
      const msg = await register(form.email, form.password, form.name);
      if (plan) {
        navigate('/checkout', { state: { plan } });
      } else {
        setOk(msg ?? 'Revisá tu email para verificar tu cuenta.');
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setErr(msg ?? 'Error al registrar. Intentá nuevamente.');
    } finally { setLoading(false); }
  };

  return (
    <div className="auth-page" style={{ background: '#07070f' }}>
      {/* Ambient gradient */}
      <div className="auth-bg" />
      <div style={{ position: 'absolute', top: -200, right: -200, width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(#7c5cfc09, transparent 70%)', pointerEvents: 'none' }} />

      {/* Back button */}
      <button
        onClick={() => navigate('/')}
        className="fixed top-5 left-5 flex items-center gap-1.5 text-[12px] text-muted hover:text-text transition-colors bg-surface border border-border rounded-lg px-3 py-1.5 z-10"
      >
        <ArrowLeft size={13} />
        Volver
      </button>

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 24, scale: .98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: .35, ease: [.4, 0, .2, 1] }}
        className="auth-card"
        style={{ maxWidth: 420, background: '#0f0f1a', border: '1.5px solid #1c1c2e', borderRadius: 20, padding: '32px 28px' }}
      >
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-7">
          <LogoMark size={38} />
          <div>
            <div className="font-syne font-extrabold text-[15px] text-text tracking-tight">CONVERSIA</div>
            <div className="text-[9px] text-muted font-mono tracking-widest uppercase">Tech · Meta Ads</div>
          </div>
        </div>

        {/* Plan badge */}
        {plan && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="mb-5 bg-accent/10 border border-accent/25 rounded-xl p-3 text-[13px]"
          >
            <span className="text-muted">Plan: </span>
            <span className="text-accent font-semibold">{plan.name} — ${plan.price}/mes</span>
            <span className="text-green text-[11px] ml-2">· 7 días gratis</span>
          </motion.div>
        )}

        {/* Tabs */}
        <div className="auth-tabs mb-5">
          {(['login', 'register'] as const).map(t => (
            <button
              key={t}
              className={`auth-tab${tab === t ? ' active' : ''}`}
              onClick={() => { setTab(t); setErr(''); setOk(''); }}
            >
              {t === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
            </button>
          ))}
        </div>

        {/* Heading */}
        <div className="mb-5">
          <h1 className="font-syne font-bold text-[18px] text-text leading-tight mb-1">
            {tab === 'login' ? 'Bienvenido de vuelta' : 'Empezá gratis hoy'}
          </h1>
          <p className="text-[12px] text-muted">
            {tab === 'login'
              ? 'Ingresá a tu cuenta de Conversia ADS'
              : 'Creá tu cuenta y gestioná tus campañas con IA'}
          </p>
        </div>

        {/* Alerts */}
        {err && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="err-box mb-4">
            {err}
          </motion.div>
        )}
        {ok && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="ok-box mb-4 flex items-start gap-2">
            <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
            {ok}
          </motion.div>
        )}

        {/* Form */}
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: tab === 'login' ? -10 : 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: .2 }}
          className="flex flex-col gap-3.5"
        >
          {tab === 'register' && (
            <div className="fg">
              <label className="flbl">Nombre completo</label>
              <input className="finput" placeholder="Alan García" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
          )}

          <div className="fg">
            <label className="flbl">Email</label>
            <input className="finput" type="email" placeholder="tu@empresa.com" value={form.email} onChange={e => set('email', e.target.value)} />
          </div>

          <div className="fg">
            <label className="flbl">Contraseña</label>
            <div className="relative">
              <input
                className="finput"
                type={showPwd ? 'text' : 'password'}
                placeholder={tab === 'register' ? 'Mínimo 8 caracteres' : '••••••••'}
                value={form.password}
                onChange={e => set('password', e.target.value)}
                onKeyDown={e => tab === 'login' && e.key === 'Enter' && doLogin()}
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text transition-colors"
              >
                {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {tab === 'register' && (
            <div className="fg">
              <label className="flbl">Confirmar contraseña</label>
              <input
                className="finput"
                type="password"
                placeholder="••••••••"
                value={form.confirm}
                onChange={e => set('confirm', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doRegister()}
              />
            </div>
          )}

          {tab === 'login' && (
            <div className="text-right">
              <span className="text-[12px] text-accent cursor-pointer hover:opacity-80 transition-opacity">
                ¿Olvidaste tu contraseña?
              </span>
            </div>
          )}

          <button
            className="btn btn-p w-full justify-center"
            style={{ padding: '11px', fontSize: 13, marginTop: 2 }}
            onClick={tab === 'login' ? doLogin : doRegister}
            disabled={loading}
          >
            {loading
              ? <Spinner />
              : tab === 'login'
              ? 'Ingresar →'
              : plan ? 'Crear cuenta y pagar →' : 'Crear cuenta gratis →'
            }
          </button>

          <div className="text-center text-[12px] text-muted">
            {tab === 'login' ? (
              <>¿No tenés cuenta? <span className="text-accent cursor-pointer hover:opacity-80 transition-opacity" onClick={() => { setTab('register'); setErr(''); }}>Registrate gratis</span></>
            ) : (
              <>¿Ya tenés cuenta? <span className="text-accent cursor-pointer hover:opacity-80 transition-opacity" onClick={() => { setTab('login'); setErr(''); }}>Iniciá sesión</span></>
            )}
          </div>

          {tab === 'register' && (
            <div className="text-[11px] text-dim text-center">
              Al registrarte aceptás los Términos de Servicio y la Política de Privacidad
            </div>
          )}
        </motion.div>

        {/* Feature list (register only) */}
        {tab === 'register' && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 }}
            className="mt-5 pt-5 border-t border-border"
          >
            <div className="text-[10px] text-muted font-mono uppercase tracking-wider mb-3">Incluido en tu cuenta</div>
            <div className="flex flex-col gap-1.5">
              {FEATURES.map(f => (
                <div key={f} className="flex items-center gap-2 text-[12px] text-muted">
                  <CheckCircle2 size={12} className="text-green flex-shrink-0" />
                  {f}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
