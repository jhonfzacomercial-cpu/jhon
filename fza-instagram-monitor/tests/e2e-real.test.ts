import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { resetData, seedProfile, testDb } from './helpers.js';
import { MetaBusinessDiscoveryProvider } from '../src/providers/meta.js';
import { CollectorWorker } from '../src/worker/worker.js';
import { createLogger } from '../src/worker/logger.js';

// Teste de ponta a ponta com a API REAL da Meta e um perfil profissional público real.
// Só roda quando as credenciais são fornecidas, em um banco de teste separado:
//   META_IG_USER_ID=... META_ACCESS_TOKEN=... META_E2E_USERNAME=<perfil> npx vitest run tests/e2e-real.test.ts
// Faz 1 (uma) requisição, dentro do limite da Meta.
const username = process.env.META_E2E_USERNAME;
const run = Boolean(username && process.env.META_IG_USER_ID && process.env.META_ACCESS_TOKEN);

describe.skipIf(!run)('E2E real: Meta Business Discovery', () => {
  let db: pg.Pool;
  beforeAll(async () => {
    db = await testDb();
    await resetData(db);
  });
  afterAll(async () => {
    await db.end();
  });

  it('cadastra, coleta dados reais e persiste snapshot e publicações', async () => {
    const { profileId } = await seedProfile(db, username!.toLowerCase());
    const provider = new MetaBusinessDiscoveryProvider({
      apiVersion: process.env.META_GRAPH_API_VERSION ?? 'v25.0',
      igUserId: process.env.META_IG_USER_ID,
      accessToken: process.env.META_ACCESS_TOKEN,
      appSecret: process.env.META_APP_SECRET,
    });
    const worker = new CollectorWorker({ db, log: createLogger({ test: 'e2e' }), providerFor: () => provider, workerId: 'e2e' });
    expect(await worker.tick()).toBe(1);
    await worker.drain();

    const run = (await db.query('SELECT status, error_code, error_message FROM collection_runs')).rows[0];
    expect(run, JSON.stringify(run)).toMatchObject({ status: 'success' });
    const snap = (await db.query('SELECT * FROM follower_snapshots WHERE profile_id = $1', [profileId])).rows[0];
    expect(snap.followers_count).toBeGreaterThan(0);
    expect(snap.source).toBe('meta_business_discovery');
    const media = (await db.query('SELECT media_type, published_at, permalink FROM media_items WHERE profile_id = $1 ORDER BY published_at DESC', [profileId])).rows;
    console.log(JSON.stringify({ followers: snap.followers_count, media: media.length, latest: media[0] }, null, 2));
    expect(media.every((m) => m.published_at instanceof Date)).toBe(true);
  });
});
