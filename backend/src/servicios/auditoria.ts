import type { Request } from 'express';
import { query } from '../db.js';

/** Registra en la bitácora de auditoría (A14) un cambio hecho desde el panel. */
export function auditar(req: Request, accion: string, entidad: string, idEntidad: string | number, antes?: unknown, despues?: unknown) {
  return query(
    `INSERT INTO auditoria (id_usuario, accion, entidad, id_entidad, datos_anteriores, datos_nuevos, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      req.usuario?.id ?? null,
      accion,
      entidad,
      String(idEntidad),
      antes === undefined ? null : JSON.stringify(antes),
      despues === undefined ? null : JSON.stringify(despues),
      req.ip ?? null,
    ],
  );
}

/** Contraseña temporal legible que cumple la política (mayúscula, número y símbolo). */
export function contrasenaTemporal() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const azar = (n: number) => Array.from({ length: n }, () => letras[Math.floor(Math.random() * letras.length)]).join('');
  return `${azar(1).toUpperCase()}${azar(5)}${Math.floor(10 + Math.random() * 89)}*`;
}
