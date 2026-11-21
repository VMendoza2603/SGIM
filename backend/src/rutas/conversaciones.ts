import { Router } from 'express';
import { z } from 'zod';
import { requierePermiso } from '../auth.js';
import { query, queryOne, escaparLike } from '../db.js';
import { HttpError, noEncontrado, ruta } from '../errores.js';
import { enviar } from '../servicios/whatsapp.js';

export const conversacionesRouter = Router();
conversacionesRouter.use(requierePermiso('conversacion.ver'));

/** Técnicos = usuarios con rol TECNICO. Comunidad educativa = el resto (estudiantes, docentes, administrativos y números aún no registrados). */
const ES_TECNICO = `COALESCE(r.codigo = 'TECNICO', FALSE)`;
/** Quita tildes para que «Andrea Villacis» encuentre «Andrea Villacís» (sin depender de la extensión unaccent). */
const sinTildes = (sql: string) => `translate(lower(${sql}), 'áéíóúüñ', 'aeiouun')`;

/** Máximo de conversaciones en la lista y de mensajes por chat (los más recientes): la pantalla se refresca cada 4 s. */
const LIMITE = 100;
const MAX_MENSAJES = 300;

const filtrosSchema = z.object({
  grupo: z.enum(['tecnicos', 'comunidad']).optional(),
  tipo: z.enum(['ESTUDIANTE', 'DOCENTE', 'ADMINISTRATIVO']).optional(),
  q: z.string().trim().max(80).optional(),
  // Rango de fechas (inclusive): conversaciones con al menos un mensaje en ese periodo
  desde: z.string().date().optional(),
  hasta: z.string().date().optional(),
}).refine((f) => !f.desde || !f.hasta || f.desde <= f.hasta, { message: 'La fecha «desde» no puede ser posterior a «hasta»', path: ['hasta'] });

/** A11 · Conversaciones del bot, más recientes primero; filtro por grupo, tipo de miembro, nombre o teléfono y fechas. */
conversacionesRouter.get(
  '/',
  ruta(async (req, res) => {
    const f = filtrosSchema.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.grupo) where.push(f.grupo === 'tecnicos' ? ES_TECNICO : `NOT ${ES_TECNICO}`);
    if (f.tipo) {
      params.push(f.tipo);
      where.push(`u.tipo_miembro = $${params.length}`);
    }
    if (f.q) {
      params.push(`%${escaparLike(f.q)}%`);
      const n = params.length;
      where.push(`(${sinTildes(`u.nombres || ' ' || u.apellidos`)} LIKE ${sinTildes(`$${n}::text`)} OR c.telefono_wa LIKE $${n})`);
    }
    if (f.desde || f.hasta) {
      const rango: string[] = [];
      if (f.desde) {
        params.push(f.desde);
        rango.push(`m.creado_en >= $${params.length}::date`);
      }
      if (f.hasta) {
        params.push(f.hasta);
        rango.push(`m.creado_en < $${params.length}::date + 1`);
      }
      where.push(`EXISTS (SELECT 1 FROM mensaje m WHERE m.id_conversacion = c.id_conversacion AND ${rango.join(' AND ')})`);
    }
    const desde = `FROM conversacion c LEFT JOIN usuario u ON u.id_usuario = c.id_usuario LEFT JOIN rol r ON r.id_rol = u.id_rol`;
    const [filas, totales] = await Promise.all([
      query(
        `SELECT c.id_conversacion, c.telefono_wa, c.estado, c.ultima_actividad,
                u.nombres || ' ' || u.apellidos AS usuario, u.tipo_miembro, ${ES_TECNICO} AS es_tecnico,
                (SELECT m.contenido FROM mensaje m WHERE m.id_conversacion = c.id_conversacion ORDER BY m.creado_en DESC LIMIT 1) AS ultimo_mensaje,
                (SELECT i.codigo FROM incidente i WHERE i.id_conversacion = c.id_conversacion ORDER BY i.fecha_reporte DESC LIMIT 1) AS incidente
           ${desde} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY c.ultima_actividad DESC, c.id_conversacion DESC LIMIT ${LIMITE + 1}`,
        params,
      ),
      queryOne(`SELECT count(*) FILTER (WHERE ${ES_TECNICO})::int AS tecnicos, count(*) FILTER (WHERE NOT ${ES_TECNICO})::int AS comunidad ${desde}`),
    ]);
    // Se pide una fila de más para saber si quedaron conversaciones fuera de la lista (el panel invita a filtrar)
    res.json({ filas: filas.slice(0, LIMITE), hay_mas: filas.length > LIMITE, totales });
  }),
);

conversacionesRouter.get(
  '/:id',
  ruta(async (req, res) => {
    const c = await queryOne(
      `SELECT c.*, u.nombres || ' ' || u.apellidos AS usuario, u.tipo_miembro,
              (SELECT t.id_tecnico FROM tecnico t WHERE t.id_usuario = c.id_usuario) AS id_tecnico
         FROM conversacion c LEFT JOIN usuario u ON u.id_usuario = c.id_usuario WHERE c.id_conversacion = $1`,
      [req.params.id],
    );
    if (!c) throw noEncontrado('Conversación');
    const [mensajes, total, incidentes] = await Promise.all([
      // Los últimos MAX_MENSAJES, en orden cronológico
      query(
        `SELECT * FROM (SELECT id_mensaje, direccion, tipo, contenido, media_url, estado, creado_en FROM mensaje
                         WHERE id_conversacion = $1 ORDER BY creado_en DESC, id_mensaje DESC LIMIT ${MAX_MENSAJES}) m
          ORDER BY creado_en, id_mensaje`,
        [c.id_conversacion],
      ),
      queryOne(`SELECT count(*)::int AS n FROM mensaje WHERE id_conversacion = $1`, [c.id_conversacion]),
      query(
        `SELECT i.codigo, i.titulo, e.codigo AS estado, (i.id_ubicacion IS NULL) AS revision_manual
           FROM incidente i JOIN estado_incidente e USING (id_estado) WHERE i.id_conversacion = $1 ORDER BY i.fecha_reporte DESC`,
        [c.id_conversacion],
      ),
    ]);
    res.json({ ...c, mensajes, mensajes_total: total.n, incidentes });
  }),
);

/**
 * El coordinador toma la conversación y responde manualmente por WhatsApp.
 * Mientras tanto el bot se pausa 30 minutos para no responder encima.
 */
conversacionesRouter.post(
  '/:id/mensajes',
  ruta(async (req, res) => {
    const { texto } = z.object({ texto: z.string().trim().min(1).max(4096) }).parse(req.body);
    const c = await queryOne(`SELECT id_conversacion, telefono_wa FROM conversacion WHERE id_conversacion = $1`, [req.params.id]);
    if (!c) throw noEncontrado('Conversación');
    await query(
      `UPDATE conversacion SET contexto = jsonb_set(contexto, '{manual_hasta}', to_jsonb(now() + interval '30 minutes')) WHERE id_conversacion = $1`,
      [c.id_conversacion],
    );
    const r = await enviar(c.telefono_wa, { tipo: 'texto', texto }, c.id_conversacion);
    await query(`UPDATE mensaje SET payload = payload || $2 WHERE id_mensaje = $1`, [r.idMensaje, JSON.stringify({ manual: true, id_usuario: req.usuario!.id })]);
    if (!r.ok) throw new HttpError(502, `El mensaje quedó registrado, pero WhatsApp no lo entregó: ${r.error}`);
    res.status(201).json({ id_mensaje: r.idMensaje });
  }),
);
