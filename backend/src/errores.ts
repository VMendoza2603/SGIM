import type { NextFunction, Request, Response } from 'express';
import { z, ZodError, ZodIssueCode } from 'zod';

/** Mensajes de validación de zod en español (los que no se personalizan en cada esquema). */
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      return { message: issue.received === 'undefined' ? 'Es obligatorio' : 'Tipo de dato no válido' };
    case ZodIssueCode.invalid_enum_value:
      return { message: `Valor no permitido. Opciones: ${issue.options.join(', ')}` };
    case ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Correo no válido' };
      if (issue.validation === 'date') return { message: 'Fecha no válida (AAAA-MM-DD)' };
      if (issue.validation === 'url') return { message: 'Dirección web no válida' };
      if (issue.validation === 'uuid') return { message: 'Identificador no válido' };
      return { message: 'Formato no válido' };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: issue.minimum === 1 ? 'No puede quedar vacío' : `Mínimo ${issue.minimum} caracteres` };
      if (issue.type === 'array') return { message: `Elige al menos ${issue.minimum}` };
      return { message: `Debe ser mayor o igual a ${issue.minimum}` };
    case ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Máximo ${issue.maximum} caracteres` };
      if (issue.type === 'array') return { message: `Máximo ${issue.maximum} elementos` };
      return { message: `Debe ser menor o igual a ${issue.maximum}` };
    case ZodIssueCode.invalid_date:
      return { message: 'Fecha no válida' };
    case ZodIssueCode.invalid_union:
    case ZodIssueCode.invalid_literal:
      return { message: 'Dato no válido o incompleto' };
    default:
      return { message: ctx.defaultError };
  }
});

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** «Conversación no encontrada», «Equipo no encontrado»: concuerda con el género de la palabra. */
const FEMENINOS = new Set(['Conversación', 'Ubicación', 'Regla']);
export const noEncontrado = (que = 'Recurso') => new HttpError(404, `${que} no ${FEMENINOS.has(que) ? 'encontrada' : 'encontrado'}`);
export const prohibido = (msg = 'No tienes permiso para realizar esta acción') => new HttpError(403, msg);

/** Envuelve handlers async para que los errores lleguen al middleware de errores. */
export const ruta =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export function manejadorErrores(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  // Errores de express.json: cuerpo que no es JSON válido o demasiado grande
  const tipo = (err as { type?: string }).type;
  if (tipo === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido' });
  if (tipo === 'entity.too.large') return res.status(413).json({ error: 'El archivo o los datos enviados superan el tamaño permitido' });
  if (err instanceof ZodError) {
    // El panel muestra solo `error`: se incluye el primer problema para que el usuario sepa qué corregir
    const primero = err.issues[0];
    const campo = primero?.path.join('.');
    return res.status(400).json({
      error: primero ? `Datos inválidos${campo ? ` (${campo})` : ''}: ${primero.message}` : 'Datos inválidos',
      detalles: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  // Errores lanzados por los triggers de PostgreSQL (transición no permitida, técnico inactivo...)
  const pgErr = err as { code?: string; message?: string };
  if (pgErr.code === '23514' || pgErr.code === 'P0001') return res.status(409).json({ error: pgErr.message });
  if (pgErr.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con esos datos' });
  if (pgErr.code === '23503') return res.status(409).json({ error: 'El registro está relacionado con otros datos o hace referencia a uno que no existe' });
  // Identificador o fecha con formato inválido (ej. /conversaciones/abc o un número fuera de rango): es un error del cliente, no del servidor
  if (pgErr.code && ['22P02', '22003', '22007', '22008'].includes(pgErr.code)) return res.status(400).json({ error: 'Dato con formato inválido' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
}
