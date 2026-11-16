import { Router } from 'express';
import { z } from 'zod';
import { requierePermiso } from '../auth.js';
import { query, queryOne } from '../db.js';
import { HttpError, ruta } from '../errores.js';
import { resumenTecnicos } from '../servicios/desempeno.js';

export const reportesRouter = Router();
reportesRouter.use(requierePermiso('reporte.ver'));

/**
 * A12 · Cada reporte es una consulta parametrizada por rango de fechas ($1 desde, $2 hasta inclusive).
 * `filas` alimenta la tabla y el gráfico; `resumen` (opcional) alimenta las tarjetas de arriba.
 * Los nombres de columna, el formato y el gráfico de cada reporte se definen en el frontend (Reportes.tsx).
 */
interface Reporte {
  titulo: string;
  filas: (desde: string, hasta: string) => Promise<unknown[]>;
  resumen?: (desde: string, hasta: string) => Promise<unknown>;
}
const consulta = (sql: string) => (desde: string, hasta: string) => query(sql, [desde, hasta]);
const unaFila = (sql: string) => (desde: string, hasta: string) => queryOne(sql, [desde, hasta]);
const PERIODO = `i.fecha_reporte >= $1 AND i.fecha_reporte < $2::date + 1`;

export const REPORTES: Record<string, Reporte> = {
  'categoria-prioridad': {
    titulo: 'Incidentes por categoría y prioridad',
    filas: consulta(
      `SELECT COALESCE(c.nombre, 'Sin categoría') AS categoria,
              count(*) FILTER (WHERE p.codigo = 'ALTA')::int AS alta,
              count(*) FILTER (WHERE p.codigo = 'MEDIA')::int AS media,
              count(*) FILTER (WHERE p.codigo = 'BAJA')::int AS baja,
              count(*) FILTER (WHERE e.es_final)::int AS cerrados,
              count(*)::int AS total
         FROM incidente i LEFT JOIN categoria c USING (id_categoria) LEFT JOIN prioridad p USING (id_prioridad)
         JOIN estado_incidente e ON e.id_estado = i.id_estado
        WHERE ${PERIODO}
        GROUP BY 1 ORDER BY total DESC`,
    ),
    resumen: unaFila(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE p.codigo = 'ALTA')::int AS alta,
              count(*) FILTER (WHERE NOT e.es_final)::int AS abiertos,
              mode() WITHIN GROUP (ORDER BY c.nombre) AS categoria_frecuente
         FROM incidente i LEFT JOIN categoria c USING (id_categoria) LEFT JOIN prioridad p USING (id_prioridad)
         JOIN estado_incidente e ON e.id_estado = i.id_estado
        WHERE ${PERIODO}`,
    ),
  },
  sla: {
    titulo: 'Cumplimiento de tiempos (SLA)',
    filas: consulta(
      `SELECT p.nombre AS prioridad, p.horas_solucion AS plazo_horas, count(i.*)::int AS incidentes,
              count(i.*) FILTER (WHERE COALESCE(i.fecha_resolucion, now()) <= i.fecha_limite)::int AS a_tiempo,
              count(i.*) FILTER (WHERE COALESCE(i.fecha_resolucion, now()) > i.fecha_limite)::int AS fuera_plazo,
              round(100.0 * count(i.*) FILTER (WHERE COALESCE(i.fecha_resolucion, now()) <= i.fecha_limite) / NULLIF(count(i.*), 0))::int AS porcentaje
         FROM prioridad p LEFT JOIN incidente i ON i.id_prioridad = p.id_prioridad AND ${PERIODO}
        GROUP BY p.id_prioridad ORDER BY p.nivel DESC`,
    ),
    resumen: unaFila(
      `SELECT count(*)::int AS incidentes,
              round(100.0 * count(*) FILTER (WHERE COALESCE(i.fecha_resolucion, now()) <= i.fecha_limite) / NULLIF(count(*), 0))::int AS porcentaje,
              count(*) FILTER (WHERE COALESCE(i.fecha_resolucion, now()) > i.fecha_limite)::int AS fuera_plazo,
              round(avg(EXTRACT(EPOCH FROM (i.fecha_resolucion - i.fecha_reporte)) / 3600)::numeric, 1)::float AS horas_promedio
         FROM incidente i WHERE ${PERIODO}`,
    ),
  },
  tecnicos: {
    titulo: 'Desempeño por técnico',
    filas: async (desde, hasta) =>
      (await resumenTecnicos(desde, hasta))
        .filter((t) => t.activo)
        .map((t) => ({
          id_tecnico: t.id_tecnico,
          tecnico: t.tecnico,
          activos: t.por_iniciar + t.en_proceso + t.en_verificacion,
          resueltos: t.resueltos,
          a_tiempo: t.a_tiempo,
          fuera_plazo: t.fuera_plazo,
          reasignados: t.reasignados,
          horas_promedio: t.horas_promedio,
          calificacion: t.calificacion,
          calificaciones: t.calificaciones,
        })),
    resumen: async (desde, hasta) => {
      const filas = (await resumenTecnicos(desde, hasta)).filter((t) => t.activo);
      const resueltos = filas.reduce((s, t) => s + t.resueltos, 0);
      const aTiempo = filas.reduce((s, t) => s + t.a_tiempo, 0);
      const notas = await queryOne(
        `SELECT round(avg(calificacion)::numeric, 1)::float AS calificacion, count(calificacion)::int AS calificaciones
           FROM incidente WHERE fecha_resolucion >= $1 AND fecha_resolucion < $2::date + 1`,
        [desde, hasta],
      );
      return {
        tecnicos: filas.length,
        resueltos,
        porcentaje_a_tiempo: resueltos ? Math.round((100 * aTiempo) / resueltos) : null,
        calificacion: notas?.calificacion ?? null,
        calificaciones: notas?.calificaciones ?? 0,
      };
    },
  },
  ubicaciones: {
    titulo: 'Ubicaciones con más fallas',
    filas: consulta(
      `SELECT u.codigo, u.nombre AS ubicacion, count(*)::int AS incidentes,
              count(*) FILTER (WHERE NOT e.es_final)::int AS abiertos, max(i.fecha_reporte)::date AS ultimo,
              mode() WITHIN GROUP (ORDER BY c.nombre) AS categoria_frecuente
         FROM incidente i JOIN ubicacion u USING (id_ubicacion) LEFT JOIN categoria c ON c.id_categoria = i.id_categoria
         JOIN estado_incidente e ON e.id_estado = i.id_estado
        WHERE ${PERIODO}
        GROUP BY u.id_ubicacion ORDER BY incidentes DESC LIMIT 10`,
    ),
    resumen: unaFila(
      `SELECT count(DISTINCT i.id_ubicacion)::int AS ubicaciones, count(*)::int AS incidentes,
              count(*) FILTER (WHERE i.id_ubicacion IS NULL)::int AS sin_ubicacion
         FROM incidente i WHERE ${PERIODO}`,
    ),
  },
  ia: {
    titulo: 'Precisión del agente IA',
    filas: consulta(
      `SELECT COALESCE(c.nombre, 'Sin categoría') AS categoria, count(*)::int AS analizados,
              count(*) FILTER (WHERE NOT i.categoria_manual)::int AS categoria_correcta,
              round(100.0 * count(*) FILTER (WHERE NOT i.categoria_manual) / NULLIF(count(*), 0))::int AS pct_categoria,
              count(*) FILTER (WHERE NOT i.prioridad_manual)::int AS prioridad_sin_correccion
         FROM incidente i LEFT JOIN categoria c ON c.id_categoria = i.id_categoria
        WHERE EXISTS (SELECT 1 FROM analisis_ia a WHERE a.id_incidente = i.id_incidente) AND ${PERIODO}
        GROUP BY 1 ORDER BY analizados DESC`,
    ),
    resumen: unaFila(
      `SELECT count(*)::int AS analizados,
              round(100.0 * count(*) FILTER (WHERE NOT i.categoria_manual) / NULLIF(count(*), 0))::int AS pct_categoria,
              round(100.0 * count(*) FILTER (WHERE NOT i.prioridad_manual) / NULLIF(count(*), 0))::int AS pct_prioridad,
              (SELECT round(avg(a.confianza)::numeric * 100)::int FROM analisis_ia a JOIN incidente x ON x.id_incidente = a.id_incidente
                WHERE a.tipo IN ('TEXTO','IMAGEN') AND x.fecha_reporte >= $1 AND x.fecha_reporte < $2::date + 1) AS confianza_media
         FROM incidente i
        WHERE EXISTS (SELECT 1 FROM analisis_ia a WHERE a.id_incidente = i.id_incidente) AND ${PERIODO}`,
    ),
  },
  satisfaccion: {
    titulo: 'Satisfacción de los reportantes',
    filas: consulta(
      `SELECT COALESCE(c.nombre, 'Sin categoría') AS categoria, count(i.calificacion)::int AS calificaciones,
              round(avg(i.calificacion)::numeric, 1)::float AS promedio,
              count(*) FILTER (WHERE i.calificacion >= 4)::int AS satisfechos,
              count(*) FILTER (WHERE i.calificacion <= 2)::int AS insatisfechos
         FROM incidente i LEFT JOIN categoria c USING (id_categoria)
        WHERE i.calificacion IS NOT NULL AND ${PERIODO}
        GROUP BY c.nombre ORDER BY promedio DESC NULLS LAST`,
    ),
    resumen: unaFila(
      `SELECT count(i.calificacion)::int AS calificaciones, round(avg(i.calificacion)::numeric, 1)::float AS promedio,
              round(100.0 * count(*) FILTER (WHERE i.calificacion >= 4) / NULLIF(count(i.calificacion), 0))::int AS pct_satisfechos,
              count(*) FILTER (WHERE e.codigo = 'RESUELTO' AND i.calificacion IS NULL)::int AS sin_calificar
         FROM incidente i JOIN estado_incidente e ON e.id_estado = i.id_estado
        WHERE ${PERIODO}`,
    ),
  },
};

reportesRouter.get('/', (_req, res) => res.json(Object.entries(REPORTES).map(([id, r]) => ({ id, titulo: r.titulo }))));

reportesRouter.get(
  '/:id',
  ruta(async (req, res) => {
    const rep = REPORTES[req.params.id];
    if (!rep) throw new HttpError(404, 'Reporte no encontrado');
    const { desde, hasta } = z.object({ desde: z.string().date(), hasta: z.string().date() }).parse(req.query);
    const [filas, resumen] = await Promise.all([rep.filas(desde, hasta), rep.resumen?.(desde, hasta) ?? null]);
    res.json({ titulo: rep.titulo, desde, hasta, filas, resumen });
  }),
);
