import { query, queryOne } from '../db.js';
import { botonesSolucion, listaCalificacion, mensajeLider } from './chatbot.js';
import { enviar, obtenerConversacion, type Salida } from './whatsapp.js';

/**
 * Despacha por WhatsApp las notificaciones que el sistema deja en cola (tabla `notificacion`):
 * asignaciones al técnico, cambios de estado al reportante y reaperturas.
 * Si falla por algo pasajero reintenta hasta 3 veces (esperando 2 y 4 minutos) sobre el mismo mensaje;
 * si el error es permanente (número no permitido, inválido…) no reintenta. Solo toma avisos de las últimas 24 horas.
 */

const MAX_INTENTOS = 3;
let ocupado = false;

/** Contenido del mensaje según el evento. */
async function armarMensaje(n: any): Promise<Salida> {
  const inc = n.id_incidente
    ? await queryOne(
        `SELECT i.id_incidente, i.codigo, i.titulo, i.calificacion, e.codigo AS estado, p.nombre AS prioridad,
                COALESCE(u.codigo || ' · ' || u.nombre, i.ubicacion_texto) AS lugar
           FROM incidente i JOIN estado_incidente e USING (id_estado)
           LEFT JOIN prioridad p ON p.id_prioridad = i.id_prioridad
           LEFT JOIN ubicacion u ON u.id_ubicacion = i.id_ubicacion
          WHERE i.id_incidente = $1`,
        [n.id_incidente],
      )
    : null;

  if (n.evento === 'ASIGNACION' && inc) {
    // El técnico líder recibe el reporte con la asignación y puede cambiar el técnico
    const dest = await queryOne(`SELECT es_lider FROM tecnico WHERE id_usuario = $1`, [n.id_destinatario]);
    if (dest?.es_lider) return mensajeLider(inc.id_incidente);
    // Los demás técnicos: aviso informativo (no deciden si lo aceptan; lo atienden desde su panel)
    return {
      tipo: 'texto',
      texto:
        `🔧 *Nuevo incidente asignado*\n\n*${inc.codigo}* · ${inc.titulo}\n📍 ${inc.lugar ?? '—'}\nPrioridad: ${inc.prioridad ?? '—'}\n\n` +
        'Revísalo en tu panel del SGIM (*Mis incidentes*). Si tienes algún inconveniente, coméntalo con el técnico líder.',
    };
  }
  if (n.evento === 'CAMBIO_ESTADO' && inc) {
    const texto = `📋 *${inc.codigo}* · ${inc.titulo}\n${n.cuerpo}`;
    if (inc.estado === 'EN_VERIFICACION') return { tipo: 'botones', texto: `${texto}\n\n¿Quedó solucionado?`, botones: botonesSolucion(inc.id_incidente) };
    if (inc.estado === 'RESUELTO' && inc.calificacion == null) {
      const lista = listaCalificacion(inc.id_incidente, inc.codigo) as Extract<Salida, { tipo: 'lista' }>;
      return { ...lista, texto: `${texto} ✅\n\n${lista.texto}` };
    }
    return { tipo: 'texto', texto };
  }
  if (n.evento === 'REABIERTO' && inc) {
    return { tipo: 'texto', texto: `🔁 *${inc.codigo}* volvió a "en proceso".\nMotivo: ${n.cuerpo}\n\nCuando lo corrijas, envíame otra foto de cierre.` };
  }
  return { tipo: 'texto', texto: `${n.titulo}\n${n.cuerpo}` };
}

export async function despacharPendientes() {
  if (ocupado) return;
  ocupado = true;
  try {
    const pendientes = await query(
      `SELECT n.*, u.telefono_wa FROM notificacion n JOIN usuario u ON u.id_usuario = n.id_destinatario
        WHERE n.canal = 'WHATSAPP' AND n.estado IN ('PENDIENTE', 'FALLIDA') AND n.intentos < $1
          AND n.creado_en > now() - interval '24 hours'
          AND n.creado_en <= now() - make_interval(mins => 2 * n.intentos)
        ORDER BY n.creado_en LIMIT 20`,
      [MAX_INTENTOS],
    );
    for (const n of pendientes) {
      if (!n.telefono_wa) {
        await query(`UPDATE notificacion SET estado = 'FALLIDA', intentos = $2, error = $3 WHERE id_notificacion = $1`, [
          n.id_notificacion, MAX_INTENTOS, 'El destinatario no tiene número de WhatsApp',
        ]);
        continue;
      }
      const conv = await obtenerConversacion(n.telefono_wa, n.id_destinatario);
      const r = await enviar(n.telefono_wa, await armarMensaje(n), conv.id_conversacion, n.id_mensaje);
      await query(
        `UPDATE notificacion SET estado = $2, intentos = CASE WHEN $5 THEN $6 ELSE intentos + 1 END, id_mensaje = $3, error = $4
          WHERE id_notificacion = $1`,
        [n.id_notificacion, r.ok ? 'ENVIADA' : 'FALLIDA', r.idMensaje, r.error?.slice(0, 500) ?? null, !!r.permanente, MAX_INTENTOS],
      );
    }
  } catch (e) {
    console.error('[notificaciones] Error al despachar:', e);
  } finally {
    ocupado = false;
  }
}

/** Actualiza el estado de entrega que informa Meta (enviado, entregado, leído, fallido). */
export async function actualizarEntrega(waId: string, estado: string, error?: string) {
  const mapa: Record<string, [string, string]> = {
    sent: ['ENVIADO', 'ENVIADA'],
    delivered: ['ENTREGADO', 'ENTREGADA'],
    read: ['LEIDO', 'LEIDA'],
    failed: ['FALLIDO', 'FALLIDA'],
  };
  const m = mapa[estado];
  if (!m) return;
  const msg = await queryOne(`UPDATE mensaje SET estado = $2 WHERE wa_message_id = $1 RETURNING id_mensaje`, [waId, m[0]]);
  if (!msg) return;
  await query(
    `UPDATE notificacion SET estado = $2::estado_notif, leida_en = CASE WHEN $2::text = 'LEIDA' THEN now() ELSE leida_en END,
            error = COALESCE($3, error)
      WHERE id_mensaje = $1`,
    [msg.id_mensaje, m[1], error ?? null],
  );
}
