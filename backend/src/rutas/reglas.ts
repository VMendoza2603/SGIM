import { Router } from 'express';
import { z } from 'zod';
import { requierePermiso } from '../auth.js';
import { query, queryOne } from '../db.js';
import { noEncontrado, ruta } from '../errores.js';
import { auditar } from '../servicios/auditoria.js';
import { calcularPrioridad } from '../servicios/prioridad.js';

export const reglasRouter = Router();
reglasRouter.use(requierePermiso('regla.gestionar'));

/** Variables que el motor sabe evaluar (A10). */
export const VARIABLES = [
  { codigo: 'riesgo_personas', nombre: 'Riesgo para personas', tipo: 'bool' },
  { codigo: 'riesgo_electrico', nombre: 'Riesgo eléctrico visible', tipo: 'bool' },
  { codigo: 'fuga_activa', nombre: 'Fuga de agua activa', tipo: 'bool' },
  { codigo: 'afecta_clases', nombre: 'Impide dar clases', tipo: 'bool' },
  { codigo: 'categoria', nombre: 'Categoría', tipo: 'categoria' },
  { codigo: 'criticidad_ubicacion', nombre: 'Criticidad de la ubicación (1-5)', tipo: 'numero' },
  { codigo: 'personas_afectadas', nombre: 'Personas afectadas', tipo: 'numero' },
  { codigo: 'reincidencias_30d', nombre: 'Incidentes en 30 días', tipo: 'numero' },
] as const;

reglasRouter.get(
  '/',
  ruta(async (_req, res) => {
    const [reglas, prioridades] = await Promise.all([
      query(
        `SELECT r.id_regla, r.nombre, r.descripcion, r.variable, r.operador, r.valor, r.puntos, r.forzar_prioridad, r.orden, r.activo,
                p.codigo AS fuerza
           FROM regla_prioridad r LEFT JOIN prioridad p ON p.id_prioridad = r.forzar_prioridad ORDER BY r.orden, r.id_regla`,
      ),
      query(`SELECT id_prioridad AS id, codigo, nombre, puntaje_min, puntaje_max FROM prioridad ORDER BY nivel`),
    ]);
    res.json({ reglas, prioridades, variables: VARIABLES });
  }),
);

const reglaSchema = z.object({
  nombre: z.string().trim().min(3).max(120),
  descripcion: z.string().trim().max(255).nullable().optional(),
  variable: z.enum(VARIABLES.map((v) => v.codigo) as [string, ...string[]]),
  operador: z.enum(['=', '!=', '>', '>=', '<', '<=', 'IN', 'CONTAINS']),
  valor: z.string().trim().min(1).max(255),
  puntos: z.number().int().min(-100).max(200),
  forzar_prioridad: z.number().int().nullable().optional(),
  orden: z.number().int().min(0).max(999),
  activo: z.boolean().default(true),
});
const valores = (b: z.infer<typeof reglaSchema>) => [b.nombre, b.descripcion || null, b.variable, b.operador, b.valor, b.puntos, b.forzar_prioridad ?? null, b.orden, b.activo];

reglasRouter.post(
  '/',
  ruta(async (req, res) => {
    const b = reglaSchema.parse(req.body);
    const r = await queryOne(
      `INSERT INTO regla_prioridad (nombre, descripcion, variable, operador, valor, puntos, forzar_prioridad, orden, activo, actualizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id_regla`,
      [...valores(b), req.usuario!.id],
    );
    await auditar(req, 'CREAR', 'regla_prioridad', r!.id_regla, undefined, b);
    res.status(201).json(r);
  }),
);

reglasRouter.put(
  '/:id',
  ruta(async (req, res) => {
    const b = reglaSchema.parse(req.body);
    const antes = await queryOne(`SELECT * FROM regla_prioridad WHERE id_regla = $1`, [req.params.id]);
    if (!antes) throw noEncontrado('Regla');
    await query(
      `UPDATE regla_prioridad SET nombre=$2, descripcion=$3, variable=$4, operador=$5, valor=$6, puntos=$7, forzar_prioridad=$8, orden=$9,
              activo=$10, actualizado_por=$11, actualizado_en=now() WHERE id_regla=$1`,
      [req.params.id, ...valores(b), req.usuario!.id],
    );
    await auditar(req, 'EDITAR', 'regla_prioridad', req.params.id, antes, b);
    res.json({ ok: true });
  }),
);

reglasRouter.patch(
  '/:id/activo',
  ruta(async (req, res) => {
    const { activo } = z.object({ activo: z.boolean() }).parse(req.body);
    await query(`UPDATE regla_prioridad SET activo = $2, actualizado_por = $3, actualizado_en = now() WHERE id_regla = $1`, [req.params.id, activo, req.usuario!.id]);
    await auditar(req, activo ? 'ACTIVAR' : 'DESACTIVAR', 'regla_prioridad', req.params.id);
    res.json({ ok: true });
  }),
);

/** Simula el puntaje con las reglas activas (no guarda nada). */
reglasRouter.post(
  '/simular',
  ruta(async (req, res) => {
    const vars = z
      .object({
        categoria: z.string().nullable().optional(),
        riesgo_personas: z.boolean().optional(),
        riesgo_electrico: z.boolean().optional(),
        fuga_activa: z.boolean().optional(),
        afecta_clases: z.boolean().optional(),
        criticidad_ubicacion: z.number().nullable().optional(),
        personas_afectadas: z.number().nullable().optional(),
        reincidencias_30d: z.number().nullable().optional(),
      })
      .parse(req.body);
    res.json(await calcularPrioridad(vars));
  }),
);
