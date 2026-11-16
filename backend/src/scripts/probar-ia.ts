/**
 * Prueba aislada del agente de IA (sin chatbot ni base de incidentes).
 *   npm run ia:probar -- --modelos                         → modelos de Gemini disponibles con tu clave
 *   npm run ia:probar -- "salen chispas del tomacorriente" → analiza solo el texto
 *   npm run ia:probar -- foto.jpg "descripción"            → analiza la foto con su descripción
 *   npm run ia:probar -- --cierre antes.jpg despues.jpg "descripción" → verificación de cierre
 */
import path from 'node:path';
import { config, iaActiva } from '../config.js';
import { pool } from '../db.js';
import { analizarCierre, analizarReporte } from '../servicios/ia.js';

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const foto = (ruta: string) => {
  const mime = MIME[path.extname(ruta).toLowerCase()];
  if (!mime) throw new Error(`La foto debe ser JPG, PNG o WEBP: ${ruta}`);
  return { url: path.resolve(ruta), mime };
};
const esFoto = (a?: string) => !!a && !!MIME[path.extname(a).toLowerCase()];

async function main() {
  if (!iaActiva()) throw new Error('Falta GEMINI_API_KEY en backend/.env');
  const args = process.argv.slice(2);
  console.log(`Modelo configurado: ${config.ia.modelo}\n`);

  if (args[0] === '--modelos') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': config.ia.geminiKey } });
    const d = (await r.json()) as any;
    if (!r.ok) throw new Error(d.error?.message ?? `HTTP ${r.status}`);
    const modelos = d.models.filter((m: any) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/.test(m.name));
    for (const m of modelos) console.log(`${m.name.replace('models/', '').padEnd(40)} ${m.displayName}`);
    return;
  }

  if (args[0] === '--cierre') {
    const [, antes, despues, ...desc] = args;
    if (!esFoto(antes) || !esFoto(despues)) throw new Error('Uso: --cierre antes.jpg despues.jpg "descripción"');
    const a = await analizarCierre(desc.join(' ') || 'Daño reportado', foto(antes), foto(despues));
    if (!a) throw new Error('Gemini no respondió (revisa el mensaje de arriba)');
    const { respuestaCruda, ...resumen } = a;
    console.log(resumen);
    return;
  }

  const ruta = esFoto(args[0]) ? args[0] : null;
  const descripcion = (ruta ? args.slice(1) : args).join(' ') || 'Sin descripción';
  const a = await analizarReporte(descripcion, ruta ? foto(ruta) : null);
  if (!a) throw new Error('Gemini no respondió (revisa el mensaje de arriba)');
  const { respuestaCruda, ...resumen } = a;
  console.log(resumen);
}

main()
  .catch((e) => {
    console.error(`✖ ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
