import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { put } from '@vercel/blob';
import type pg from 'pg';
import { HttpError, prohibido } from '../errores.js';
import { asignar, avisarLider, elegirTecnico } from './asignacion.js';
import { calcularPrioridad, variablesDeContexto } from './prioridad.js';

/**
 * Operaciones del incidente que comparten el panel web y el chatbot de WhatsApp,
 * para que ambos canales apliquen exactamente las mismas reglas.
 */

export const DIR_UPLOADS = path.resolve('uploads');
export const MIME_FOTO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

/**
 * Guarda una foto y devuelve su URL pública y su hash (para detectar fotos repetidas).
 *  - En Vercel (hay BLOB_READ_WRITE_TOKEN): en Vercel Blob, porque el disco de una función serverless no se conserva.
 *  - En local: en backend/uploads/, servida por Express en /uploads.
 */
export async function guardarFoto(buffer: Buffer, mime: string, prefijo: string) {
  const ext = MIME_FOTO[mime as keyof typeof MIME_FOTO];
  if (!ext) throw new HttpError(400, 'La foto debe ser JPG, PNG o WEBP');
  const nombre = `${prefijo}-${randomUUID()}.${ext}`;
  const hash = createHash('sha256').update(buffer).digest('hex');
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`sgim/${nombre}`, buffer, { access: 'public', contentType: mime });
    return { url: blob.url, hash, tamano: buffer.length };
  }
  await fs.mkdir(DIR_UPLOADS, { recursive: true });
  await fs.writeFile(path.join(DIR_UPLOADS, nombre), buffer);
  return { url: `/uploads/${nombre}`, hash, tamano: buffer.length };
}

export interface DatosIncidente {
  idReportante: number;
  canal: 'WEB' | 'WHATSAPP';
  idConversacion?: number | null;
  titulo: string;
  descripcion: string;
  idUbicacion: number | null;
  ubicacionTexto?: string | null;
  idEquipo?: number | null;
  idCategoria: number | null;
  riesgo_personas?: boolean;
  riesgo_electrico?: boolean;
  fuga_activa?: boolean;
  afecta_clases?: boolean;
  personas_afectadas?: number | null;
}

/**
 * Crea el incidente: calcula la prioridad con el motor de reglas, guarda qué reglas se aplicaron y,
 * si está activada la asignación automática y la ubicación es conocida, asigna al técnico.
 * Debe llamarse dentro de `transaccion(...)` para que los triggers registren quién lo creó.
 */
export async function crearIncidente(c: pg.PoolClient, d: DatosIncidente) {
  const { rows: cat } = await c.query(`SELECT codigo FROM categoria WHERE id_categoria = $1`, [d.idCategoria]);
  const contexto = await variablesDeContexto(d.idUbicacion, d.idEquipo ?? null, c);
  const prio = await calcularPrioridad(
    {
      categoria: cat[0]?.codigo,
      riesgo_personas: d.riesgo_personas ?? false,
      riesgo_electrico: d.riesgo_electrico ?? false,
      fuga_activa: d.fuga_activa ?? false,
      afecta_clases: d.afecta_clases ?? false,
      personas_afectadas: d.personas_afectadas ?? null,
      ...contexto,
    },
    c,
  );
  const { rows } = await c.query(
    `INSERT INTO incidente (id_reportante, id_conversacion, canal, titulo, descripcion, id_ubicacion, ubicacion_texto, id_equipo,
                            id_categoria, id_prioridad, id_estado, puntaje_prioridad, afecta_clases, personas_afectadas)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (SELECT id_estado FROM estado_incidente WHERE codigo = 'PENDIENTE'), $11, $12, $13)
     RETURNING id_incidente, codigo, titulo`,
    [
      d.idReportante, d.idConversacion ?? null, d.canal, d.titulo, d.descripcion, d.idUbicacion, d.ubicacionTexto ?? null,
      d.idEquipo ?? null, d.idCategoria, prio.idPrioridad, prio.puntaje, d.afecta_clases ?? false, d.personas_afectadas ?? null,
    ],
  );
  const inc = rows[0];
  for (const r of prio.reglas) {
    await c.query(`INSERT INTO incidente_regla (id_incidente, id_regla, puntos_aplicados) VALUES ($1, $2, $3)`, [inc.id_incidente, r.id_regla, r.puntos]);
  }

  // Sin ubicación reconocida no se asigna: queda en revisión manual para el coordinador.
  let tecnico: string | null = null;
  const { rows: auto } = await c.query(`SELECT valor FROM parametro_sistema WHERE clave = 'asignacion.automatica'`);
  if (auto[0]?.valor === 'true' && d.idUbicacion) {
    const t = await elegirTecnico(c, d.idCategoria, d.idUbicacion);
    if (t) {
      // La asignación automática la hace el sistema, no quien reporta: el historial la registra como SISTEMA
      // y el trigger de transiciones no la valida contra el rol del reportante.
      const { rows: prev } = await c.query(
        `SELECT current_setting('sgim.id_usuario', true) AS u, current_setting('sgim.id_rol', true) AS r,
                current_setting('sgim.canal', true) AS ca, current_setting('sgim.comentario', true) AS co`,
      );
      await c.query(`SELECT set_config('sgim.id_usuario', '', true), set_config('sgim.id_rol', '', true),
                            set_config('sgim.canal', 'SISTEMA', true), set_config('sgim.comentario', 'Asignación automática', true)`);
      await asignar(c, inc, t.idTecnico, { automatica: true, motivo: t.principal ? 'Menor carga en su especialidad principal' : 'Menor carga en la categoría' });
      await c.query(`SELECT set_config('sgim.id_usuario', $1, true), set_config('sgim.id_rol', $2, true),
                            set_config('sgim.canal', $3, true), set_config('sgim.comentario', $4, true)`, [
        prev[0].u ?? '', prev[0].r ?? '', prev[0].ca ?? '', prev[0].co ?? '',
      ]);
      const { rows: n } = await c.query(
        `SELECT u.nombres || ' ' || u.apellidos AS nombre FROM tecnico t JOIN usuario u USING (id_usuario) WHERE t.id_tecnico = $1`,
        [t.idTecnico],
      );
      tecnico = n[0]?.nombre ?? null;
    }
  }
  // Sin técnico disponible (o sin lugar reconocido): el líder igual se entera para asignarlo
  if (!tecnico) await avisarLider(c, inc, null);
  return { ...inc, prioridad: prio.prioridad as string, puntaje: prio.puntaje, tecnico };
}

export interface Actor {
  idUsuario: number;
  idRol: number;
  rol: string; // ADMIN, TECNICO, COMUNIDAD
}

/**
 * Cambia el estado según la máquina de estados (tabla transicion_estado): valida que el rol pueda hacerlo,
 * exige comentario o foto de cierre cuando corresponde, actualiza fechas y asignación, y deja en cola
 * los avisos de WhatsApp. Debe llamarse dentro de `transaccion(...)` con el mismo actor.
 */
export async function cambiarEstado(
  c: pg.PoolClient,
  inc: { id_incidente: number; estado: string; estado_nombre?: string },
  destino: string,
  actor: Actor,
  comentario?: string | null,
) {
  const { rows: tr } = await c.query(
    `SELECT te.requiere_evidencia, te.requiere_comentario, ed.id_estado
       FROM transicion_estado te
       JOIN estado_incidente eo ON eo.id_estado = te.id_estado_origen
       JOIN estado_incidente ed ON ed.id_estado = te.id_estado_destino
      WHERE eo.codigo = $1 AND ed.codigo = $2 AND te.id_rol = $3`,
    [inc.estado, destino, actor.idRol],
  );
  const t = tr[0];
  if (!t) throw prohibido(`No puedes cambiar de ${inc.estado_nombre ?? inc.estado} a ${destino}`);
  if (t.requiere_comentario && !comentario) throw new HttpError(400, 'Indica el motivo del cambio');
  if (t.requiere_evidencia) {
    const { rows: foto } = await c.query(`SELECT 1 FROM evidencia WHERE id_incidente = $1 AND tipo = 'CIERRE'`, [inc.id_incidente]);
    if (!foto.length) throw new HttpError(400, 'Sube al menos una foto de cierre antes de terminar');
  }

  const fechas: Record<string, string> = {
    EN_PROCESO: 'fecha_inicio_atencion = COALESCE(fecha_inicio_atencion, now())',
    EN_VERIFICACION: 'fecha_resolucion = now()',
    RESUELTO: 'fecha_cierre = now()',
    CANCELADO: 'fecha_cierre = now()',
  };
  // El técnico que rechaza la asignación devuelve el incidente a la cola
  const liberar = destino === 'PENDIENTE' ? ', id_tecnico = NULL' : '';
  await c.query(
    `UPDATE incidente SET id_estado = $2 ${fechas[destino] ? ', ' + fechas[destino] : ''} ${liberar} WHERE id_incidente = $1`,
    [inc.id_incidente, t.id_estado],
  );
  if (destino === 'PENDIENTE') {
    await c.query(`UPDATE asignacion SET activa = FALSE, finalizada_en = now() WHERE id_incidente = $1 AND activa`, [inc.id_incidente]);
  }
  if (destino === 'EN_PROCESO' && inc.estado === 'ASIGNADO') {
    await c.query(`UPDATE asignacion SET aceptada_en = now() WHERE id_incidente = $1 AND activa`, [inc.id_incidente]);
  }
  if (inc.estado === 'EN_VERIFICACION' && ['RESUELTO', 'EN_PROCESO'].includes(destino)) {
    const ultima = `(SELECT id_verificacion FROM verificacion_cierre WHERE id_incidente = $1 ORDER BY creado_en DESC LIMIT 1)`;
    if (actor.rol === 'ADMIN') {
      await c.query(
        `UPDATE verificacion_cierre SET resultado_final = $2, id_verificado_por = $3, observacion = $4, verificado_en = now() WHERE id_verificacion = ${ultima}`,
        [inc.id_incidente, destino === 'RESUELTO' ? 'APROBADA' : 'RECHAZADA', actor.idUsuario, comentario ?? null],
      );
    } else if (actor.rol === 'COMUNIDAD') {
      await c.query(`UPDATE verificacion_cierre SET confirmacion_reportante = FALSE, observacion = $2 WHERE id_verificacion = ${ultima}`, [
        inc.id_incidente,
        comentario ?? null,
      ]);
    }
  }

  // Aviso al reportante con el texto amigable del nuevo estado
  await c.query(
    `INSERT INTO notificacion (id_incidente, id_destinatario, canal, evento, titulo, cuerpo)
     SELECT $1, i.id_reportante, 'WHATSAPP', 'CAMBIO_ESTADO', 'Tu reporte cambió de estado', e.visible_usuario
       FROM incidente i JOIN estado_incidente e ON e.id_estado = i.id_estado WHERE i.id_incidente = $1`,
    [inc.id_incidente],
  );
  // Si el trabajo vuelve a "en proceso" desde la verificación, se avisa al técnico el motivo
  if (inc.estado === 'EN_VERIFICACION' && destino === 'EN_PROCESO') {
    await c.query(
      `INSERT INTO notificacion (id_incidente, id_destinatario, canal, evento, titulo, cuerpo)
       SELECT $1, t.id_usuario, 'WHATSAPP', 'REABIERTO', 'El incidente volvió a proceso', $2
         FROM incidente i JOIN tecnico t ON t.id_tecnico = i.id_tecnico WHERE i.id_incidente = $1`,
      [inc.id_incidente, comentario ?? 'Revisa el trabajo realizado'],
    );
  }
}
