import { config, whatsappActivo } from '../config.js';
import { query, queryOne } from '../db.js';

/**
 * Cliente de WhatsApp Cloud API (Meta). Cada mensaje que sale queda guardado en `mensaje`
 * (evidencia de la conversación), salga bien o falle.
 */

export type Boton = { id: string; titulo: string };
export type FilaLista = { id: string; titulo: string; descripcion?: string };
export type Salida =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'botones'; texto: string; botones: Boton[] }
  | { tipo: 'lista'; texto: string; boton: string; filas: FilaLista[] };

const URL_API = () => `https://graph.facebook.com/${config.whatsapp.version}`;
const corta = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Convierte la salida al formato de Meta respetando sus límites (3 botones de 20 caracteres, 10 filas de 24). */
function cuerpoMeta(telefono: string, s: Salida) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: telefono };
  if (s.tipo === 'texto') return { ...base, type: 'text', text: { body: corta(s.texto, 4096), preview_url: false } };
  if (s.tipo === 'botones') {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: corta(s.texto, 1024) },
        action: { buttons: s.botones.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: corta(b.titulo, 20) } })) },
      },
    };
  }
  return {
    ...base,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: corta(s.texto, 1024) },
      action: {
        button: corta(s.boton, 20),
        sections: [
          {
            title: 'Opciones',
            rows: s.filas.slice(0, 10).map((f) => ({
              id: f.id,
              title: corta(f.titulo, 24),
              ...(f.descripcion ? { description: corta(f.descripcion, 72) } : {}),
            })),
          },
        ],
      },
    },
  };
}

/** Texto legible que se guarda en `mensaje.contenido` (lo muestra la pantalla Conversaciones). */
function textoGuardado(s: Salida) {
  if (s.tipo === 'texto') return s.texto;
  if (s.tipo === 'botones') return `${s.texto}\n[${s.botones.map((b) => b.titulo).join('] [')}]`;
  return `${s.texto}\n${s.filas.map((f) => `• ${f.titulo}`).join('\n')}`;
}

/** Conversación abierta del número (o una nueva). Se vincula al usuario cuando ya se conoce. */
export async function obtenerConversacion(telefono: string, idUsuario: number | null) {
  let c = await queryOne(
    `SELECT * FROM conversacion WHERE telefono_wa = $1 AND cerrada_en IS NULL ORDER BY ultima_actividad DESC LIMIT 1`,
    [telefono],
  );
  if (!c) {
    c = await queryOne(`INSERT INTO conversacion (telefono_wa, id_usuario) VALUES ($1, $2) RETURNING *`, [telefono, idUsuario]);
  } else if (idUsuario && !c.id_usuario) {
    await query(`UPDATE conversacion SET id_usuario = $2 WHERE id_conversacion = $1`, [c.id_conversacion, idUsuario]);
    c.id_usuario = idUsuario;
  }
  return c!;
}

export interface ResultadoEnvio {
  ok: boolean;
  idMensaje: number | null;
  error?: string;
  /** El error no se arregla reintentando (número no permitido o inválido, token inválido). */
  permanente?: boolean;
}

/** Códigos de Meta que no tiene sentido reintentar. */
const ERRORES_PERMANENTES = new Set([100, 190, 131008, 131009, 131021, 131026, 131030, 131045, 133010]);

/**
 * Envía un mensaje y lo registra. Nunca lanza error: devuelve ok = false con el motivo.
 * Si se indica `idMensaje` (reintento de un aviso), actualiza ese mismo registro en lugar de crear otro.
 */
export async function enviar(telefono: string, salida: Salida, idConversacion?: number, idMensaje?: number | null): Promise<ResultadoEnvio> {
  const conv = idConversacion ?? (await obtenerConversacion(telefono, null)).id_conversacion;
  const tipo = salida.tipo === 'texto' ? 'TEXTO' : 'INTERACTIVO';
  let waId: string | null = null;
  let error: string | undefined;
  let permanente = false;

  if (!whatsappActivo()) {
    error = 'WhatsApp no está configurado en el servidor (WA_TOKEN / WA_PHONE_NUMBER_ID)';
    permanente = true;
  } else {
    try {
      const r = await fetch(`${URL_API()}/${config.whatsapp.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpoMeta(telefono, salida)),
      });
      const d = (await r.json().catch(() => ({}))) as any;
      if (r.ok) waId = d.messages?.[0]?.id ?? null;
      else {
        error = describirError(d.error);
        permanente = ERRORES_PERMANENTES.has(d.error?.code);
      }
    } catch (e) {
      error = `No se pudo conectar con WhatsApp: ${(e as Error).message}`;
    }
  }

  const estado = waId ? 'ENVIADO' : 'FALLIDO';
  const payload = JSON.stringify(error ? { error } : { salida: salida.tipo });
  let id = idMensaje ?? null;
  if (id) {
    await query(`UPDATE mensaje SET wa_message_id = $2, estado = $3, payload = $4, creado_en = now() WHERE id_mensaje = $1`, [id, waId, estado, payload]);
  } else {
    const m = await queryOne(
      `INSERT INTO mensaje (id_conversacion, wa_message_id, direccion, tipo, contenido, estado, payload)
       VALUES ($1, $2, 'SALIENTE', $3, $4, $5, $6) RETURNING id_mensaje`,
      [conv, waId, tipo, textoGuardado(salida), estado, payload],
    );
    id = m?.id_mensaje ?? null;
  }
  await query(`UPDATE conversacion SET ultima_actividad = now() WHERE id_conversacion = $1`, [conv]);
  if (error) console.warn(`[whatsapp] No se envió a ${telefono}: ${error}${permanente ? ' (no se reintentará)' : ''}`);
  return { ok: !!waId, idMensaje: id, error, permanente };
}

/** Mensajes de error de Meta más comunes, en palabras del usuario. */
function describirError(e: any): string {
  const codigo = e?.code;
  if (codigo === 131030) return 'El número no está en la lista de destinatarios permitidos del número de prueba';
  if (codigo === 131047) return 'Pasaron más de 24 horas desde el último mensaje del usuario: hace falta una plantilla aprobada';
  if (codigo === 190) return 'El token de WhatsApp no es válido o caducó';
  return e?.message ? `${e.message}${codigo ? ` (código ${codigo})` : ''}` : 'Error desconocido de WhatsApp';
}

/** Descarga una foto enviada por el usuario (Meta entrega primero una URL temporal y luego el archivo). */
export async function descargarMedia(mediaId: string): Promise<{ buffer: Buffer; mime: string }> {
  const auth = { Authorization: `Bearer ${config.whatsapp.token}` };
  const info = (await (await fetch(`${URL_API()}/${mediaId}`, { headers: auth })).json()) as any;
  if (!info.url) throw new Error(info.error?.message ?? 'Meta no devolvió la URL del archivo');
  const r = await fetch(info.url, { headers: auth });
  if (!r.ok) throw new Error(`No se pudo descargar el archivo (HTTP ${r.status})`);
  return { buffer: Buffer.from(await r.arrayBuffer()), mime: info.mime_type ?? r.headers.get('content-type') ?? '' };
}
