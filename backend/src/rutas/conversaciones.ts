import { Router } from 'express';
import { z } from 'zod';
import { requierePermiso } from '../auth.js';
import { query, queryOne } from '../db.js';
import { HttpError, noEncontrado, ruta } from '../errores.js';
import { enviar } from '../servicios/whatsapp.js';

export const conversacionesRouter = Router();
conversacionesRouter.use(requierePermiso('conversacion.ver'));

/** A11 · Conversaciones del bot, más recientes primero. */
conversacionesRouter.get(
  '/',
  ruta(async (_req, res) => {
    const filas = await query(
      `SELECT c.id_conversacion, c.telefono_wa, c.estado, c.ultima_actividad,
              u.nombres || ' ' || u.apellidos AS usuario,
              (SELECT m.contenido FROM mensaje m WHERE m.id_conversacion = c.id_conversacion ORDER BY m.creado_en DESC LIMIT 1) AS ultimo_mensaje,
              (SELECT i.codigo FROM incidente i WHERE i.id_conversacion = c.id_conversacion ORDER BY i.fecha_reporte DESC LIMIT 1) AS incidente
         FROM conversacion c LEFT JOIN usuario u ON u.id_usuario = c.id_usuario
        ORDER BY c.ultima_actividad DESC LIMIT 100`,
    );
    res.json(filas);
  }),
);

conversacionesRouter.get(
  '/:id',
  ruta(async (req, res) => {
    const c = await queryOne(
      `SELECT c.*, u.nombres || ' ' || u.apellidos AS usuario FROM conversacion c LEFT JOIN usuario u ON u.id_usuario = c.id_usuario WHERE c.id_conversacion = $1`,
      [req.params.id],
    );
    if (!c) throw noEncontrado('Conversación');
    const [mensajes, incidentes] = await Promise.all([
      query(`SELECT id_mensaje, direccion, tipo, contenido, media_url, estado, creado_en FROM mensaje WHERE id_conversacion = $1 ORDER BY creado_en`, [req.params.id]),
      query(
        `SELECT i.codigo, i.titulo, e.codigo AS estado, (i.id_ubicacion IS NULL) AS revision_manual
           FROM incidente i JOIN estado_incidente e USING (id_estado) WHERE i.id_conversacion = $1 ORDER BY i.fecha_reporte DESC`,
        [req.params.id],
      ),
    ]);
    res.json({ ...c, mensajes, incidentes });
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
