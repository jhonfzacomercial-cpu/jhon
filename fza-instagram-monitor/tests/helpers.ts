import pg from 'pg';
import { loadEnv, setEnvForTests } from '../src/config/env.js';
import { createPool, setPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { buildApp } from '../src/server/app.js';
import { hashPassword } from '../src/server/auth.js';

export const env = loadEnv(process.env);
setEnvForTests(env);

let pool: pg.Pool | undefined;

export async function testDb(): Promise<pg.Pool> {
  if (!pool) {
    pool = createPool(env.DATABASE_URL);
    setPool(pool);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  }
  return pool;
}

export async function resetData(db: pg.Pool) {
  await db.query(`TRUNCATE users, sessions, clients, instagram_profiles, follower_snapshots, media_items,
                  collection_runs, alerts, settings, provider_state, worker_heartbeats, audit_log RESTART IDENTITY CASCADE`);
}

export async function createUser(db: pg.Pool, role: 'admin' | 'analyst' | 'viewer', email = `${role}@fza.test`) {
  const password = 'senha-forte-123';
  await db.query(`INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)`, [
    email,
    role,
    role,
    await hashPassword(password),
  ]);
  return { email, password };
}

export async function appWithLogin(db: pg.Pool, role: 'admin' | 'analyst' | 'viewer' = 'admin', now?: () => Date) {
  const app = await buildApp({ db, env, now, webDir: '/nonexistent' });
  const u = await createUser(db, role);
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'x-fza-csrf': '1' },
    payload: { email: u.email, password: u.password },
  });
  if (res.statusCode !== 200) throw new Error(`login falhou: ${res.body}`);
  const cookie = res.headers['set-cookie'] as string;
  const headers = { cookie: cookie.split(';')[0], 'x-fza-csrf': '1' };
  return { app, headers };
}

// Cliente + perfil prontos para coleta.
export async function seedProfile(db: pg.Pool, username: string, opts: { status?: string } = {}) {
  const c = (await db.query(`INSERT INTO clients (name, status) VALUES ($1, $2) RETURNING id`, [`Cliente ${username}`, opts.status ?? 'active'])).rows[0];
  const p = (
    await db.query(`INSERT INTO instagram_profiles (client_id, username, next_collection_at) VALUES ($1, $2, now()) RETURNING id`, [c.id, username])
  ).rows[0];
  return { clientId: c.id as string, profileId: p.id as string };
}

export async function insertSnapshot(db: pg.Pool, profileId: string, observedAt: Date, followers: number | null, validity = 'valid') {
  await db.query(
    `INSERT INTO follower_snapshots (profile_id, followers_count, observed_at, collected_at, source, validity)
     VALUES ($1, $2, $3, $3, 'meta_business_discovery', $4)`,
    [profileId, followers, observedAt, validity],
  );
}
