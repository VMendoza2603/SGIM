import { queryOne, transaccion } from '../db.js';
import { analizarCierre, guardarAnalisis, parametroNumero } from './ia.js';

/**
 * Verificación de cierre con IA (fase 6). Cada foto de CIERRE crea una fila en verificacion_cierre;
 * el agente la compara con la foto del reporte y deja su resultado. El incidente se cierra solo cuando
 * la IA aprueba (confianza ≥ verificacion.umbral_ia) **y** el reportante confirma; si no, decide el coordinador.
 */

/** Analiza la foto de cierre de una verificación. Pensado para llamarse sin esperar (no bloquea al técnico). */
export async function verificarCierreConIa(idVerificacion: number) {
  try {
    const v = await queryOne(
      `SELECT v.id_verificacion, v.id_incidente, i.descripcion, e.url_archivo AS url, e.mime_type AS mime,
              (SELECT json_build_object('url', r.url_archivo, 'mime', r.mime_type) FROM evidencia r
                WHERE r.id_incidente = v.id_incidente AND r.tipo = 'REPORTE' ORDER BY r.creado_en LIMIT 1) AS antes
         FROM verificacion_cierre v
         JOIN incidente i ON i.id_incidente = v.id_incidente
         JOIN evidencia e ON e.id_evidencia = v.id_evidencia
        WHERE v.id_verificacion = $1`,
      [idVerificacion],
    );
    if (!v) return;
    const a = await analizarCierre(v.descripcion, v.antes, { url: v.url, mime: v.mime });
    if (!a) return; // sin IA: la verificación queda PENDIENTE y decide el coordinador
    const umbral = await parametroNumero('verificacion.umbral_ia', 0.8);
    // Solo se aprueba o rechaza con seguridad suficiente; si duda, queda pendiente para el coordinador.
    const resultado = a.confianza >= umbral ? (a.solucionado ? 'APROBADA' : 'RECHAZADA') : 'PENDIENTE';
    const idAnalisis = await guardarAnalisis(null, v.id_incidente, null, a);
    await queryOne(`UPDATE verificacion_cierre SET resultado_ia = $2, confianza_ia = $3, id_analisis = $4 WHERE id_verificacion = $1`, [
      idVerificacion,
      resultado,
      a.confianza.toFixed(3),
      idAnalisis,
    ]);
    await cierreAutomatico(v.id_incidente, true);
  } catch (e) {
    console.warn('[verificacion] No se pudo verificar el cierre con IA:', (e as Error).message);
  }
}

/**
 * Cierra el incidente si se cumplen las dos condiciones (IA aprobó y el reportante confirmó).
 * Lo hace el SISTEMA: el historial queda con canal SISTEMA y sin usuario. Devuelve true si lo cerró.
 * `avisar` deja en cola el aviso al reportante (no hace falta si él mismo acaba de confirmar por chat).
 */
export async function cierreAutomatico(idIncidente: number, avisar: boolean) {
  const umbral = await parametroNumero('verificacion.umbral_ia', 0.8);
  const listo = await queryOne(
    `SELECT v.id_verificacion FROM incidente i
       JOIN estado_incidente e ON e.id_estado = i.id_estado AND e.codigo = 'EN_VERIFICACION'
       JOIN LATERAL (SELECT * FROM verificacion_cierre WHERE id_incidente = i.id_incidente ORDER BY creado_en DESC LIMIT 1) v ON TRUE
      WHERE i.id_incidente = $1 AND v.resultado_final = 'PENDIENTE' AND v.confirmacion_reportante
        AND v.resultado_ia = 'APROBADA' AND v.confianza_ia >= $2`,
    [idIncidente, umbral],
  );
  if (!listo) return false;
  await transaccion(null, async (c) => {
    await c.query(`SELECT set_config('sgim.canal', 'SISTEMA', true),
                          set_config('sgim.comentario', 'Cierre automático: la IA aprobó la foto y el reportante confirmó', true)`);
    await c.query(
      `UPDATE incidente SET id_estado = (SELECT id_estado FROM estado_incidente WHERE codigo = 'RESUELTO'), fecha_cierre = now()
        WHERE id_incidente = $1`,
      [idIncidente],
    );
    await c.query(
      `UPDATE verificacion_cierre SET resultado_final = 'APROBADA', verificado_en = now(), observacion = 'Cierre automático (IA + reportante)'
        WHERE id_verificacion = $1`,
      [listo.id_verificacion],
    );
    if (avisar) {
      await c.query(
        `INSERT INTO notificacion (id_incidente, id_destinatario, canal, evento, titulo, cuerpo)
         SELECT $1, i.id_reportante, 'WHATSAPP', 'CAMBIO_ESTADO', 'Tu reporte cambió de estado', e.visible_usuario
           FROM incidente i JOIN estado_incidente e ON e.id_estado = i.id_estado WHERE i.id_incidente = $1`,
        [idIncidente],
      );
    }
  });
  return true;
}
