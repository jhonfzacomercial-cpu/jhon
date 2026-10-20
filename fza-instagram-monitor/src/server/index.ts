import { env } from '../config/env.js';
import { migrate } from '../db/migrate.js';
import { getPool } from '../db/pool.js';
import { buildApp } from './app.js';

const e = env();
const db = getPool();
await migrate(db);
const app = await buildApp({ db, env: e });
await app.listen({ port: e.PORT, host: e.HOST });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
