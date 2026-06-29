/**
 * Registro de pantallas para el asistente de ayuda Haiku.
 *
 * Por cada ruta del cliente, una descripción en castellano simple de QUÉ se puede
 * hacer ahí (funciones y botones), NO de los datos cargados. Esto se le pasa a
 * Haiku como contexto para que la ayuda sea sobre la pantalla en la que está el
 * cliente. Mantener este texto en sync con la UI; cualquier cambio acá sale por
 * deploy de la web (no toca el backend).
 */
export interface PantallaAyuda {
  titulo: string
  funciones: string
}

const PANTALLAS: Record<string, PantallaAyuda> = {
  '/dashboard': {
    titulo: 'Inicio (Dashboard)',
    funciones:
      'Es la pantalla de resumen. Muestra los números principales de la prospección: ' +
      'cuántos contactos se cargaron, cuántos se contactaron, cuántos mostraron interés. ' +
      'Los números y gráficos se pueden tocar para ir al detalle filtrado.',
  },
  '/prospects': {
    titulo: 'Prospects (contactos)',
    funciones:
      'Es la lista de contactos/empresas que el sistema encontró. Acá podés: buscar y ' +
      'filtrar por estado o clasificación (Alto/Medio/Bajo), tocar un contacto para ver ' +
      'su ficha, ver la conversación de WhatsApp con el botón "Chat", y revisar si ya se ' +
      'lo contactó. La clasificación indica qué tan buen prospect es cada uno.',
  },
  '/terminos': {
    titulo: 'Términos de búsqueda',
    funciones:
      'Acá se definen las búsquedas que usa el sistema para encontrar nuevos contactos ' +
      '(por ejemplo un rubro o tipo de empresa). Podés agregar, editar o sacar términos. ' +
      'Cada término alimenta la lista de Prospects.',
  },
  '/configuracion': {
    titulo: 'Configuración',
    funciones:
      'Desde acá manejás tu cuenta y la información de tu negocio. Podés: editar la ' +
      '"Información del negocio" (lo que el asistente usa para hablar con tus clientes), ' +
      'cambiar tu contraseña y ajustar tus preferencias. La sección de info del negocio ' +
      'tiene un asistente para ayudarte a completar cada casillero.',
  },
  '/preguntas': {
    titulo: 'Preguntas',
    funciones:
      'Acá aparecen las preguntas que tu asistente no supo responder y te escaló. Podés ' +
      'leer la pregunta del cliente, escribir la respuesta y enviarla: el asistente se la ' +
      'reenvía al cliente por WhatsApp automáticamente.',
  },
}

const DEFAULT_PANTALLA: PantallaAyuda = {
  titulo: 'Prospia',
  funciones:
    'Prospia es tu plataforma para encontrar contactos comerciales y que un asistente los ' +
    'contacte por vos. Desde el menú de la izquierda llegás a las distintas secciones.',
}

/** Resuelve la pantalla activa por el pathname (matchea por prefijo de ruta). */
export function pantallaPorPath(pathname: string): PantallaAyuda {
  const hit = Object.keys(PANTALLAS).find(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
  return hit ? PANTALLAS[hit] : DEFAULT_PANTALLA
}
