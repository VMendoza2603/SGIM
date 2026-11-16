import { waitUntil } from '@vercel/functions';

/**
 * Ejecuta una tarea sin hacer esperar la respuesta HTTP (procesar el webhook, verificar un cierre con IA, despachar avisos).
 * En Vercel (serverless) la función se congela al responder: `waitUntil` la mantiene viva hasta que la tarea termine.
 * En local (servidor siempre encendido) la tarea simplemente sigue corriendo.
 */
export function enSegundoPlano(tarea: Promise<unknown>) {
  const segura = tarea.catch((e) => console.error('[segundo plano]', e));
  if (process.env.VERCEL) waitUntil(segura);
}
