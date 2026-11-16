import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const noEncontrado = (que = 'Recurso') => new HttpError(404, `${que} no encontrado`);
export const prohibido = (msg = 'No tienes permiso para realizar esta acción') => new HttpError(403, msg);

/** Envuelve handlers async para que los errores lleguen al middleware de errores. */
export const ruta =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export function manejadorErrores(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  }
  // Errores lanzados por los triggers de PostgreSQL (transición no permitida, técnico inactivo...)
  const pgErr = err as { code?: string; message?: string };
  if (pgErr.code === '23514' || pgErr.code === 'P0001') return res.status(409).json({ error: pgErr.message });
  if (pgErr.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con esos datos' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
}
