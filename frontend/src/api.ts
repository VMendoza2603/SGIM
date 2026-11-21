const CLAVE_TOKEN = 'sgim.token';

/**
 * Dónde vive el token: sessionStorage (se borra al cerrar el navegador) o, con «Recordar este equipo»,
 * localStorage (sigue abierta hasta que el token caduque a las 8 h o se cierre sesión).
 */
export const token = {
  leer: () => {
    try { return sessionStorage.getItem(CLAVE_TOKEN) ?? localStorage.getItem(CLAVE_TOKEN); } catch { return null; }
  },
  /** `recordar` solo se indica al iniciar sesión; al renovar el token se conserva el lugar donde ya estaba. */
  guardar: (t: string, recordar?: boolean) => {
    try {
      const persistente = recordar ?? (localStorage.getItem(CLAVE_TOKEN) !== null);
      token.borrar();
      (persistente ? localStorage : sessionStorage).setItem(CLAVE_TOKEN, t);
    } catch { /* sin almacenamiento */ }
  },
  borrar: () => {
    try {
      sessionStorage.removeItem(CLAVE_TOKEN);
      localStorage.removeItem(CLAVE_TOKEN);
    } catch { /* sin almacenamiento */ }
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Se dispara cuando la sesión expira, para que la app vuelva al login. */
export const eventos = new EventTarget();

export async function api<T = any>(ruta: string, opciones: { method?: string; body?: unknown } = {}): Promise<T> {
  const t = token.leer();
  let res: Response;
  try {
    res = await fetch(`/api${ruta}`, {
      method: opciones.method ?? 'GET',
      headers: {
        ...(opciones.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
      body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
    });
  } catch {
    // Sin internet o servidor apagado: el navegador solo dice «Failed to fetch» (en inglés)
    throw new ApiError(0, 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.');
  }
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && t) eventos.dispatchEvent(new Event('sesion-expirada'));
    if (res.status === 428) eventos.dispatchEvent(new Event('cambiar-password'));
    throw new ApiError(res.status, datos.error ?? 'No se pudo completar la operación');
  }
  return datos as T;
}
