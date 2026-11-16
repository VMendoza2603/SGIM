import { query, queryOne } from '../db.js';

/**
 * Desempeño de los técnicos en un periodo [desde, hasta] (fechas YYYY-MM-DD, hasta inclusive).
 * Lo usan la pantalla Técnicos (A08) y su detalle, el resumen del Dashboard (A01) y el reporte "Desempeño por técnico" (A12).
 *  - Pendientes (por iniciar, en proceso, en verificación, fuera de plazo): estado actual, sin importar el periodo.
 *  - Resueltos, a tiempo, horas promedio y calificación: incidentes resueltos dentro del periodo.
 *  - Reasignados: asignaciones del periodo que el técnico tuvo y pasaron a otro técnico.
 */
const SQL_RESUMEN = `
  SELECT t.id_tecnico, u.nombres || ' ' || u.apellidos AS tecnico, t.es_lider, t.disponible, t.max_activos, u.activo,
         count(i.*) FILTER (WHERE e.codigo = 'ASIGNADO')::int        AS por_iniciar,
         count(i.*) FILTER (WHERE e.codigo = 'EN_PROCESO')::int      AS en_proceso,
         count(i.*) FILTER (WHERE e.codigo = 'EN_VERIFICACION')::int AS en_verificacion,
         count(i.*) FILTER (WHERE e.codigo IN ('ASIGNADO','EN_PROCESO') AND i.fecha_limite < now())::int AS fuera_plazo,
         count(i.*) FILTER (WHERE e.codigo = 'RESUELTO' AND i.fecha_resolucion >= $1 AND i.fecha_resolucion < $2::date + 1)::int AS resueltos,
         count(i.*) FILTER (WHERE e.codigo = 'RESUELTO' AND i.fecha_resolucion >= $1 AND i.fecha_resolucion < $2::date + 1
                              AND i.fecha_resolucion <= i.fecha_limite)::int AS a_tiempo,
         round((avg(EXTRACT(EPOCH FROM (i.fecha_resolucion - COALESCE(i.fecha_asignacion, i.fecha_reporte))) / 3600)
                FILTER (WHERE i.fecha_resolucion >= $1 AND i.fecha_resolucion < $2::date + 1))::numeric, 1)::float AS horas_promedio,
         round((avg(i.calificacion) FILTER (WHERE i.fecha_resolucion >= $1 AND i.fecha_resolucion < $2::date + 1))::numeric, 1)::float AS calificacion,
         count(i.calificacion) FILTER (WHERE i.fecha_resolucion >= $1 AND i.fecha_resolucion < $2::date + 1)::int AS calificaciones,
         (SELECT count(*)::int FROM asignacion a JOIN incidente x ON x.id_incidente = a.id_incidente
           WHERE a.id_tecnico = t.id_tecnico AND NOT a.activa AND x.id_tecnico IS DISTINCT FROM t.id_tecnico
             AND a.asignado_en >= $1 AND a.asignado_en < $2::date + 1) AS reasignados,
         greatest(max(i.fecha_inicio_atencion), max(i.fecha_resolucion)) AS ultima_actividad
    FROM tecnico t JOIN usuario u ON u.id_usuario = t.id_usuario
    LEFT JOIN incidente i ON i.id_tecnico = t.id_tecnico
    LEFT JOIN estado_incidente e ON e.id_estado = i.id_estado
   WHERE ($3::int IS NULL OR t.id_tecnico = $3)
   GROUP BY t.id_tecnico, u.nombres, u.apellidos, u.activo
   ORDER BY u.activo DESC, t.es_lider DESC, u.nombres`;

export const resumenTecnicos = (desde: string, hasta: string) => query(SQL_RESUMEN, [desde, hasta, null]);

/** Detalle de un técnico: datos, indicadores del periodo y sus incidentes (actuales, del periodo y reasignados). */
export async function detalleTecnico(idTecnico: number, desde: string, hasta: string) {
  const datos = await queryOne(
    `SELECT t.id_tecnico, t.turno, t.max_activos, t.disponible, t.es_lider, u.nombres, u.apellidos, u.telefono_wa, u.correo, u.activo,
            u.ultimo_acceso,
            COALESCE((SELECT json_agg(json_build_object('nombre', ca.nombre, 'principal', tc.es_principal) ORDER BY tc.es_principal DESC, ca.nombre)
                        FROM tecnico_categoria tc JOIN categoria ca ON ca.id_categoria = tc.id_categoria WHERE tc.id_tecnico = t.id_tecnico), '[]') AS especialidades,
            COALESCE((SELECT string_agg(b.codigo, ', ' ORDER BY b.codigo) FROM tecnico_bloque tb JOIN bloque b ON b.id_bloque = tb.id_bloque
                       WHERE tb.id_tecnico = t.id_tecnico), 'Todas') AS zonas
       FROM tecnico t JOIN usuario u ON u.id_usuario = t.id_usuario WHERE t.id_tecnico = $1`,
    [idTecnico],
  );
  if (!datos) return null;
  const [indicadores] = await query(SQL_RESUMEN, [desde, hasta, idTecnico]);
  const incidentes = await query(
    `SELECT i.codigo, i.titulo, e.codigo AS estado, p.nombre AS prioridad, c.nombre AS categoria,
            COALESCE(ub.codigo || ' · ' || ub.nombre, i.ubicacion_texto) AS lugar,
            i.fecha_reporte, i.fecha_inicio_atencion, i.fecha_resolucion, i.fecha_cierre, i.fecha_limite, i.calificacion,
            (i.id_tecnico = $1) AS actual,
            a.asignado_en, a.automatica, ua.nombres || ' ' || ua.apellidos AS asignado_por,
            ut.nombres || ' ' || ut.apellidos AS tecnico_actual
       FROM incidente i
       JOIN estado_incidente e ON e.id_estado = i.id_estado
       LEFT JOIN prioridad p ON p.id_prioridad = i.id_prioridad
       LEFT JOIN categoria c ON c.id_categoria = i.id_categoria
       LEFT JOIN ubicacion ub ON ub.id_ubicacion = i.id_ubicacion
       LEFT JOIN tecnico tt ON tt.id_tecnico = i.id_tecnico
       LEFT JOIN usuario ut ON ut.id_usuario = tt.id_usuario
       LEFT JOIN LATERAL (SELECT * FROM asignacion ax WHERE ax.id_incidente = i.id_incidente AND ax.id_tecnico = $1
                           ORDER BY ax.asignado_en DESC LIMIT 1) a ON TRUE
       LEFT JOIN usuario ua ON ua.id_usuario = a.id_asignado_por
      WHERE (i.id_tecnico = $1 AND (NOT e.es_final OR COALESCE(i.fecha_resolucion, i.fecha_cierre, i.fecha_reporte) >= $2))
         OR (i.id_tecnico IS DISTINCT FROM $1 AND a.asignado_en >= $2 AND a.asignado_en < $3::date + 1)
      ORDER BY COALESCE(a.asignado_en, i.fecha_reporte) DESC
      LIMIT 300`,
    [idTecnico, desde, hasta],
  );
  return { ...datos, indicadores, incidentes };
}
