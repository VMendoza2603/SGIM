import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, eventos, token } from './api';

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
  iniciar: (correo: string, password: string) => Promise<Usuario>;
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
    api<Usuario>('/auth/me')
      .then(setUsuario)
      .catch(() => token.borrar())
      .finally(() => setCargando(false));
  }, []);

  const salir = useCallback(() => {
    token.borrar();
    setUsuario(null);
  }, []);

  useEffect(() => {
    eventos.addEventListener('sesion-expirada', salir);
    return () => eventos.removeEventListener('sesion-expirada', salir);
  }, [salir]);

  const iniciar = async (correo: string, password: string) => {
    const r = await api<{ token: string; usuario: Usuario }>('/auth/login', { method: 'POST', body: { correo, password } });
    token.guardar(r.token);
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
