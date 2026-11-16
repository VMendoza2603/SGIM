// Deja la base como recién instalada: borra incidentes, conversaciones y auditoría,
// restaura las contraseñas temporales de los usuarios de prueba y vuelve a cargar 03_demo.sql.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`TRUNCATE incidente, notificacion, mensaje, conversacion, auditoria, sesion, token_recuperacion RESTART IDENTITY CASCADE`);
  await client.query(`DELETE FROM usuario WHERE telefono_wa = '593900000006'`);
  await client.query(
    `UPDATE usuario SET password_hash = crypt('Sgim2026*', gen_salt('bf', 12)), debe_cambiar_pwd = TRUE,
            intentos_fallidos = 0, bloqueado_hasta = NULL
      WHERE correo LIKE '%@sgim.test'`,
  );
  await client.query(`UPDATE tecnico SET disponible = TRUE`);
  await client.query(`SELECT setval('seq_codigo_incidente', 1, false)`);
  await client.query(await fs.readFile(path.resolve('..', 'database', '03_demo.sql'), 'utf8'));
  await client.query('COMMIT');
  console.log('Base reiniciada con los datos de demostración.');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
  await pool.end();
}
