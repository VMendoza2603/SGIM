import pg from 'pg';
import { config } from './config.js';

// Las columnas BIGINT llegan como texto por defecto; los ids caben en number.
pg.types.setTypeParser(20, (v) => Number(v));
// NUMERIC (confianza, horas promedio) como number.
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // En Vercel la base es Neon/Supabase: el search_path queda fijo en la base (lo pone `npm run db:instalar`),
  // porque sus conexiones con pooler no aceptan el parámetro "options". Pocas conexiones por función serverless.
  ...(process.env.VERCEL ? { max: 3 } : { options: '-c search_path=sgim,public' }),
});

export async function query<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
  const { rows } = await pool.query<T>(sql, params);
  return rows;
}

export async function queryOne<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Contexto que leen los triggers de historial y de transiciones (fn_historial_estado, fn_validar_transicion). */
export interface ContextoAuditoria {
  idUsuario: number;
  idRol: number;
  canal?: 'WEB' | 'WHATSAPP' | 'SISTEMA';
  comentario?: string | null;
}

export async function transaccion<T>(ctx: ContextoAuditoria | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (ctx) {
      await client.query(
        `SELECT set_config('sgim.id_usuario', $1, true), set_config('sgim.id_rol', $2, true),
                set_config('sgim.canal', $3, true), set_config('sgim.comentario', $4, true)`,
        [String(ctx.idUsuario), String(ctx.idRol), ctx.canal ?? 'WEB', ctx.comentario ?? ''],
      );
    }
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
