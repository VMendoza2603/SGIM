import { Router } from 'express';
import { requierePermiso } from '../auth.js';
import { query } from '../db.js';
import { ruta } from '../errores.js';

export const verificacionesRouter = Router();

/** A04 · Incidentes en verificación con las fotos de antes y después, el resultado de la IA y la confirmación del reportante. */
verificacionesRouter.get(
  '/',
  requierePermiso('incidente.verificar_cierre'),
  ruta(async (_req, res) => {
    const filas = await query(
      `SELECT i.id_incidente, i.codigo, i.titulo, i.fecha_resolucion, i.calificacion,
              u.codigo AS ubicacion_codigo, u.nombre AS ubicacion,
              ut.nombres || ' ' || ut.apellidos AS tecnico,
              r.nombres || ' ' || r.apellidos AS reportante,
              (SELECT json_build_object('url', e.url_archivo, 'descripcion', e.descripcion) FROM evidencia e
                WHERE e.id_incidente = i.id_incidente AND e.tipo = 'REPORTE' ORDER BY e.creado_en LIMIT 1) AS antes,
              (SELECT json_build_object('url', e.url_archivo, 'descripcion', e.descripcion) FROM evidencia e
                WHERE e.id_incidente = i.id_incidente AND e.tipo = 'CIERRE' ORDER BY e.creado_en DESC LIMIT 1) AS despues,
              (SELECT json_build_object('resultado', v.resultado_ia, 'confianza', v.confianza_ia, 'confirmacion', v.confirmacion_reportante)
                 FROM verificacion_cierre v WHERE v.id_incidente = i.id_incidente ORDER BY v.creado_en DESC LIMIT 1) AS verificacion,
              (SELECT a.interpretacion FROM analisis_ia a WHERE a.id_incidente = i.id_incidente AND a.tipo = 'VERIFICACION_CIERRE'
                ORDER BY a.creado_en DESC LIMIT 1) AS interpretacion_ia,
              (SELECT json_build_object('tipo', a.tipo, 'descripcion', a.descripcion) FROM accion_mantenimiento a
                WHERE a.id_incidente = i.id_incidente AND a.tipo <> 'DIAGNOSTICO' ORDER BY a.creado_en DESC LIMIT 1) AS accion
         FROM incidente i
         JOIN estado_incidente e ON e.id_estado = i.id_estado AND e.codigo = 'EN_VERIFICACION'
         JOIN usuario r ON r.id_usuario = i.id_reportante
         LEFT JOIN ubicacion u ON u.id_ubicacion = i.id_ubicacion
         LEFT JOIN tecnico t ON t.id_tecnico = i.id_tecnico
         LEFT JOIN usuario ut ON ut.id_usuario = t.id_usuario
        ORDER BY i.fecha_resolucion`,
    );
    res.json(filas);
  }),
);
