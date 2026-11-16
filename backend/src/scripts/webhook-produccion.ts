/**
 * Apunta el webhook de WhatsApp a la versión desplegada en Vercel (sin túnel).
 * Registra la URL en la app de Meta y en el número (reemplaza la del túnel de pruebas).
 * La app de Vercel ya debe estar publicada con las mismas variables WA_* que backend/.env.
 *
 * Uso (desde backend/):  npm run webhook:produccion -- https://sgim.vercel.app
 */
import { config } from '../config.js';

const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https:\/\//.test(base)) {
  console.error('Indica la dirección de Vercel, por ejemplo: npm run webhook:produccion -- https://sgim.vercel.app');
  process.exit(1);
}
const APP_ID = process.env.WA_APP_ID ?? '';
const API = `https://graph.facebook.com/${config.whatsapp.version}`;
const webhook = `${base}/api/whatsapp/webhook`;

// 1. Meta verifica primero que la URL responda el desafío (GET con el WA_VERIFY_TOKEN)
const prueba = await fetch(`${webhook}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(config.whatsapp.verifyToken)}&hub.challenge=sgim`);
if ((await prueba.text()) !== 'sgim') {
  console.error(`La URL no respondió la verificación (HTTP ${prueba.status}). Revisa que esté desplegada y que WA_VERIFY_TOKEN sea el mismo en Vercel.`);
  process.exit(1);
}
console.log('✔ La URL de Vercel responde la verificación de Meta');

// 2. Webhook general de la app
const p = new URLSearchParams({
  object: 'whatsapp_business_account',
  callback_url: webhook,
  fields: 'messages',
  verify_token: config.whatsapp.verifyToken,
  include_values: 'true',
  access_token: `${APP_ID}|${config.whatsapp.appSecret}`,
});
const r1 = await fetch(`${API}/${APP_ID}/subscriptions`, { method: 'POST', body: p });
if (!r1.ok) {
  console.error('Error al registrar el webhook de la app:', JSON.stringify(await r1.json()));
  process.exit(1);
}
console.log('✔ Webhook de la app registrado');

// 3. El número deja de apuntar al túnel y apunta a Vercel
const r2 = await fetch(`${API}/${config.whatsapp.phoneNumberId}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ webhook_configuration: { override_callback_uri: webhook, verify_token: config.whatsapp.verifyToken } }),
});
if (!r2.ok) {
  console.error('Error al registrar el webhook del número:', JSON.stringify(await r2.json()));
  process.exit(1);
}
console.log(`✔ El número ya apunta a ${webhook}`);
console.log('\nListo: el chatbot responde desde Vercel. Para volver a probar en local, usa npm run tunel.');
