import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { config } from '../config.js';
import { procesarEntrante, type Entrante } from '../servicios/chatbot.js';
import { actualizarEntrega, despacharPendientes } from '../servicios/notificaciones.js';
import { enSegundoPlano } from '../servicios/segundoPlano.js';

/**
 * Webhook de WhatsApp Cloud API (fase 5). Es público porque lo llama Meta, pero:
 *  - GET verifica el token que se configura en Meta (WA_VERIFY_TOKEN);
 *  - POST comprueba la firma X-Hub-Signature-256 con la clave secreta de la app (WA_APP_SECRET).
 */
export const whatsappRouter = Router();

whatsappRouter.get('/webhook', (req, res) => {
  const { 'hub.mode': modo, 'hub.verify_token': token, 'hub.challenge': reto } = req.query as Record<string, string>;
  if (modo === 'subscribe' && config.whatsapp.verifyToken && token === config.whatsapp.verifyToken) {
    console.log('[whatsapp] Webhook verificado por Meta');
    return res.status(200).send(reto);
  }
  res.sendStatus(403);
});

function firmaValida(req: Request) {
  if (!config.whatsapp.appSecret) return true; // sin clave configurada no se puede verificar (solo desarrollo)
  const firma = req.get('x-hub-signature-256') ?? '';
  const crudo = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!crudo || !firma.startsWith('sha256=')) return false;
  const esperada = createHmac('sha256', config.whatsapp.appSecret).update(crudo).digest('hex');
  const a = Buffer.from(firma.slice(7), 'hex');
  const b = Buffer.from(esperada, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Traduce un mensaje de Meta al formato del chatbot. */
function aEntrante(m: any): Entrante {
  const base = { telefono: m.from, waId: m.id, payload: m, tipoOriginal: m.type };
  switch (m.type) {
    case 'text':
      return { ...base, tipo: 'texto', texto: m.text?.body ?? '' };
    case 'interactive': {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply ?? {};
      return { ...base, tipo: 'respuesta', idRespuesta: r.id, texto: r.title };
    }
    case 'button': // respuesta rápida de una plantilla
      return { ...base, tipo: 'respuesta', idRespuesta: m.button?.payload, texto: m.button?.text };
    case 'image':
      return { ...base, tipo: 'imagen', mediaId: m.image?.id, caption: m.image?.caption };
    default:
      return { ...base, tipo: 'otro' };
  }
}

/**
 * Cola por número: los mensajes de una misma persona se procesan uno tras otro y en orden (si manda la foto y el texto
 * casi juntos, el segundo espera al primero y no se pisan). Personas distintas se atienden en paralelo.
 */
const colas = new Map<string, Promise<void>>();
function enCola(telefono: string, tarea: () => Promise<void>) {
  const anterior = colas.get(telefono) ?? Promise.resolve();
  const actual = anterior.then(tarea).catch((e) => console.error('[whatsapp] mensaje:', e));
  colas.set(telefono, actual);
  void actual.finally(() => {
    if (colas.get(telefono) === actual) colas.delete(telefono);
  });
  return actual;
}

whatsappRouter.post('/webhook', (req, res) => {
  if (!firmaValida(req)) {
    console.warn('[whatsapp] Firma inválida: se rechaza el webhook');
    return res.sendStatus(401);
  }
  // Meta espera la respuesta enseguida; el procesamiento sigue en segundo plano
  // (en Vercel, enSegundoPlano mantiene viva la función hasta terminar)
  res.sendStatus(200);
  enSegundoPlano(
    (async () => {
      const tareas: Promise<void>[] = [];
      for (const entrada of req.body?.entry ?? []) {
        for (const cambio of entrada.changes ?? []) {
          if (cambio.field !== 'messages') continue;
          const v = cambio.value ?? {};
          for (const st of v.statuses ?? []) {
            await actualizarEntrega(st.id, st.status, st.errors?.[0]?.title).catch((e) => console.error('[whatsapp] estado:', e));
          }
          for (const m of v.messages ?? []) {
            const entrante = aEntrante(m);
            tareas.push(enCola(entrante.telefono, async () => {
              await procesarEntrante(entrante);
            }));
          }
        }
      }
      await Promise.all(tareas);
      // Los avisos que dejó en cola el mensaje (asignación al técnico, aviso al líder) salen enseguida
      if (tareas.length) await despacharPendientes();
    })(),
  );
});
