import pg from 'pg';
import { env } from '../config/env.js';

// int8 (bigserial, count(*)) chega como string; convertemos quando cabe com segurança.
pg.types.setTypeParser(20, (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v;
});
// numeric -> number
pg.types.setTypeParser(1700, (v) => Number(v));

export type Db = pg.Pool;
export type DbClient = pg.PoolClient | pg.Pool;

let pool: pg.Pool | undefined;

export function createPool(connectionString: string, ssl = false): pg.Pool {
  const p = new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  p.on('error', (err) => {
    // Erros de conexões ociosas não podem derrubar o processo.
    console.error(JSON.stringify({ level: 'error', msg: 'pg pool error', err: err.message }));
  });
  return p;
}

export function getPool(): pg.Pool {
  if (!pool) {
    const e = env();
    pool = createPool(e.DATABASE_URL, e.DATABASE_SSL === 'true');
  }
  return pool;
}

export function setPool(p: pg.Pool): void {
  pool = p;
}

export async function withTransaction<T>(db: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
