import { Router } from 'express';
import { z } from 'zod';
import { requierePermiso } from '../auth.js';
import { query, queryOne } from '../db.js';
import { ruta } from '../errores.js';

export const historialRouter = Router();

/** A05 / T03 · Historial por ubicación y equipo, con alerta de mantenimiento preventivo. */
historialRouter.get(
  '/',
  requierePermiso('historial.ver'),
  ruta(async (req, res) => {
    const f = z
      .object({
        bloque: z.coerce.number().int().optional(),
        ubicacion: z.coerce.number().int().optional(),
        equipo: z.coerce.number().int().optional(),
        meses: z.coerce.number().int().min(1).max(60).default(12),
        tecnico: z.coerce.number().int().optional(),
      })
      .parse(req.query);

    const params: unknown[] = [f.meses];
    const where = [`i.fecha_reporte > now() - make_interval(months => $1)`];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (f.equipo) add('i.id_equipo = ?', f.equipo);
    else if (f.ubicacion) add('i.id_ubicacion = ?', f.ubicacion);
    else if (f.bloque) add('u.id_bloque = ?', f.bloque);
    // Técnico: los incidentes que tiene o tuvo asignados (también los que se le reasignaron a otro)
    if (f.tecnico) add('(i.id_tecnico = ? OR EXISTS (SELECT 1 FROM asignacion ax WHERE ax.id_incidente = i.id_incidente AND ax.id_tecnico = ?))', f.tecnico);
    const filtro = where.join(' AND ');

    const resumen = await queryOne(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE i.fecha_reporte > now() - interval '90 days')::int AS ultimos_90,
              round(avg(EXTRACT(EPOCH FROM (i.fecha_resolucion - i.fecha_reporte)) / 3600))::int AS horas_promedio,
              mode() WITHIN GROUP (ORDER BY c.nombre) AS categoria_frecuente
         FROM incidente i LEFT JOIN ubicacion u ON u.id_ubicacion = i.id_ubicacion
         LEFT JOIN categoria c ON c.id_categoria = i.id_categoria
        WHERE ${filtro}`,
      params,
    );

    // Equipos de la selección (con o sin incidentes) + incidentes sin equipo agrupados
    const equipos = await query(
      `SELECT eq.id_equipo, eq.codigo_inventario, te.nombre AS tipo, eq.estado AS estado_equipo, eq.ultimo_mantenimiento,
              te.frecuencia_preventivo_dias,
              count(i.id_incidente)::int AS incidentes,
              count(i.id_incidente) FILTER (WHERE i.fecha_reporte > now() - interval '90 days')::int AS ultimos_90,
              max(i.fecha_reporte) AS ultimo,
              (SELECT e.codigo FROM incidente x JOIN estado_incidente e ON e.id_estado = x.id_estado
                WHERE x.id_equipo = eq.id_equipo ORDER BY x.fecha_reporte DESC LIMIT 1) AS ultimo_estado
         FROM equipo eq
         JOIN tipo_equipo te ON te.id_tipo_equipo = eq.id_tipo_equipo
         JOIN ubicacion u ON u.id_ubicacion = eq.id_ubicacion
         LEFT JOIN incidente i ON i.id_equipo = eq.id_equipo AND i.fecha_reporte > now() - make_interval(months => $1)
        WHERE eq.activo
          AND ($2::int IS NULL OR eq.id_equipo = $2)
          AND ($3::int IS NULL OR eq.id_ubicacion = $3)
          AND ($4::int IS NULL OR u.id_bloque = $4)
        GROUP BY eq.id_equipo, te.nombre, te.frecuencia_preventivo_dias
        ORDER BY count(i.id_incidente) DESC, eq.codigo_inventario`,
      [f.meses, f.equipo ?? null, f.equipo ? null : (f.ubicacion ?? null), f.equipo || f.ubicacion ? null : (f.bloque ?? null)],
    );
    const sinEquipo = f.equipo
      ? null
      : await queryOne(
          `SELECT count(*)::int AS incidentes,
                  count(*) FILTER (WHERE i.fecha_reporte > now() - interval '90 days')::int AS ultimos_90,
                  max(i.fecha_reporte) AS ultimo
             FROM incidente i LEFT JOIN ubicacion u ON u.id_ubicacion = i.id_ubicacion
            WHERE ${filtro} AND i.id_equipo IS NULL`,
          params,
        );

    // Alertas: 3+ fallas en 90 días o preventivo vencido según la frecuencia del tipo de equipo
    const alertas = equipos
      .filter((e) => {
        const vencido = e.frecuencia_preventivo_dias && e.ultimo_mantenimiento
          && (Date.now() - new Date(e.ultimo_mantenimiento).getTime()) / 86400000 > e.frecuencia_preventivo_dias;
        return e.ultimos_90 >= 3 || vencido;
      })
      .map((e) => ({
        codigo: e.codigo_inventario,
        fallas90: e.ultimos_90,
        frecuencia: e.frecuencia_preventivo_dias,
        diasDesdeMantenimiento: e.ultimo_mantenimiento ? Math.floor((Date.now() - new Date(e.ultimo_mantenimiento).getTime()) / 86400000) : null,
      }));

    const incidentes = await query(
      `SELECT i.codigo, i.titulo, i.fecha_reporte, i.fecha_resolucion, e.codigo AS estado, e.nombre AS estado_nombre,
              eq.codigo_inventario AS equipo,
              (SELECT a.descripcion FROM accion_mantenimiento a WHERE a.id_incidente = i.id_incidente AND a.tipo <> 'DIAGNOSTICO'
                ORDER BY a.creado_en DESC LIMIT 1) AS accion,
              ut.nombres || ' ' || left(ut.apellidos, 1) || '.' AS tecnico
         FROM incidente i
         JOIN estado_incidente e ON e.id_estado = i.id_estado
         LEFT JOIN ubicacion u ON u.id_ubicacion = i.id_ubicacion
         LEFT JOIN equipo eq ON eq.id_equipo = i.id_equipo
         LEFT JOIN tecnico t ON t.id_tecnico = i.id_tecnico
         LEFT JOIN usuario ut ON ut.id_usuario = t.id_usuario
        WHERE ${filtro}
        ORDER BY COALESCE(i.fecha_resolucion, i.fecha_reporte) DESC LIMIT 100`, // primero lo último realizado
      params,
    );

    res.json({ resumen, equipos, sinEquipo, alertas, incidentes });
  }),
);
