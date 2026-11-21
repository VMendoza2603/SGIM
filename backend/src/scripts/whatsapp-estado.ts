/**
 * Revisión rápida antes de presentar (npm run whatsapp:estado):
 * dice a dónde manda Meta los mensajes del número y si esa dirección responde de verdad.
 * Si el número apunta a un túnel cerrado, los mensajes se retrasan (Meta los reintenta y los retiene en fila).
 */
import { config } from '../config.js';

const VERDE = '\x1b[32m', ROJO = '\x1b[31m', AMARILLO = '\x1b[33m', FIN = '\x1b[0m';
const w = config.whatsapp;
const PRODUCCION = process.env.WA_WEBHOOK_PRODUCCION ?? '';

if (!w.token || !w.phoneNumberId) {
  console.error(`${ROJO}✖ Faltan WA_TOKEN o WA_PHONE_NUMBER_ID en backend/.env${FIN}`);
  process.exit(1);
}

/** ¿La URL contesta el desafío de Meta? (el mismo GET que hace Meta al verificar el webhook) */
async function responde(url: string) {
  try {
    const r = await fetch(`${url}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(w.verifyToken)}&hub.challenge=sgim`, { signal: AbortSignal.timeout(10_000) });
    return (await r.text()) === 'sgim';
  } catch {
    return false;
  }
}

const r = await fetch(`https://graph.facebook.com/${w.version}/${w.phoneNumberId}?fields=display_phone_number,status,webhook_configuration`, {
  headers: { Authorization: `Bearer ${w.token}` },
});
const j: any = await r.json();
if (!r.ok) {
  console.error(`${ROJO}✖ Meta respondió con error: ${j.error?.message ?? r.status}${FIN}`);
  process.exit(1);
}

const numero: string = j.webhook_configuration?.phone_number ?? '';
const app: string = j.webhook_configuration?.application ?? '';
const tipo = (u: string) => (u.includes('trycloudflare.com') ? 'túnel de una PC' : u.includes('vercel.app') ? 'Vercel (producción)' : 'otra dirección');

console.log(`Número ${j.display_phone_number} · ${j.status === 'CONNECTED' ? `${VERDE}CONECTADO${FIN}` : `${ROJO}${j.status}${FIN}`}\n`);
const vivoNumero = numero ? await responde(numero) : false;
console.log(`Los mensajes del número van a: ${numero || '(sin dirección)'}`);
console.log(`  → ${tipo(numero)} · ${vivoNumero ? `${VERDE}✔ responde${FIN}` : `${ROJO}✖ NO responde: los mensajes se van a retrasar o perder${FIN}`}`);
if (app && app !== numero) {
  const vivoApp = await responde(app);
  console.log(`Configuración general de la app: ${app}`);
  console.log(`  → ${tipo(app)} · ${vivoApp ? `${VERDE}✔ responde${FIN}` : `${AMARILLO}✖ no responde (el número usa su propia dirección, pero conviene corregirla)${FIN}`}`);
}

if (!vivoNumero) {
  const base = PRODUCCION.replace(/\/api\/whatsapp\/webhook\/?$/, '');
  console.log(`\n${ROJO}El chatbot no está recibiendo mensajes.${FIN} Soluciones:`);
  if (base) console.log(`  · Producción:  npm run webhook:produccion -- ${base}`);
  console.log('  · En esta PC:  npm run dev (en la carpeta raíz), que abre el túnel');
  process.exit(1);
}
console.log(`\n${VERDE}Todo bien: el chatbot está recibiendo mensajes.${FIN}`);
