import { env } from '../config/env.js';
import { migrate } from '../db/migrate.js';
import { getPool } from '../db/pool.js';
import { activeProvider } from '../providers/registry.js';
import { createLogger } from './logger.js';
import { CollectorWorker } from './worker.js';

const e = env();
const log = createLogger({ service: 'worker' });
const db = getPool();

await migrate(db);
const worker = new CollectorWorker({ db, log, providerFor: activeProvider, workerId: e.WORKER_ID });
worker.start(e.WORKER_POLL_SECONDS);

let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutdown_signal', { signal: sig });
    const force = setTimeout(() => process.exit(1), 60_000);
    await worker.stop();
    await db.end();
    clearTimeout(force);
    process.exit(0);
  });
}
