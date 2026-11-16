import { Router } from 'express';
import { z } from 'zod';
import { requierePermiso } from '../auth.js';
import { query, queryOne } from '../db.js';
import { ruta } from '../errores.js';

export const auditoriaRouter = Router();

/** A14 · Bitácora de solo lectura. */
auditoriaRouter.get(
  '/',
  requierePermiso('auditoria.ver'),
  ruta(async (req, res) => {
    const f = z
      .object({
        usuario: z.coerce.number().int().optional(),
        accion: z.string().optional(),
        desde: z.string().date().optional(),
        hasta: z.string().date().optional(),
        pagina: z.coerce.number().int().min(1).default(1),
      })
      .parse(req.query);
    const where = `($1::bigint IS NULL OR a.id_usuario = $1) AND ($2::text IS NULL OR a.accion = $2)
                   AND ($3::date IS NULL OR a.creado_en >= $3) AND ($4::date IS NULL OR a.creado_en < $4::date + 1)`;
    const params = [f.usuario ?? null, f.accion || null, f.desde ?? null, f.hasta ?? null];
    const porPagina = 50;
    const [total, filas, acciones, usuarios] = await Promise.all([
      queryOne<{ n: number }>(`SELECT count(*)::int n FROM auditoria a WHERE ${where}`, params),
      query(
        `SELECT a.id_auditoria, a.creado_en, a.accion, a.entidad, a.id_entidad, a.datos_anteriores, a.datos_nuevos, host(a.ip) AS ip,
                u.nombres || ' ' || u.apellidos AS usuario
           FROM auditoria a LEFT JOIN usuario u ON u.id_usuario = a.id_usuario
          WHERE ${where} ORDER BY a.creado_en DESC LIMIT ${porPagina} OFFSET ${(f.pagina - 1) * porPagina}`,
        params,
      ),
      query(`SELECT DISTINCT accion FROM auditoria ORDER BY accion`),
      query(`SELECT DISTINCT u.id_usuario AS id, u.nombres || ' ' || u.apellidos AS nombre FROM auditoria a JOIN usuario u USING (id_usuario) ORDER BY 2`),
    ]);
    res.json({ total: total!.n, porPagina, pagina: f.pagina, filas, acciones: acciones.map((a) => a.accion), usuarios });
  }),
);
