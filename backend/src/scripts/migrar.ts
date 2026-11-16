// Aplica las migraciones database/04_*.sql en adelante (son idempotentes).
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db.js';

const dir = path.resolve('..', 'database');
const archivos = (await fs.readdir(dir)).filter((f) => /^\d{2}_migracion.*\.sql$/.test(f)).sort();
for (const f of archivos) {
  await pool.query(await fs.readFile(path.join(dir, f), 'utf8'));
  console.log(`Aplicada: ${f}`);
}
await pool.end();
