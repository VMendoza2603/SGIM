/**
 * Instala la base del SGIM desde cero en cualquier PostgreSQL (local, Neon o Supabase), sin psql:
 * 01_schema → 02_seed → migraciones NN_migracion_*.sql → (opcional) 03_demo, y deja fijo el search_path.
 *
 * Uso (PowerShell, desde backend/):
 *   $env:DATABASE_URL = "postgresql://...neon.tech/neondb?sslmode=require"   # la de la base en la nube
 *   npm run db:instalar                # estructura + datos base + equipo técnico
 *   npm run db:instalar -- --demo      # además, los incidentes de ejemplo
 *   npm run db:instalar -- --forzar    # borra el esquema sgim si ya existe y lo crea de nuevo
 * Sin $env:DATABASE_URL usa la de backend/.env.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import 'dotenv/config';

const demo = process.argv.includes('--demo');
const forzar = process.argv.includes('--forzar');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_URL');

const dir = path.resolve('..', 'database');
const migraciones = (await fs.readdir(dir)).filter((f) => /^\d{2}_migracion.*\.sql$/.test(f)).sort();
const archivos = ['01_schema.sql', '02_seed.sql', ...migraciones, ...(demo ? ['03_demo.sql'] : [])];

const c = new pg.Client({ connectionString: url });
await c.connect();
const destino = new URL(url).hostname;
console.log(`Base de destino: ${destino}`);

const { rows } = await c.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'sgim'`);
if (rows.length && !forzar) {
  console.log('El esquema sgim ya existe en esa base. Para borrarlo y crearlo de nuevo usa: npm run db:instalar -- --forzar');
  console.log('Si solo quieres aplicar las migraciones nuevas: npm run db:migrar');
  await c.end();
  process.exit(1);
}
if (rows.length) {
  await c.query('DROP SCHEMA sgim CASCADE');
  console.log('Esquema sgim anterior borrado.');
}

for (const f of archivos) {
  await c.query(await fs.readFile(path.join(dir, f), 'utf8'));
  console.log(`✔ ${f}`);
}
// Las conexiones con pooler (Neon/Supabase) no aceptan "options": el search_path queda fijo en la base
const { rows: bd } = await c.query('SELECT current_database() AS nombre');
await c.query(`ALTER DATABASE "${bd[0].nombre}" SET search_path TO sgim, public`);
const { rows: n } = await c.query(`SELECT count(*)::int AS tablas FROM information_schema.tables WHERE table_schema = 'sgim' AND table_type = 'BASE TABLE'`);
console.log(`\nListo: ${n[0].tablas} tablas en ${destino}${demo ? ' (con los incidentes de ejemplo)' : ''}.`);
await c.end();
