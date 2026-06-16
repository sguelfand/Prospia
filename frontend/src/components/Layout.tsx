import { BarChart2, ChevronLeft, ChevronRight, LogOut, Menu, Search, Users, X } from 'lucide-react'
import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: BarChart2 },
  { to: '/prospects', label: 'Prospects', icon: Users },
  { to: '/terminos',  label: 'Términos',  icon: Search },
]

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation()
  return (
    <>
      {nav.map(({ to, label, icon: Icon }) => {
        const active = location.pathname.startsWith(to)
        return (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-6 py-3 text-sm hover:bg-gray-800 transition-colors ${
              active ? 'bg-gray-800 text-white' : 'text-gray-400'
            }`}
          >
            <Icon size={16} />
            {label}
          </Link>
        )
      })}
    </>
  )
}

export default function Layout() {
  const location        = useLocation()
  const navigate        = useNavigate()
  const [collapsed, setCollapsed]   = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  function logout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  return (
    <div className="flex h-screen">

      {/* ── Mobile top bar ── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-gray-900 text-white flex items-center gap-3 px-4 py-3 shadow">
        <button onClick={() => setMobileOpen(true)} className="text-gray-400 hover:text-white">
          <Menu size={20} />
        </button>
        <span className="font-bold text-base">Prospects</span>
      </div>

      {/* ── Mobile drawer ── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          {/* Panel */}
          <aside className="relative z-50 w-64 bg-gray-900 text-white flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-700">
              <span className="text-lg font-bold">Prospects</span>
              <button onClick={() => setMobileOpen(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 py-4">
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </nav>
            <button
              onClick={() => { logout(); setMobileOpen(false) }}
              className="flex items-center gap-3 px-6 py-4 text-sm text-gray-400 hover:text-white hover:bg-gray-800 border-t border-gray-700"
            >
              <LogOut size={16} />
              Salir
            </button>
          </aside>
        </div>
      )}

      {/* ── Desktop sidebar ── */}
      <aside
        className="hidden md:flex flex-col bg-gray-900 text-white transition-all duration-200 shrink-0"
        style={{ width: collapsed ? 56 : 224 }}
      >
        <div className={`px-4 py-5 text-lg font-bold border-b border-gray-700 flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed && <span>Prospects</span>}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="text-gray-400 hover:text-white transition-colors shrink-0"
            title={collapsed ? 'Expandir' : 'Colapsar'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
        <nav className="flex-1 py-4">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = location.pathname.startsWith(to)
            return (
              <Link
                key={to}
                to={to}
                title={collapsed ? label : undefined}
                className={`flex items-center py-3 text-sm hover:bg-gray-800 transition-colors ${
                  collapsed ? 'justify-center px-0' : 'gap-3 px-6'
                } ${active ? 'bg-gray-800 text-white' : 'text-gray-400'}`}
              >
                <Icon size={16} />
                {!collapsed && label}
              </Link>
            )
          })}
        </nav>
        <button
          onClick={logout}
          title={collapsed ? 'Salir' : undefined}
          className={`flex items-center py-4 text-sm text-gray-400 hover:text-white hover:bg-gray-800 border-t border-gray-700 transition-colors ${
            collapsed ? 'justify-center px-0' : 'gap-3 px-6'
          }`}
        >
          <LogOut size={16} />
          {!collapsed && 'Salir'}
        </button>
      </aside>

      {/* ── Contenido principal ── */}
      <main className="flex-1 overflow-auto p-4 md:p-6 pt-16 md:pt-6">
        <Outlet />
      </main>
    </div>
  )
}
