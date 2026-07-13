import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Prospects from './pages/Prospects'
import Terminos from './pages/Terminos'
import Configuracion from './pages/Configuracion'
import AdminClientes from './pages/AdminClientes'
import Pendientes from './pages/Pendientes'
import Errores from './pages/Errores'
import Preguntas from './pages/Preguntas'
import MonitoreoPage from './pages/MonitoreoPage'
import Tokens from './pages/Tokens'
import Calidad from './pages/Calidad'
import Saldos from './pages/Saldos'
import TestVisuales from './pages/TestVisuales'
import TestLlm from './pages/TestLlm'
import Layout from './components/Layout'
import { ThemeProvider } from './theme'
import './index.css'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  return localStorage.getItem('token') ? <>{children}</> : <Navigate to="/login" replace />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="prospects" element={<Prospects />} />
          <Route path="terminos" element={<Terminos />} />
          <Route path="configuracion" element={<Configuracion />} />
          <Route path="admin-clientes" element={<AdminClientes />} />
          <Route path="pendientes" element={<Pendientes />} />
          <Route path="errores" element={<Errores />} />
          <Route path="preguntas" element={<Preguntas />} />
          <Route path="monitoreo" element={<Navigate to="/monitoreo/servicios" replace />} />
          <Route path="monitoreo/servicios" element={<MonitoreoPage />} />
          <Route path="monitoreo/tokens" element={<Tokens />} />
          <Route path="monitoreo/calidad" element={<Calidad />} />
          <Route path="monitoreo/saldos" element={<Saldos />} />
          <Route path="testing" element={<Navigate to="/testing/visuales" replace />} />
          <Route path="testing/visuales" element={<TestVisuales />} />
          <Route path="testing/llm" element={<TestLlm />} />
          {/* back-compat: la ruta vieja redirige al nuevo submenú */}
          <Route path="test-visuales" element={<Navigate to="/testing/visuales" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
)
