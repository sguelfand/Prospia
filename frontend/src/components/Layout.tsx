import { BarChart2, ChevronLeft, ChevronRight, LogOut, Menu, Search, Settings, ShieldCheck, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { ProspiaLogo, ProspiaMark } from './Logo'
import ThemeToggle from './ThemeToggle'

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: BarChart2 },
  { to: '/prospects', label: 'Prospects', icon: Users },
  { to: '/terminos',  label: 'Términos',  icon: Search },
]

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

  useEffect(() => {
    api.get<{ nivel: number }>('/auth/me').then(me => setNivel(me.nivel)).catch(() => {})
  }, [])

  function logout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-app text-ink">

      {/* ── Mobile top bar ── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-navy text-fog flex items-center gap-3 px-4 py-3 shadow">
        <button onClick={() => setMobileOpen(true)} className="text-[#8294B4] hover:text-fog">
          <Menu size={20} />
        </button>
        <ProspiaLogo markSize={22} className="text-fog" />
        <div className="ml-auto"><ThemeToggle /></div>
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
              {nav.map(({ to, label, icon: Icon }) => {
                const active = location.pathname.startsWith(to)
                return (
                  <Link key={to} to={to} onClick={() => setMobileOpen(false)} className={navClass(active)}>
                    <Icon size={16} />
                    {label}
                  </Link>
                )
              })}
            </nav>
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
          {nav.map(({ to, label, icon: Icon }) => {
            const active = location.pathname.startsWith(to)
            return (
              <Link key={to} to={to} title={collapsed ? label : undefined} className={navClass(active, collapsed)}>
                <Icon size={16} />
                {!collapsed && label}
              </Link>
            )
          })}
        </nav>
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
        {/* Top bar desktop con el toggle arriba a la derecha */}
        <div className="hidden md:flex items-center justify-end gap-2 px-6 h-12 border-b border-line bg-card/60 shrink-0">
          <ThemeToggle />
        </div>
        <main className="flex-1 overflow-auto p-4 md:p-6 pt-16 md:pt-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
