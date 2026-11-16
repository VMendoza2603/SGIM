import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query, queryOne } from './db.js';
import { HttpError, prohibido } from './errores.js';

export interface UsuarioSesion {
  id: number;
  rol: 'ADMIN' | 'TECNICO' | 'COMUNIDAD';
  idRol: number;
  nombres: string;
  apellidos: string;
  correo: string;
  idTecnico: number | null;
  debeCambiarPwd: boolean;
  telefonoWa: string | null;
  permisos: string[];
  /** Epoch ms: los tokens emitidos antes quedan revocados. */
  sesionesDesde: number | null;
}

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioSesion;
    }
  }
}

export function firmarToken(idUsuario: number) {
  return jwt.sign({ sub: idUsuario }, config.jwtSecret, { expiresIn: config.jwtExpira });
}

/** Carga el usuario con su rol y permisos desde la base (los permisos no viajan en el token). */
export async function cargarUsuario(idUsuario: number): Promise<UsuarioSesion | null> {
  const u = await queryOne(
    `SELECT u.id_usuario, u.nombres, u.apellidos, u.correo, u.debe_cambiar_pwd, u.activo, u.sesiones_desde, u.telefono_wa,
            r.id_rol, r.codigo AS rol, r.acceso_web, t.id_tecnico
       FROM usuario u
       JOIN rol r ON r.id_rol = u.id_rol
       LEFT JOIN tecnico t ON t.id_usuario = u.id_usuario
      WHERE u.id_usuario = $1`,
    [idUsuario],
  );
  if (!u || !u.activo || !u.acceso_web) return null;
  const permisos = await query<{ codigo: string }>(
    `SELECT p.codigo FROM rol_permiso rp JOIN permiso p ON p.id_permiso = rp.id_permiso WHERE rp.id_rol = $1`,
    [u.id_rol],
  );
  return {
    id: u.id_usuario,
    rol: u.rol,
    idRol: u.id_rol,
    nombres: u.nombres,
    apellidos: u.apellidos,
    correo: u.correo,
    idTecnico: u.id_tecnico,
    debeCambiarPwd: u.debe_cambiar_pwd,
    telefonoWa: u.telefono_wa,
    permisos: permisos.map((p) => p.codigo),
    sesionesDesde: u.sesiones_desde ? new Date(u.sesiones_desde).getTime() : null,
  };
}

export async function autenticar(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Inicia sesión para continuar');
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    } catch {
      throw new HttpError(401, 'Tu sesión expiró. Vuelve a iniciar sesión');
    }
    const usuario = await cargarUsuario(Number(payload.sub));
    if (!usuario) throw new HttpError(401, 'Tu cuenta no tiene acceso al panel');
    // iat tiene precisión de segundos: se compara con el segundo en que se cerraron las sesiones
    if (usuario.sesionesDesde && (payload.iat ?? 0) < Math.floor(usuario.sesionesDesde / 1000)) {
      throw new HttpError(401, 'Tu sesión se cerró. Vuelve a iniciar sesión');
    }
    req.usuario = usuario;
    next();
  } catch (e) {
    next(e);
  }
}

/** Exige al menos uno de los permisos indicados. Registra el intento denegado en auditoría. */
export function requierePermiso(...codigos: string[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const u = req.usuario!;
    if (codigos.some((c) => u.permisos.includes(c))) return next();
    await query(
      `INSERT INTO auditoria (id_usuario, accion, entidad, ip) VALUES ($1, 'ACCESO_DENEGADO', $2, $3)`,
      [u.id, req.originalUrl, req.ip ?? null],
    ).catch(() => undefined);
    next(prohibido());
  };
}

/** Bloquea el resto de la API hasta que el usuario cambie su contraseña temporal. */
export function exigeContrasenaDefinitiva(req: Request, _res: Response, next: NextFunction) {
  if (req.usuario?.debeCambiarPwd) return next(new HttpError(428, 'Debes cambiar tu contraseña temporal'));
  next();
}

export const tiene = (req: Request, permiso: string) => req.usuario!.permisos.includes(permiso);
