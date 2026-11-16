const CLAVE_TOKEN = 'sgim.token';

export const token = {
  leer: () => {
    try { return sessionStorage.getItem(CLAVE_TOKEN); } catch { return null; }
  },
  guardar: (t: string) => {
    try { sessionStorage.setItem(CLAVE_TOKEN, t); } catch { /* sin almacenamiento */ }
  },
  borrar: () => {
    try { sessionStorage.removeItem(CLAVE_TOKEN); } catch { /* sin almacenamiento */ }
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
  const res = await fetch(`/api${ruta}`, {
    method: opciones.method ?? 'GET',
    headers: {
      ...(opciones.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && t) eventos.dispatchEvent(new Event('sesion-expirada'));
    if (res.status === 428) eventos.dispatchEvent(new Event('cambiar-password'));
    throw new ApiError(res.status, datos.error ?? 'No se pudo completar la operación');
  }
  return datos as T;
}
