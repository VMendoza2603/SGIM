import { Router } from 'express';
import { requierePermiso, tiene } from '../auth.js';
import { query, queryOne } from '../db.js';
import { ruta } from '../errores.js';
import { resumenTecnicos } from '../servicios/desempeno.js';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/',
  requierePermiso('dashboard.ver_general', 'dashboard.ver_propio'),
  ruta(async (req, res) => {
    if (tiene(req, 'dashboard.ver_general')) {
      const [kpi, revisionManual, tecnicosActivos, vencidoCodigo, porCategoria, carga, precision, mesAnterior] = await Promise.all([
        queryOne(`SELECT * FROM v_kpi_dashboard`),
        queryOne<{ n: number }>(
          `SELECT count(*)::int n FROM incidente i JOIN estado_incidente e ON e.id_estado = i.id_estado
            WHERE e.codigo = 'PENDIENTE' AND i.id_ubicacion IS NULL`,
        ),
        queryOne<{ n: number }>(
          `SELECT count(DISTINCT i.id_tecnico)::int n FROM incidente i JOIN estado_incidente e ON e.id_estado = i.id_estado
            WHERE e.codigo IN ('ASIGNADO','EN_PROCESO')`,
        ),
        queryOne<{ codigo: string }>(
          `SELECT i.codigo FROM incidente i JOIN estado_incidente e ON e.id_estado = i.id_estado
            WHERE i.fecha_limite < now() AND NOT e.es_final ORDER BY i.fecha_limite LIMIT 1`,
        ),
        query(
          `SELECT c.nombre, count(i.id_incidente)::int AS total
             FROM categoria c LEFT JOIN incidente i ON i.id_categoria = c.id_categoria
                  AND i.fecha_reporte >= date_trunc('month', now())
            GROUP BY c.nombre ORDER BY total DESC, c.nombre`,
        ),
        query(`SELECT * FROM v_carga_tecnico ORDER BY tecnico`),
        queryOne(
          `SELECT round(100.0 * count(*) FILTER (WHERE NOT categoria_manual) / NULLIF(count(*),0))::int AS categoria,
                  round(100.0 * count(*) FILTER (WHERE NOT prioridad_manual) / NULLIF(count(*),0))::int AS prioridad
             FROM incidente i WHERE EXISTS (SELECT 1 FROM analisis_ia a WHERE a.id_incidente = i.id_incidente)`,
        ),
        queryOne(
          `SELECT avg(EXTRACT(EPOCH FROM (fecha_resolucion - fecha_reporte))/3600)::numeric(8,1) AS horas
             FROM incidente WHERE fecha_resolucion >= date_trunc('month', now()) - interval '1 month'
                              AND fecha_resolucion <  date_trunc('month', now())`,
        ),
      ]);
      // Resumen por técnico del mes en curso (sección inferior del Dashboard)
      const hoy = new Date();
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const tecnicos = await resumenTecnicos(iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), iso(hoy));
      return res.json({
        tipo: 'general',
        tecnicos: tecnicos.filter((t) => t.activo),
        kpi: { ...kpi, revision_manual: revisionManual?.n ?? 0, tecnicos_activos: tecnicosActivos?.n ?? 0, primer_vencido: vencidoCodigo?.codigo ?? null, horas_mes_anterior: mesAnterior?.horas ?? null },
        porCategoria,
        carga,
        precision,
      });
    }
    const idTecnico = req.usuario!.idTecnico ?? -1;
    const resumen = await queryOne(
      `SELECT count(*) FILTER (WHERE e.codigo = 'ASIGNADO')::int        AS por_iniciar,
              count(*) FILTER (WHERE e.codigo = 'EN_PROCESO')::int      AS en_proceso,
              count(*) FILTER (WHERE e.codigo = 'EN_VERIFICACION')::int AS en_verificacion,
              count(*) FILTER (WHERE e.codigo = 'RESUELTO' AND i.fecha_cierre >= date_trunc('month', now()))::int AS resueltos_mes
         FROM incidente i JOIN estado_incidente e ON e.id_estado = i.id_estado WHERE i.id_tecnico = $1`,
      [idTecnico],
    );
    res.json({ tipo: 'propio', resumen });
  }),
);
