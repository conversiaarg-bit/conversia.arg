import { useState, useRef, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Megaphone, Sparkles, Wand2,
  BarChart3, Plug, CreditCard, User, Settings,
  LogOut, Bell, Search, Plus, X, ChevronLeft,
  Zap, TrendingUp, FolderOpen, Palette,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import LogoMark from '../../components/LogoMark';

const NAV_MAIN = [
  { path: '/dashboard',              label: 'Dashboard',     icon: LayoutDashboard, end: true },
  { path: '/dashboard/campaigns',    label: 'Campañas',      icon: Megaphone },
  { path: '/dashboard/new-campaign', label: 'Nueva campaña', icon: Sparkles },
  { path: '/dashboard/creatives',    label: 'Creativos IA',  icon: Wand2 },
  { path: '/dashboard/projects',     label: 'Proyectos',     icon: FolderOpen },
  { path: '/dashboard/brand',        label: 'Mi marca',      icon: Palette },
  { path: '/dashboard/reports',      label: 'Reportes',      icon: BarChart3 },
  { path: '/dashboard/integrations', label: 'Integraciones', icon: Plug },
];

const NAV_ACCOUNT = [
  { path: '/dashboard/credits', label: 'Créditos',    icon: Zap },
  { path: '/dashboard/billing', label: 'Facturación', icon: CreditCard },
  { path: '/dashboard/profile', label: 'Mi perfil',   icon: User },
];

const BOTTOM_NAV = [
  { path: '/dashboard',              label: 'Inicio',    icon: LayoutDashboard, end: true },
  { path: '/dashboard/campaigns',    label: 'Campañas',  icon: Megaphone },
  { path: '/dashboard/new-campaign', label: 'Crear',     icon: Sparkles },
  { path: '/dashboard/creatives',    label: 'Creativos', icon: Wand2 },
];

const SIDEBAR_W  = 232;
const SIDEBAR_SM = 64;

export default function DashShell() {
  const { user, logout } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const avatarRef = useRef<HTMLDivElement>(null);

  const [collapsed,  setCollapsed]  = useState(false);
  const [mobOpen,    setMobOpen]    = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node))
        setAvatarOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { setMobOpen(false); }, [location.pathname]);

  const isActive = (path: string, end = false) =>
    end ? location.pathname === path : location.pathname.startsWith(path);

  const navTo = (path: string) => navigate(path);

  const pageTitle = [...NAV_MAIN, ...NAV_ACCOUNT].find(n =>
    (n as any).end ? location.pathname === n.path : location.pathname.startsWith(n.path)
  )?.label ?? 'Dashboard';

  const initials = user?.fullName?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() ?? 'U';

  const renderNavItem = (item: typeof NAV_MAIN[0], mini: boolean) => {
    const active = isActive(item.path, (item as any).end);
    const Icon   = item.icon;
    const hl     = (item as any).highlight;
    return (
      <motion.button
        key={item.path}
        onClick={() => navTo(item.path)}
        whileHover={{ x: 2 }}
        whileTap={{ scale: .97 }}
        title={mini ? item.label : undefined}
        className={[
          'relative flex items-center gap-3 w-full text-left rounded-xl transition-all duration-150 group',
          mini ? 'justify-center px-0 py-3' : 'px-3 py-2.5',
          active
            ? 'text-accent font-semibold bg-gradient-to-r from-[#7c5cfc26] to-[#7c5cfc08] shadow-[0_0_0_1px_#7c5cfc2e]'
            : hl
            ? 'text-[#9d80ff] border border-[#7c5cfc33] bg-gradient-to-r from-[#7c5cfc08] to-[#4da6ff08]'
            : 'text-muted hover:bg-surface2 hover:text-text',
        ].join(' ')}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-[60%] bg-accent rounded-r-full" />
        )}
        <Icon
          size={15}
          className={[
            'flex-shrink-0',
            active ? 'text-accent' : hl ? 'text-[#9d80ff]' : 'text-muted group-hover:text-text',
          ].join(' ')}
        />
        {!mini && <span className="text-[13px] leading-none truncate flex-1">{item.label}</span>}
        {!mini && hl && (
          <span className="text-[8px] font-bold bg-grad text-white px-1.5 py-0.5 rounded font-mono">IA</span>
        )}
      </motion.button>
    );
  };

  const sidebarInner = (mini: boolean) => (
    <>
      {/* Logo */}
      <div className={['flex items-center border-b border-border', mini ? 'justify-center py-5' : 'gap-3 px-4 py-5'].join(' ')}>
        <LogoMark size={34} />
        {!mini && (
          <div className="min-w-0">
            <div className="font-syne font-bold text-[13px] text-text leading-tight">CONVERSIA</div>
            <div className="text-[10px] text-muted font-mono">Tech · Meta Ads</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto flex flex-col gap-0.5 py-3 px-2">
        {!mini && <div className="nav-lbl px-1 mb-1">Principal</div>}
        {NAV_MAIN.map(item => renderNavItem(item, mini))}

        {mini
          ? <div className="my-2 border-t border-border" />
          : <div className="nav-lbl px-1 mt-3 mb-1">Cuenta</div>
        }
        {NAV_ACCOUNT.map(item => renderNavItem(item, mini))}

        {user?.role === 'admin' && renderNavItem({ path: '/admin', label: 'Admin Panel', icon: Settings }, mini)}
      </nav>

      {/* Plan card */}
      {!mini && (
        <div className="p-3 border-t border-border">
          <div className="bg-[#7c5cfc0d] border border-[#7c5cfc22] rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp size={11} className="text-accent" />
              <span className="text-[9px] text-muted font-mono uppercase tracking-wider">Plan activo</span>
            </div>
            <div className="font-syne font-bold text-[13px] text-accent mb-2">
              {(user?.plan ?? 'Growth').toUpperCase()}
            </div>
            <div className="h-1 bg-border rounded-full overflow-hidden">
              <div className="h-full w-[62%] bg-grad rounded-full" />
            </div>
            <div className="text-[10px] text-muted font-mono mt-1.5">12 / ∞ campañas</div>
          </div>
        </div>
      )}

      {/* Logout */}
      <div className="border-t border-border p-2">
        <button
          onClick={logout}
          title={mini ? 'Cerrar sesión' : undefined}
          className={[
            'flex items-center gap-3 w-full rounded-xl text-muted hover:bg-[#ff4d6a0f] hover:text-red transition-all duration-150',
            mini ? 'justify-center px-0 py-3' : 'px-3 py-2.5',
          ].join(' ')}
        >
          <LogOut size={15} className="flex-shrink-0" />
          {!mini && <span className="text-[13px]">Cerrar sesión</span>}
        </button>
      </div>
    </>
  );

  return (
    <div className="app">

      {/* ── MOBILE OVERLAY ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {mobOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: .2 }}
            className="fixed inset-0 bg-black/60 z-[90] backdrop-blur-sm"
            style={{ display: 'block' }}
            onClick={() => setMobOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── DESKTOP SIDEBAR ───────────────────────────────────────────────── */}
      <motion.aside
        animate={{ width: collapsed ? SIDEBAR_SM : SIDEBAR_W }}
        transition={{ duration: .25, ease: [.4, 0, .2, 1] }}
        className="hidden md:flex flex-col bg-surface border-r border-border overflow-hidden relative flex-shrink-0"
        style={{ height: '100vh' }}
      >
        {sidebarInner(collapsed)}
        <motion.button
          onClick={() => setCollapsed(v => !v)}
          whileHover={{ scale: 1.1 }} whileTap={{ scale: .9 }}
          className="absolute bottom-[80px] -right-3 w-6 h-6 rounded-full bg-surface border border-borderBright flex items-center justify-center text-muted hover:text-accent hover:border-accent/40 transition-colors shadow-card z-10"
        >
          <ChevronLeft size={11} className={`transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} />
        </motion.button>
      </motion.aside>

      {/* ── MOBILE SIDEBAR ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {mobOpen && (
          <motion.aside
            initial={{ x: -SIDEBAR_W }} animate={{ x: 0 }} exit={{ x: -SIDEBAR_W }}
            transition={{ duration: .25, ease: [.4, 0, .2, 1] }}
            className="fixed left-0 top-0 bottom-0 z-[100] flex flex-col bg-surface border-r border-border overflow-hidden"
            style={{ width: SIDEBAR_W }}
          >
            <button
              onClick={() => setMobOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg border border-border text-muted hover:text-text hover:bg-surface2 transition-colors z-10"
            >
              <X size={14} />
            </button>
            {sidebarInner(false)}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── MAIN AREA ─────────────────────────────────────────────────────── */}
      <main className="main-area">

        {/* TOPBAR */}
        <header className="topbar">
          <button
            onClick={() => setMobOpen(true)}
            className="flex md:hidden flex-col gap-[5px] p-1.5 border-none bg-transparent cursor-pointer"
            aria-label="Abrir menú"
          >
            <span className="block w-5 h-0.5 bg-text rounded-sm" />
            <span className="block w-5 h-0.5 bg-text rounded-sm" />
            <span className="block w-5 h-0.5 bg-text rounded-sm" />
          </button>

          <h1 className="font-syne font-bold text-[15px] text-text flex-1 min-w-0 truncate topbar-title-txt">
            {pageTitle}
          </h1>

          {/* Search */}
          <AnimatePresence mode="wait">
            {searchOpen ? (
              <motion.div
                key="open"
                initial={{ width: 0, opacity: 0 }} animate={{ width: 220, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
                transition={{ duration: .2 }}
                className="relative overflow-hidden topbar-search-wrap"
              >
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                <input
                  autoFocus
                  placeholder="Buscar…"
                  onBlur={() => setSearchOpen(false)}
                  className="w-full bg-bg border border-border rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-text placeholder:text-dim outline-none focus:border-accent transition-colors"
                />
              </motion.div>
            ) : (
              <button
                key="closed"
                onClick={() => setSearchOpen(true)}
                className="topbar-search-wrap flex items-center gap-2 bg-bg border border-border rounded-lg px-3 py-1.5 text-[12px] text-muted hover:text-text hover:border-borderBright transition-colors"
              >
                <Search size={13} />
                <span>Buscar…</span>
              </button>
            )}
          </AnimatePresence>

          {/* Bell */}
          <button className="relative p-[7px] rounded-lg text-muted hover:text-text hover:bg-surface2 border border-border transition-colors">
            <Bell size={15} />
            <span className="absolute top-[7px] right-[7px] w-1.5 h-1.5 rounded-full bg-accent" />
          </button>

          {/* Avatar */}
          <div ref={avatarRef} className="relative">
            <button
              onClick={() => setAvatarOpen(v => !v)}
              className={[
                'w-[30px] h-[30px] rounded-full bg-grad flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 transition-all duration-150',
                avatarOpen ? 'ring-2 ring-accent ring-offset-2 ring-offset-[#07070f]' : '',
              ].join(' ')}
            >
              {initials}
            </button>

            <AnimatePresence>
              {avatarOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: .95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: .95, y: -4 }}
                  transition={{ duration: .15 }}
                  className="absolute top-10 right-0 bg-surface border border-border rounded-xl p-1.5 min-w-[200px] z-[200]"
                  style={{ boxShadow: '0 16px 48px #00000077' }}
                >
                  <div className="px-3 py-2 border-b border-border mb-1">
                    <div className="text-[13px] font-semibold text-text truncate">{user?.fullName ?? 'Usuario'}</div>
                    <div className="text-[11px] text-muted truncate">{user?.email ?? ''}</div>
                  </div>
                  {([
                    { icon: User,       label: 'Mi perfil',     path: '/dashboard/profile' },
                    { icon: CreditCard, label: 'Facturación',   path: '/dashboard/billing' },
                    { icon: Plug,       label: 'Integraciones', path: '/dashboard/integrations' },
                  ] as const).map(({ icon: Icon, label, path }) => (
                    <button
                      key={path}
                      onClick={() => { navTo(path); setAvatarOpen(false); }}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-muted hover:text-text hover:bg-surface2 transition-all duration-100"
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                  <div className="border-t border-border mt-1 pt-1">
                    <button
                      onClick={() => { logout(); setAvatarOpen(false); }}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-red hover:bg-[#ff4d6a10] transition-all duration-100"
                    >
                      <LogOut size={14} />
                      Cerrar sesión
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* CTA */}
          <button
            onClick={() => navTo('/dashboard/new-campaign')}
            className="btn btn-p"
            style={{ fontSize: 12, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
          >
            <Plus size={13} />
            <span className="hidden sm:inline">Campaña</span>
          </button>
        </header>

        {/* PAGE */}
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .18 }}
          style={{ flex: 1 }}
        >
          <Outlet />
        </motion.div>

        {/* BOTTOM NAV (mobile only) */}
        <nav className="bottom-nav">
          {BOTTOM_NAV.map(n => {
            const Icon   = n.icon;
            const active = isActive(n.path, (n as any).end);
            return (
              <button key={n.path} className={`bnav-item${active ? ' active' : ''}`} onClick={() => navTo(n.path)}>
                <Icon size={20} strokeWidth={active ? 2 : 1.5} />
                <span>{n.label}</span>
              </button>
            );
          })}
        </nav>
      </main>
    </div>
  );
}
