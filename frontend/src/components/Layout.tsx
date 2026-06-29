import { Activity, AlertTriangle, BarChart2, ChevronDown, ChevronLeft, ChevronRight, Coins, Eye, ListTodo, LogOut, Menu, MessageCircleQuestion, Search, Server, Settings, ShieldCheck, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { SaveStatusIndicator, SaveStatusProvider } from '../context/SaveStatus'
import { AyudaFlotante, ReportarErrorButton } from './AsistenteCliente'
import { ProspiaLogo, ProspiaMark } from './Logo'
import ThemeToggle from './ThemeToggle'

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: BarChart2 },
  { to: '/prospects', label: 'Prospects', icon: Users },
  { to: '/terminos',  label: 'Términos',  icon: Search },
]

type ClienteOpt = { tenant_id: number; nombre: string; fuente: string }

/* Clases del item de navegación (sidebar siempre navy) */
function navClass(active: boolean, collapsed = false) {
  return [
    'flex items-center py-3 text-sm transition-colors border-l-2',
    collapsed ? 'justify-center px-0' : 'gap-3 px-6',
    active
      ? 'border-amber bg-white/[0.06] text-fog font-medium'
      : 'border-transparent text-[#8294B4] hover:text-fog hover:bg-white/[0.04]',
  ].join(' ')
}

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed]   = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [nivel, setNivel]           = useState<number | null>(null)
  const [clientes, setClientes]     = useState<ClienteOpt[]>([])
  const [monOpen, setMonOpen]       = useState(location.pathname.startsWith('/monitoreo'))

  // Estado de impersonación ("ver como cliente"). Se persiste en localStorage;
  // como al entrar/salir hacemos reload completo, leerlo en render alcanza.
  const adminToken  = localStorage.getItem('admin_token')
  const viewingAs   = localStorage.getItem('viewing_as')
  const impersonating = !!adminToken

  // El superadmin fuera de impersonación solo ve el Dashboard (comparativa de
  // clientes). Prospects/Términos son de un cliente puntual → aparecen al "ver
  // como un cliente". Un cliente normal (o el superadmin impersonando) ve todo.
  const navItems = nivel === 1 && !impersonating ? nav.filter(n => n.to === '/dashboard') : nav

  useEffect(() => {
    api.get<{ nivel: number }>('/auth/me').then(me => setNivel(me.nivel)).catch(() => {})
  }, [])

  useEffect(() => {
    if (nivel === 1 && !impersonating) {
      api.get<ClienteOpt[]>('/admin/clientes')
        .then(cs => setClientes(cs.filter(c => c.fuente === 'plataforma')))
        .catch(() => {})
    }
  }, [nivel, impersonating])

  function logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('admin_token')
    localStorage.removeItem('viewing_as')
    navigate('/login')
  }

  async function verComo(tenantId: number) {
    try {
      const r = await api.post<{ access_token: string; cliente: string }>(`/admin/clientes/${tenantId}/impersonate`)
      localStorage.setItem('admin_token', localStorage.getItem('token') || '')
      localStorage.setItem('token', r.access_token)
      localStorage.setItem('viewing_as', r.cliente)
      window.location.href = '/dashboard'
    } catch {
      alert('No se pudo ver como ese cliente (¿tiene usuario?).')
    }
  }

  function volverAdmin() {
    const t = localStorage.getItem('admin_token')
    if (t) localStorage.setItem('token', t)
    localStorage.removeItem('admin_token')
    localStorage.removeItem('viewing_as')
    window.location.href = '/dashboard'
  }

  /* Grupo "Monitoreo" desplegable → Servicios + Tokens (solo nivel 1) */
  const subClass = (active: boolean) =>
    [
      'flex items-center gap-3 pl-12 pr-6 py-2.5 text-sm transition-colors border-l-2',
      active
        ? 'border-amber bg-white/[0.06] text-fog font-medium'
        : 'border-transparent text-[#8294B4] hover:text-fog hover:bg-white/[0.04]',
    ].join(' ')

  function renderMonitoreo(collapsed: boolean, onNav?: () => void) {
    const onMon = location.pathname.startsWith('/monitoreo')
    if (collapsed) {
      return (
        <Link to="/monitoreo/servicios" title="Monitoreo" className={navClass(onMon, true)}>
          <Activity size={16} />
        </Link>
      )
    }
    return (
      <div>
        <button onClick={() => setMonOpen((v) => !v)} className={`${navClass(onMon)} w-full justify-between`}>
          <span className="flex items-center gap-3">
            <Activity size={16} />
            Monitoreo
          </span>
          <ChevronDown size={14} className={`transition-transform ${monOpen ? '' : '-rotate-90'}`} />
        </button>
        {monOpen && (
          <>
            <Link to="/monitoreo/servicios" onClick={onNav} className={subClass(location.pathname.startsWith('/monitoreo/servicios'))}>
              <Server size={14} />
              Servicios
            </Link>
            <Link to="/monitoreo/tokens" onClick={onNav} className={subClass(location.pathname.startsWith('/monitoreo/tokens'))}>
              <Coins size={14} />
              Tokens
            </Link>
          </>
        )}
      </div>
    )
  }

  /* Desplegable "Ver como un cliente" (solo nivel 1, fuera de impersonación) */
  const verComoSelect = (
    <div className="px-3 pb-2">
      <select
        value=""
        onChange={e => { if (e.target.value) verComo(Number(e.target.value)) }}
        className="w-full bg-white/[0.06] text-fog text-sm rounded-lg px-2 py-2 border border-white/10 focus:outline-none focus:ring-2 focus:ring-amber/50"
      >
        <option value="">Ver como un cliente…</option>
        {clientes.map(c => (
          <option key={c.tenant_id} value={c.tenant_id} className="text-ink">{c.nombre}</option>
        ))}
      </select>
    </div>
  )

  return (
    <SaveStatusProvider>
    <div className="flex h-screen bg-app text-ink">

      {/* ── Mobile top bar ── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-navy text-fog flex items-center gap-3 px-4 py-3 shadow">
        <button onClick={() => setMobileOpen(true)} className="text-[#8294B4] hover:text-fog">
          <Menu size={20} />
        </button>
        <ProspiaLogo markSize={22} className="text-fog" />
        <div className="ml-auto flex items-center gap-3"><SaveStatusIndicator />{nivel === 2 && <ReportarErrorButton />}<ThemeToggle /></div>
      </div>

      {/* ── Mobile drawer ── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-50 w-64 bg-navy text-fog flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
              <ProspiaLogo markSize={24} className="text-fog" />
              <button onClick={() => setMobileOpen(false)} className="text-[#8294B4] hover:text-fog">
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 py-4">
              {nivel === 1 && !impersonating && verComoSelect}
              {navItems.map(({ to, label, icon: Icon }) => {
                const active = location.pathname.startsWith(to)
                return (
                  <Link key={to} to={to} onClick={() => setMobileOpen(false)} className={navClass(active)}>
                    <Icon size={16} />
                    {label}
                  </Link>
                )
              })}
              {nivel === 2 && (
                <Link
                  to="/preguntas"
                  onClick={() => setMobileOpen(false)}
                  className={navClass(location.pathname.startsWith('/preguntas'))}
                >
                  <MessageCircleQuestion size={16} />
                  Preguntas
                </Link>
              )}
            </nav>
            {nivel === 1 && (
              <Link
                to="/pendientes"
                onClick={() => setMobileOpen(false)}
                className={navClass(location.pathname.startsWith('/pendientes'))}
              >
                <ListTodo size={16} />
                Pendientes
              </Link>
            )}
            {nivel === 1 && (
              <Link
                to="/errores"
                onClick={() => setMobileOpen(false)}
                className={navClass(location.pathname.startsWith('/errores'))}
              >
                <AlertTriangle size={16} />
                Errores
              </Link>
            )}
            {nivel === 1 && (
              <Link
                to="/preguntas"
                onClick={() => setMobileOpen(false)}
                className={navClass(location.pathname.startsWith('/preguntas'))}
              >
                <MessageCircleQuestion size={16} />
                Preguntas
              </Link>
            )}
            {nivel === 1 && (
              <Link
                to="/admin-clientes"
                onClick={() => setMobileOpen(false)}
                className={navClass(location.pathname.startsWith('/admin-clientes'))}
              >
                <ShieldCheck size={16} />
                Admin clientes
              </Link>
            )}
            {nivel === 1 && renderMonitoreo(false, () => setMobileOpen(false))}
            <Link
              to="/configuracion"
              onClick={() => setMobileOpen(false)}
              className={navClass(location.pathname.startsWith('/configuracion'))}
            >
              <Settings size={16} />
              Configuración
            </Link>
            <button
              onClick={() => { logout(); setMobileOpen(false) }}
              className="flex items-center gap-3 px-6 py-4 text-sm text-[#8294B4] hover:text-fog hover:bg-white/[0.04] border-t border-white/10"
            >
              <LogOut size={16} />
              Salir
            </button>
          </aside>
        </div>
      )}

      {/* ── Desktop sidebar ── */}
      <aside
        className="hidden md:flex flex-col bg-navy text-fog transition-all duration-200 shrink-0"
        style={{ width: collapsed ? 56 : 224 }}
      >
        <div className={`px-4 py-5 border-b border-white/10 flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {collapsed ? <ProspiaMark size={24} /> : <ProspiaLogo markSize={24} className="text-fog" />}
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="text-[#8294B4] hover:text-fog transition-colors shrink-0"
              title="Colapsar"
            >
              <ChevronLeft size={16} />
            </button>
          )}
        </div>
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="flex justify-center py-2 text-[#8294B4] hover:text-fog"
            title="Expandir"
          >
            <ChevronRight size={16} />
          </button>
        )}
        <nav className="flex-1 py-4">
          {nivel === 1 && !impersonating && !collapsed && verComoSelect}
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = location.pathname.startsWith(to)
            return (
              <Link key={to} to={to} title={collapsed ? label : undefined} className={navClass(active, collapsed)}>
                <Icon size={16} />
                {!collapsed && label}
              </Link>
            )
          })}
        </nav>
        {nivel === 2 && (
          <Link
            to="/preguntas"
            title={collapsed ? 'Preguntas' : undefined}
            className={navClass(location.pathname.startsWith('/preguntas'), collapsed)}
          >
            <MessageCircleQuestion size={16} />
            {!collapsed && 'Preguntas'}
          </Link>
        )}
        {nivel === 1 && (
          <Link
            to="/pendientes"
            title={collapsed ? 'Pendientes' : undefined}
            className={navClass(location.pathname.startsWith('/pendientes'), collapsed)}
          >
            <ListTodo size={16} />
            {!collapsed && 'Pendientes'}
          </Link>
        )}
        {nivel === 1 && (
          <Link
            to="/errores"
            title={collapsed ? 'Errores' : undefined}
            className={navClass(location.pathname.startsWith('/errores'), collapsed)}
          >
            <AlertTriangle size={16} />
            {!collapsed && 'Errores'}
          </Link>
        )}
        {nivel === 1 && (
          <Link
            to="/preguntas"
            title={collapsed ? 'Preguntas' : undefined}
            className={navClass(location.pathname.startsWith('/preguntas'), collapsed)}
          >
            <MessageCircleQuestion size={16} />
            {!collapsed && 'Preguntas'}
          </Link>
        )}
        {nivel === 1 && (
          <Link
            to="/admin-clientes"
            title={collapsed ? 'Admin clientes' : undefined}
            className={navClass(location.pathname.startsWith('/admin-clientes'), collapsed)}
          >
            <ShieldCheck size={16} />
            {!collapsed && 'Admin clientes'}
          </Link>
        )}
        {nivel === 1 && renderMonitoreo(collapsed)}
        <Link
          to="/configuracion"
          title={collapsed ? 'Configuración' : undefined}
          className={navClass(location.pathname.startsWith('/configuracion'), collapsed)}
        >
          <Settings size={16} />
          {!collapsed && 'Configuración'}
        </Link>
        <button
          onClick={logout}
          title={collapsed ? 'Salir' : undefined}
          className={`flex items-center py-4 text-sm text-[#8294B4] hover:text-fog hover:bg-white/[0.04] border-t border-white/10 transition-colors ${
            collapsed ? 'justify-center px-0' : 'gap-3 px-6'
          }`}
        >
          <LogOut size={16} />
          {!collapsed && 'Salir'}
        </button>
      </aside>

      {/* ── Contenido principal ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar desktop con el indicador de guardado + el toggle a la derecha */}
        <div className="hidden md:flex items-center justify-end gap-4 px-6 h-12 border-b border-line bg-card/60 shrink-0">
          <SaveStatusIndicator />
          {nivel === 2 && <ReportarErrorButton />}
          <ThemeToggle />
        </div>
        <main className="flex-1 overflow-auto p-4 md:p-6 pt-16 md:pt-6">
          {impersonating && (
            <div className="mb-4 rounded-xl border border-amber/40 bg-amber/10 px-4 py-2.5 text-sm flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-ink">
                <Eye size={16} className="text-amber" />
                Viendo como <strong>{viewingAs}</strong>
              </span>
              <button onClick={volverAdmin} className="text-amber font-medium hover:underline shrink-0">
                Volver a admin
              </button>
            </div>
          )}
          <Outlet />
        </main>
      </div>

      {/* Asistente de ayuda flotante — solo cliente normal (nivel 2) */}
      {nivel === 2 && <AyudaFlotante />}
    </div>
    </SaveStatusProvider>
  )
}
