// Carga database/03_demo.sql usando la conexión de backend/.env
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db.js';

const sql = await fs.readFile(path.resolve('..', 'database', '03_demo.sql'), 'utf8');
const client = await pool.connect();
client.on('notice', (n) => console.log(n.message));
await client.query(sql);
client.release();
const { rows } = await pool.query('SELECT count(*)::int AS n FROM incidente');
console.log(`Datos de demostración listos: ${rows[0].n} incidentes.`);
await pool.end();
