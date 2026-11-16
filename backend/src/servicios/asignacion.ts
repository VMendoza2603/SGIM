import type pg from 'pg';

/**
 * Asignación automática (propuesta 3.1, punto 6): técnico activo y disponible, con cupo libre,
 * que atienda la categoría (prefiere la especialidad principal) y cubra el bloque; desempata por menor carga.
 * Devuelve null si nadie cumple: el incidente queda Pendiente para el coordinador.
 */
export async function elegirTecnico(db: pg.PoolClient, idCategoria: number | null, idUbicacion: number | null) {
  if (!idCategoria) return null;
  const { rows } = await db.query(
    `SELECT c.id_tecnico, c.activos, tc.es_principal
       FROM v_carga_tecnico c
       JOIN tecnico_categoria tc ON tc.id_tecnico = c.id_tecnico AND tc.id_categoria = $1
      WHERE c.disponible AND c.cupo_libre > 0
        AND ($2::int IS NULL OR NOT EXISTS (SELECT 1 FROM tecnico_bloque tb WHERE tb.id_tecnico = c.id_tecnico)
             OR EXISTS (SELECT 1 FROM tecnico_bloque tb JOIN ubicacion u ON u.id_bloque = tb.id_bloque
                         WHERE tb.id_tecnico = c.id_tecnico AND u.id_ubicacion = $2))
      ORDER BY tc.es_principal DESC, c.activos ASC, c.id_tecnico
      LIMIT 1`,
    [idCategoria, idUbicacion],
  );
  return rows[0] ? { idTecnico: rows[0].id_tecnico as number, principal: rows[0].es_principal as boolean } : null;
}

/**
 * Avisa al técnico líder (si hay uno) que entró un reporte: recibe la asignación que hizo el sistema
 * y puede cambiar el técnico desde WhatsApp. No se avisa si el líder es el mismo técnico asignado
 * (ese aviso ya le llega con el formato de líder).
 */
export async function avisarLider(db: pg.PoolClient, inc: { id_incidente: number; codigo: string; titulo: string }, idTecnicoAsignado: number | null) {
  await db.query(
    `INSERT INTO notificacion (id_incidente, id_destinatario, canal, evento, titulo, cuerpo)
     SELECT $1, t.id_usuario, 'WHATSAPP', 'ASIGNACION', 'Nuevo reporte para revisar', $2
       FROM tecnico t JOIN usuario u USING (id_usuario)
      WHERE t.es_lider AND u.activo AND t.id_tecnico IS DISTINCT FROM $3`,
    [inc.id_incidente, `${inc.codigo} · ${inc.titulo}`, idTecnicoAsignado],
  );
}

/**
 * Registra la asignación, mueve el incidente a ASIGNADO y deja en cola los avisos de WhatsApp:
 * un aviso informativo al técnico asignado y, salvo que reasigne el propio líder, otro al técnico líder.
 */
export async function asignar(
  db: pg.PoolClient,
  inc: { id_incidente: number; codigo: string; titulo: string },
  idTecnico: number,
  opciones: { automatica: boolean; motivo: string; idAsignadoPor?: number | null; avisarLider?: boolean },
) {
  await db.query(`UPDATE asignacion SET activa = FALSE, finalizada_en = now() WHERE id_incidente = $1 AND activa`, [inc.id_incidente]);
  await db.query(
    `INSERT INTO asignacion (id_incidente, id_tecnico, id_asignado_por, automatica, motivo) VALUES ($1, $2, $3, $4, $5)`,
    [inc.id_incidente, idTecnico, opciones.idAsignadoPor ?? null, opciones.automatica, opciones.motivo],
  );
  await db.query(
    `UPDATE incidente SET id_tecnico = $2, fecha_asignacion = COALESCE(fecha_asignacion, now()),
            id_estado = CASE WHEN id_estado = (SELECT id_estado FROM estado_incidente WHERE codigo='PENDIENTE')
                             THEN (SELECT id_estado FROM estado_incidente WHERE codigo='ASIGNADO') ELSE id_estado END
      WHERE id_incidente = $1`,
    [inc.id_incidente, idTecnico],
  );
  await db.query(
    `INSERT INTO notificacion (id_incidente, id_destinatario, canal, evento, titulo, cuerpo)
     SELECT $1, t.id_usuario, 'WHATSAPP', 'ASIGNACION', 'Nuevo incidente asignado', $2 FROM tecnico t WHERE t.id_tecnico = $3`,
    [inc.id_incidente, `${inc.codigo} · ${inc.titulo}`, idTecnico],
  );
  if (opciones.avisarLider !== false) await avisarLider(db, inc, idTecnico);
}
