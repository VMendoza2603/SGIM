/**
 * Túnel de desarrollo para el chatbot (npm run tunel).
 * 1. Levanta cloudflared hacia el backend local y espera a que confirme la conexión.
 * 2. Registra la dirección pública en Meta por la API (sin entrar al panel):
 *    - siempre como webhook propio del número de prueba (WA_PHONE_NUMBER_ID);
 *    - y como webhook general de la app solo si todavía no hay uno de producción (WA_WEBHOOK_PRODUCCION),
 *      para no desviar el chatbot que ya está publicado en Vercel.
 *    Meta verifica la URL al registrarla, así que se reintenta mientras la dirección se propaga.
 * El túnel queda abierto hasta cerrar esta ventana o pulsar Ctrl+C.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { config } from '../config.js';

const API = `https://graph.facebook.com/${config.whatsapp.version}`;
const APP_ID = process.env.WA_APP_ID ?? '';
const PRODUCCION = process.env.WA_WEBHOOK_PRODUCCION ?? '';
const RUTA = '/api/whatsapp/webhook';
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ejecutable() {
  if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH;
  const windows = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
  return fs.existsSync(windows) ? windows : 'cloudflared';
}

function salir(msg: string): never {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

async function comprobarRequisitos() {
  const faltan = ['WA_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_VERIFY_TOKEN', 'WA_APP_SECRET', 'WA_APP_ID'].filter((v) => !process.env[v]);
  if (faltan.length) salir(`Faltan variables en backend/.env: ${faltan.join(', ')}`);
  try {
    await fetch(`http://localhost:${config.port}/api/salud`);
  } catch {
    salir(`El backend no responde en http://localhost:${config.port}. Levántalo primero con: npm run dev`);
  }
}

/** Arranca cloudflared y devuelve la URL pública cuando la conexión ya quedó registrada. */
function abrirTunel(): Promise<string> {
  return new Promise((resolve, reject) => {
    const cf = spawn(ejecutable(), ['tunnel', '--no-autoupdate', '--url', `http://localhost:${config.port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const cerrar = () => cf.kill();
    process.on('SIGINT', () => {
      cerrar();
      console.log('\nTúnel cerrado.');
      process.exit(0);
    });
    process.on('exit', cerrar);
    let url = '';
    let conectado = false;
    const lector = (d: Buffer) => {
      const t = d.toString();
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(t);
      if (m) url = m[0];
      if (/Registered tunnel connection/i.test(t)) conectado = true;
      if (url && conectado) resolve(url);
    };
    cf.stdout.on('data', lector);
    cf.stderr.on('data', lector);
    cf.on('error', (e) => reject(new Error(`No se pudo ejecutar cloudflared: ${e.message}`)));
    cf.on('exit', (c) => reject(new Error(`cloudflared terminó (código ${c})`)));
    setTimeout(() => reject(new Error('cloudflared no se conectó en 90 s')), 90_000);
  });
}

/** Un intento de registro; devuelve null si salió bien o el motivo del error. */
async function intentarRegistro(url: string): Promise<string | null> {
  if (!PRODUCCION) {
    const p = new URLSearchParams({
      object: 'whatsapp_business_account',
      callback_url: url,
      fields: 'messages',
      verify_token: config.whatsapp.verifyToken,
      include_values: 'true',
      access_token: `${APP_ID}|${config.whatsapp.appSecret}`,
    });
    const r = await fetch(`${API}/${APP_ID}/subscriptions`, { method: 'POST', body: p });
    if (!r.ok) return `app: ${JSON.stringify(await r.json())}`;
  }
  const r = await fetch(`${API}/${config.whatsapp.phoneNumberId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhook_configuration: { override_callback_uri: url, verify_token: config.whatsapp.verifyToken } }),
  });
  return r.ok ? null : `número: ${JSON.stringify(await r.json())}`;
}

async function registrarEnMeta(url: string) {
  let error: string | null = null;
  for (let i = 1; i <= 12; i++) {
    error = await intentarRegistro(url);
    if (!error) return;
    process.stdout.write(i === 1 ? 'Esperando a que Meta pueda llegar al túnel' : '.');
    await espera(5000);
  }
  salir(`Meta no pudo verificar el webhook. Último error: ${error}`);
}

await comprobarRequisitos();
console.log('Abriendo túnel con cloudflared…');
const base = await abrirTunel().catch((e) => salir(e.message));
const webhook = `${base}${RUTA}`;
console.log(`Dirección pública: ${base}`);
await espera(3000);
await registrarEnMeta(webhook);
console.log(`\n✔ Webhook registrado en Meta: ${webhook}`);
console.log(PRODUCCION ? `  (solo para el número de prueba; la app sigue apuntando a producción: ${PRODUCCION})` : '  (para la app y para el número de prueba)');
console.log('\nYa puedes escribirle al chatbot desde WhatsApp. Deja esta ventana abierta; Ctrl+C para cerrar el túnel.');
