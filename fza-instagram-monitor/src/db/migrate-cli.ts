import { getPool } from './pool.js';
import { migrate } from './migrate.js';

const pool = getPool();
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Migrações aplicadas: ${applied.join(', ')}` : 'Banco já está atualizado.');
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
