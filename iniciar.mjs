// Levanta todo el SGIM con un solo comando (desde la raíz):  npm run dev
//   1. backend (puerto 3000)  →  espera a que /api/salud responda
//   2. túnel de cloudflared + registro del webhook en Meta (npm run tunel)
//   3. frontend (puerto 5173)
// Opciones:  npm run dev -- --sin-tunel   (solo backend y frontend, sin tocar el webhook de WhatsApp)
// Ctrl + C cierra los tres procesos. Sin dependencias: solo Node.
import { spawn, execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const conTunel = !process.argv.includes('--sin-tunel');
const COLORES = { backend: '\x1b[36m', tunel: '\x1b[35m', frontend: '\x1b[32m', sgim: '\x1b[33m' };
const procesos = [];

function log(nombre, texto) {
  for (const linea of String(texto).split(/\r?\n/)) {
    if (linea.trim()) console.log(`${COLORES[nombre]}[${nombre}]\x1b[0m ${linea}`);
  }
}

function lanzar(nombre, carpeta, script) {
  const p = spawn(`npm run ${script}`, { cwd: path.join(raiz, carpeta), shell: true, env: { ...process.env, FORCE_COLOR: '1' } });
  p.stdout.on('data', (d) => log(nombre, d));
  p.stderr.on('data', (d) => log(nombre, d));
  p.on('exit', (codigo) => {
    log('sgim', `${nombre} terminó (código ${codigo ?? 'señal'})`);
    if (nombre === 'backend' && !cerrando) cerrar(1); // sin backend no tiene sentido seguir
  });
  procesos.push(p);
  return p;
}

async function esperarBackend(segundos = 60) {
  for (let i = 0; i < segundos; i++) {
    try {
      const r = await fetch('http://localhost:3000/api/salud');
      if (r.ok) return true;
    } catch { /* todavía no levanta */ }
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  return false;
}

let cerrando = false;
function cerrar(codigo = 0) {
  if (cerrando) return;
  cerrando = true;
  log('sgim', 'Cerrando backend, túnel y frontend...');
  for (const p of procesos) {
    if (p.exitCode !== null) continue;
    try {
      // En Windows hay que matar el árbol completo (npm → node → cloudflared)
      if (process.platform === 'win32') execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' });
      else p.kill('SIGTERM');
    } catch { /* ya terminó */ }
  }
  setTimeout(() => process.exit(codigo), 500);
}
process.on('SIGINT', () => cerrar(0));
process.on('SIGTERM', () => cerrar(0));

// Primera vez en una PC: sin backend/.env no hay base configurada
if (!existsSync(path.join(raiz, 'backend', '.env'))) {
  log('sgim', 'Falta backend/.env. Primero crea la base con:  powershell -NoProfile -ExecutionPolicy Bypass -File .\\database\\setup.ps1');
  log('sgim', 'y luego agrega las claves de WhatsApp y Gemini (guía: backend/.env.example).');
  process.exit(1);
}
// Primera vez: instala las dependencias que falten
for (const carpeta of ['backend', 'frontend']) {
  if (!existsSync(path.join(raiz, carpeta, 'node_modules'))) {
    log('sgim', `Instalando dependencias de ${carpeta} (solo la primera vez)...`);
    execSync('npm install --no-audit --no-fund', { cwd: path.join(raiz, carpeta), stdio: 'inherit' });
  }
}
if (!existsSync(path.join(raiz, 'frontend', '.env'))) {
  copyFileSync(path.join(raiz, 'frontend', '.env.example'), path.join(raiz, 'frontend', '.env'));
  log('sgim', 'Se creó frontend/.env a partir de frontend/.env.example');
}

log('sgim', `Iniciando SGIM${conTunel ? '' : ' (sin túnel)'}...`);
lanzar('backend', 'backend', 'dev');
if (!(await esperarBackend())) {
  log('sgim', 'El backend no respondió en 60 s. Revisa que PostgreSQL esté encendido (ECONNREFUSED 5432) y backend/.env.');
  cerrar(1);
} else {
  log('sgim', 'Backend listo en http://localhost:3000');
  if (conTunel) lanzar('tunel', 'backend', 'tunel');
  lanzar('frontend', 'frontend', 'dev');
  log('sgim', 'Panel: http://localhost:5173   ·   Ctrl + C para cerrar todo');
}
