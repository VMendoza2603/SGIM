import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, eventos, token } from './api';

export interface Usuario {
  id: number;
  rol: 'ADMIN' | 'TECNICO';
  nombres: string;
  apellidos: string;
  correo: string;
  idTecnico: number | null;
  debeCambiarPwd: boolean;
  permisos: string[];
}

interface Sesion {
  usuario: Usuario | null;
  cargando: boolean;
  iniciar: (correo: string, password: string, recordar?: boolean) => Promise<Usuario>;
  salir: () => void;
  actualizar: (u: Usuario) => void;
  puede: (...permisos: string[]) => boolean;
}

const Ctx = createContext<Sesion | null>(null);

export function SesionProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(!!token.leer());

  useEffect(() => {
    if (!token.leer()) return;
    // La sesión solo se borra si el servidor la rechaza (401/403). Si el servidor se está reiniciando o la red falla
    // un momento, se reintenta (hasta ~20 s) en vez de mandar al usuario al login.
    let vigente = true;
    const intentar = (n: number) =>
      api<Usuario>('/auth/me')
        .then((u) => vigente && (setUsuario(u), setCargando(false)))
        .catch((e) => {
          if (!vigente) return;
          const status = (e as ApiError).status;
          if (status === 401 || status === 403) {
            token.borrar();
            setCargando(false);
          } else if (n < 10) setTimeout(() => intentar(n + 1), 2000);
          else setCargando(false);
        });
    intentar(1);
    return () => {
      vigente = false;
    };
  }, []);

  const salir = useCallback(() => {
    token.borrar();
    setUsuario(null);
  }, []);

  useEffect(() => {
    eventos.addEventListener('sesion-expirada', salir);
    return () => eventos.removeEventListener('sesion-expirada', salir);
  }, [salir]);

  const iniciar = async (correo: string, password: string, recordar = false) => {
    const r = await api<{ token: string; usuario: Usuario }>('/auth/login', { method: 'POST', body: { correo, password } });
    token.guardar(r.token, recordar);
    setUsuario(r.usuario);
    return r.usuario;
  };

  const puede = (...permisos: string[]) => !!usuario && permisos.some((p) => usuario.permisos.includes(p));

  return (
    <Ctx.Provider value={{ usuario, cargando, iniciar, salir, actualizar: setUsuario, puede }}>{children}</Ctx.Provider>
  );
}

export function useSesion() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSesion fuera de SesionProvider');
  return s;
}

/** Página de inicio según el rol (P01: Coordinador → Dashboard, Técnico → Mis incidentes). */
export const inicioDe = (u: Usuario) => (u.rol === 'TECNICO' ? '/mis-incidentes' : '/');
