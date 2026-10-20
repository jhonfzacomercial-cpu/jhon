import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appWithLogin, insertSnapshot, resetData, seedProfile, testDb } from './helpers.js';
import { CollectorWorker } from '../src/worker/worker.js';
import { silentLogger } from '../src/worker/logger.js';
import { CollectionError } from '../src/providers/errors.js';
import { DEFAULT_SETTINGS, saveSettings } from '../src/core/settings.js';
import type { FetchOptions, ProfileFetchResult, ProfileProvider } from '../src/providers/types.js';
import { META_CAPABILITIES } from '../src/providers/meta.js';
import { evaluateProfileAlerts, resolveAlertManually } from '../src/core/alerts.js';
import { DAY, HOUR } from '../src/core/time.js';

// Fonte simulada: cada chamada consome a próxima resposta da fila.
class FakeProvider implements ProfileProvider {
  readonly id = 'meta_business_discovery' as const;
  readonly displayName = 'Fake';
  readonly isDemo = false;
  readonly capabilities = META_CAPABILITIES;
  queue: (ProfileFetchResult | CollectionError)[] = [];
  calls: { username: string; opts: FetchOptions }[] = [];
  configStatus() {
    return { configured: true, missing: [], instructions: [] };
  }
  async fetchProfile(username: string, opts: FetchOptions) {
    this.calls.push({ username, opts });
    const next = this.queue.shift();
    if (!next) throw new Error('fila vazia');
    if (next instanceof CollectionError) throw next;
    return next;
  }
}

function ok(followers: number | null, observedAt: Date, media: ProfileFetchResult['media'] = []): ProfileFetchResult {
  return {
    profile: { externalId: 'ext-1', username: 'x', fullName: 'X', profilePictureUrl: null, followersCount: followers, followsCount: 10, mediaCount: 3 },
    media,
    mediaHasMore: false,
    observedAt,
    requestsMade: 1,
  };
}

let db: pg.Pool;
let clock: Date;
const now = () => clock;

function worker(provider: ProfileProvider, workerId = 'w1') {
  return new CollectorWorker({ db, log: silentLogger, providerFor: () => provider, workerId, now, random: () => 0.5 });
}

async function runOnce(w: CollectorWorker) {
  const n = await w.tick();
  await w.drain();
  return n;
}

const profileRow = async (id: string) => (await db.query('SELECT * FROM instagram_profiles WHERE id = $1', [id])).rows[0];

beforeAll(async () => {
  db = await testDb();
});
beforeEach(async () => {
  await resetData(db);
  clock = new Date('2026-10-20T15:00:00Z');
});
afterAll(async () => {
  await db.end();
});

describe('3. coleta e persistência de snapshot', () => {
  it('grava snapshot imutável, publicações e reagenda', async () => {
    const { profileId } = await seedProfile(db, 'fza');
    const p = new FakeProvider();
    p.queue.push(
      ok(1000, clock, [
        { externalId: 'm1', permalink: 'https://www.instagram.com/p/1/', mediaType: 'image', sourceMediaType: 'IMAGE', publishedAt: new Date('2026-10-19T12:00:00Z'), caption: 'a', thumbnailUrl: null, likeCount: 1, commentsCount: 0 },
        { externalId: 'm2', permalink: 'https://www.instagram.com/p/2/', mediaType: 'video', sourceMediaType: 'VIDEO', publishedAt: new Date('2026-10-10T12:00:00Z'), caption: 'b', thumbnailUrl: null, likeCount: 1, commentsCount: 0 },
      ]),
    );
    expect(await runOnce(worker(p))).toBe(1);

    const prof = await profileRow(profileId);
    expect(prof.profile_state).toBe('ok');
    expect(prof.current_followers).toBe(1000);
    expect(prof.last_success_at.toISOString()).toBe(clock.toISOString());
    expect(prof.next_collection_at.getTime()).toBe(clock.getTime() + 60 * 60_000);
    expect(prof.external_id).toBe('ext-1');
    const snaps = (await db.query('SELECT * FROM follower_snapshots WHERE profile_id = $1', [profileId])).rows;
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ followers_count: 1000, source: 'meta_business_discovery', validity: 'valid' });
    await expect(db.query('UPDATE follower_snapshots SET followers_count = 1 WHERE profile_id = $1', [profileId])).rejects.toThrow(/imutável/);

    // Mesma publicação em nova coleta não duplica.
    clock = new Date(clock.getTime() + 2 * HOUR);
    p.queue.push(ok(1010, clock, [
      { externalId: 'm1', permalink: 'https://www.instagram.com/p/1/', mediaType: 'image', sourceMediaType: 'IMAGE', publishedAt: new Date('2026-10-19T12:00:00Z'), caption: 'a', thumbnailUrl: null, likeCount: 5, commentsCount: 0 },
    ]));
    await db.query(`UPDATE instagram_profiles SET manual_requested_at = now()`);
    await runOnce(worker(p));
    const media = (await db.query('SELECT external_id, like_count, first_seen_at, last_seen_at FROM media_items ORDER BY external_id')).rows;
    expect(media).toHaveLength(2);
    expect(media[0].like_count).toBe(5);
    expect(media[0].first_seen_at.getTime()).toBeLessThan(media[0].last_seen_at.getTime());
    expect((await db.query('SELECT count(*)::int AS n FROM follower_snapshots')).rows[0].n).toBe(2);
  });

  it('respeita o intervalo de mídia: não pede publicações a cada coleta', async () => {
    await seedProfile(db, 'fza');
    const p = new FakeProvider();
    p.queue.push(ok(1000, clock), ok(1001, clock));
    await runOnce(worker(p));
    clock = new Date(clock.getTime() + 61 * 60_000);
    await runOnce(worker(p));
    expect(p.calls.map((c) => c.opts.includeMedia)).toEqual([true, false]);
  });
});

describe('6/7. falhas não apagam dados e respeitam limites', () => {
  it('falha de coleta mantém o último valor válido', async () => {
    const { profileId } = await seedProfile(db, 'fza');
    const p = new FakeProvider();
    p.queue.push(ok(1000, clock), new CollectionError('SOURCE_UNAVAILABLE', 'fora do ar'));
    await runOnce(worker(p));
    const lastSuccess = (await profileRow(profileId)).last_success_at;

    clock = new Date(clock.getTime() + 61 * 60_000);
    await runOnce(worker(p));
    const prof = await profileRow(profileId);
    expect(prof.current_followers).toBe(1000);
    expect(prof.last_success_at.getTime()).toBe(lastSuccess.getTime());
    expect(prof.consecutive_failures).toBe(1);
    expect(prof.last_error_code).toBe('SOURCE_UNAVAILABLE');
    expect(prof.profile_state).toBe('ok');
    expect((await db.query('SELECT count(*)::int AS n FROM follower_snapshots')).rows[0].n).toBe(1);
    const run = (await db.query(`SELECT * FROM collection_runs ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(run).toMatchObject({ status: 'failed', error_code: 'SOURCE_UNAVAILABLE' });
    // Backoff: base 60 s, 1ª falha, jitter 0,5 -> 45 s.
    expect(prof.next_collection_at.getTime() - clock.getTime()).toBe(45_000);
  });

  it('coleta sem total de seguidores não grava zero', async () => {
    const { profileId } = await seedProfile(db, 'fza');
    const p = new FakeProvider();
    p.queue.push(ok(null, clock));
    await runOnce(worker(p));
    const prof = await profileRow(profileId);
    expect(prof.current_followers).toBeNull();
    expect(prof.last_success_at).toBeNull();
    expect((await db.query('SELECT count(*)::int AS n FROM follower_snapshots')).rows[0].n).toBe(0);
    expect((await db.query(`SELECT status FROM collection_runs`)).rows[0].status).toBe('partial');
  });

  it('limite de requisições: pausa a fonte e tenta de novo depois do prazo', async () => {
    const { profileId } = await seedProfile(db, 'fza');
    await seedProfile(db, 'outro');
    const p = new FakeProvider();
    p.queue.push(new CollectionError('RATE_LIMITED', 'limite', { retryAfterMs: 20 * 60_000 }));
    await saveSettings(db, { maxConcurrency: 1 }, null);
    await runOnce(worker(p));

    const pause = (await db.query('SELECT * FROM provider_state')).rows[0];
    expect(pause.paused_until.getTime()).toBe(clock.getTime() + 20 * 60_000);
    const first = (await db.query(`SELECT username::text, next_collection_at FROM instagram_profiles WHERE last_error_code IS NOT NULL`)).rows[0];
    expect(first.next_collection_at.getTime()).toBeGreaterThanOrEqual(clock.getTime() + 20 * 60_000);

    // Durante a pausa nada é coletado.
    clock = new Date(clock.getTime() + 5 * 60_000);
    expect(await runOnce(worker(p))).toBe(0);

    // Depois da pausa, volta a coletar.
    clock = new Date(clock.getTime() + 30 * 60_000);
    p.queue.push(ok(1000, clock), ok(2000, clock));
    await saveSettings(db, { maxConcurrency: 2 }, null);
    expect(await runOnce(worker(p))).toBe(2);
    expect((await profileRow(profileId)).consecutive_failures).toBe(0);
  });

  it('respeita a cota de requisições por hora', async () => {
    for (const u of ['a1', 'a2', 'a3']) await seedProfile(db, u);
    await saveSettings(db, { maxRequestsPerHour: 2, maxConcurrency: 5 }, null);
    const p = new FakeProvider();
    p.queue.push(ok(1, clock), ok(2, clock), ok(3, clock));
    expect(await runOnce(worker(p))).toBe(2);
    expect(await runOnce(worker(p))).toBe(0);
  });

  it('erro permanente não se repete indefinidamente', async () => {
    const { profileId } = await seedProfile(db, 'sumiu');
    const p = new FakeProvider();
    for (let i = 0; i < 3; i++) {
      p.queue.push(new CollectionError('PROFILE_NOT_FOUND_OR_PERSONAL', 'não achou'));
      await db.query(`UPDATE instagram_profiles SET next_collection_at = $1`, [clock]);
      await runOnce(worker(p));
    }
    const prof = await profileRow(profileId);
    expect(prof.profile_state).toBe('not_found_or_personal');
    expect(prof.permanent_failures).toBe(3);
    expect(prof.next_collection_at).toBeNull();
    clock = new Date(clock.getTime() + 30 * DAY);
    expect(await runOnce(worker(p))).toBe(0);
  });
});

describe('11. persistência após reiniciar o worker', () => {
  it('lease expirado é retomado e execução interrompida vira "abandonada"', async () => {
    const { profileId } = await seedProfile(db, 'fza');
    const crashed = worker(new FakeProvider(), 'w-crash');
    const claimed = await crashed.claim(5);
    expect(claimed).toHaveLength(1);
    await db.query(
      `INSERT INTO collection_runs (profile_id, source, trigger, worker_id, started_at) VALUES ($1, 'meta_business_discovery', 'scheduled', 'w-crash', $2)`,
      [profileId, clock],
    );

    // Novo processo antes do vencimento do lease: não pega o perfil.
    const p = new FakeProvider();
    p.queue.push(ok(1000, clock));
    const fresh = worker(p, 'w-new');
    expect(await runOnce(fresh)).toBe(0);

    // Após o vencimento do lease (10 min) e da janela de abandono (15 min).
    clock = new Date(clock.getTime() + 16 * 60_000);
    await fresh.housekeeping();
    expect((await db.query(`SELECT status FROM collection_runs WHERE worker_id = 'w-crash'`)).rows[0].status).toBe('abandoned');
    expect(await runOnce(fresh)).toBe(1);
    expect((await profileRow(profileId)).current_followers).toBe(1000);
  });

  it('pedido manual sobrevive ao reinício e tem prioridade', async () => {
    await seedProfile(db, 'agendado');
    const { profileId } = await seedProfile(db, 'manual');
    await db.query(`UPDATE instagram_profiles SET next_collection_at = now() + interval '1 day', manual_requested_at = $2 WHERE id = $1`, [profileId, clock]);
    await db.query(`UPDATE instagram_profiles SET next_collection_at = $1 WHERE username = 'agendado'`, [clock]);
    await saveSettings(db, { maxConcurrency: 1 }, null);
    const p = new FakeProvider();
    p.queue.push(ok(5, clock));
    await runOnce(worker(p, 'depois-do-restart'));
    expect(p.calls[0].username).toBe('manual');
  });

  it('cliente pausado não é coletado', async () => {
    await seedProfile(db, 'pausado', { status: 'paused' });
    expect(await runOnce(worker(new FakeProvider()))).toBe(0);
  });
});

describe('9. alertas', () => {
  it('gera, deduplica, resolve automaticamente, silencia e reabre', async () => {
    const { profileId } = await seedProfile(db, 'fza');
    const settings = { ...DEFAULT_SETTINGS, defaultNegativeChangeThreshold: 50, alertCooldownHours: 24 };
    await db.query(`UPDATE instagram_profiles SET profile_state = 'ok', last_success_at = $1 WHERE id = $2`, [clock, profileId]);
    await insertSnapshot(db, profileId, new Date(clock.getTime() - 7 * DAY), 1000);
    await insertSnapshot(db, profileId, clock, 900);

    await evaluateProfileAlerts(db, profileId, settings, clock);
    await evaluateProfileAlerts(db, profileId, settings, clock);
    let alerts = (await db.query(`SELECT * FROM alerts WHERE type = 'negative_change'`)).rows;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ status: 'open', occurrences: 2, category: 'profile' });

    // Resolução manual silencia por 24 h mesmo com a condição ativa.
    const user = (await db.query(`INSERT INTO users (email, name, role, password_hash) VALUES ('a@a.a','a','admin','x') RETURNING id`)).rows[0];
    expect(await resolveAlertManually(db, alerts[0].id, user.id, 24, clock)).toBe(true);
    clock = new Date(clock.getTime() + HOUR);
    await evaluateProfileAlerts(db, profileId, settings, clock);
    expect((await db.query(`SELECT count(*)::int AS n FROM alerts WHERE status = 'open'`)).rows[0].n).toBe(0);

    // Após o silêncio, a condição persistente reabre como novo alerta ligado ao anterior.
    clock = new Date(clock.getTime() + 24 * HOUR);
    await db.query(`UPDATE instagram_profiles SET last_success_at = $1 WHERE id = $2`, [clock, profileId]);
    await insertSnapshot(db, profileId, new Date(clock.getTime() - 7 * DAY), 1000);
    await insertSnapshot(db, profileId, clock, 900);
    await evaluateProfileAlerts(db, profileId, settings, clock);
    alerts = (await db.query(`SELECT * FROM alerts WHERE type = 'negative_change' ORDER BY created_at`)).rows;
    expect(alerts).toHaveLength(2);
    expect(alerts[1].reopened_from).toBe(alerts[0].id);

    // Condição some -> resolução automática.
    clock = new Date(clock.getTime() + HOUR);
    await insertSnapshot(db, profileId, clock, 1000);
    await evaluateProfileAlerts(db, profileId, settings, clock);
    expect((await db.query(`SELECT status, resolution FROM alerts WHERE id = $1`, [alerts[1].id])).rows[0]).toEqual({ status: 'resolved', resolution: 'auto' });
  });

  it('distingue problema do perfil de problema do coletor', async () => {
    const p = new FakeProvider();
    const a = await seedProfile(db, 'perfil_sumiu');
    const b = await seedProfile(db, 'coletor_falha');
    await saveSettings(db, { alertFailureThreshold: 1, maxConcurrency: 1 }, null);
    p.queue.push(new CollectionError('PROFILE_NOT_FOUND_OR_PERSONAL', 'x'));
    await db.query(`UPDATE instagram_profiles SET next_collection_at = $1::timestamptz + interval '1 day' WHERE id = $2`, [clock, b.profileId]);
    await runOnce(worker(p));
    p.queue.push(new CollectionError('TIMEOUT', 'x'));
    await db.query(`UPDATE instagram_profiles SET next_collection_at = $1 WHERE id = $2`, [clock, b.profileId]);
    await runOnce(worker(p));
    const rows = (await db.query(`SELECT a.type, a.category, p.username::text FROM alerts a JOIN instagram_profiles p ON p.id = a.profile_id ORDER BY 3`)).rows;
    expect(rows).toEqual([
      { type: 'collection_failing', category: 'collector', username: 'coletor_falha' },
      { type: 'profile_unavailable', category: 'profile', username: 'perfil_sumiu' },
    ]);
    expect(a.profileId).toBeTruthy();
  });

  it('sem publicações além do limite, só quando a mídia foi coletada', async () => {
    const { profileId } = await seedProfile(db, 'fza');
    await db.query(`UPDATE instagram_profiles SET profile_state = 'ok', last_success_at = $1 WHERE id = $2`, [clock, profileId]);
    await db.query(
      `INSERT INTO media_items (profile_id, external_id, dedupe_key, media_type, published_at, source) VALUES ($1, 'm', 'm', 'image', $2, 'x')`,
      [profileId, new Date(clock.getTime() - 10 * DAY)],
    );
    const settings = { ...DEFAULT_SETTINGS, defaultInactivityDays: 7 };
    await evaluateProfileAlerts(db, profileId, settings, clock);
    expect((await db.query(`SELECT count(*)::int AS n FROM alerts WHERE type = 'no_posts'`)).rows[0].n).toBe(0);
    await db.query(`UPDATE instagram_profiles SET last_media_success_at = $1, media_coverage_start = 'epoch' WHERE id = $2`, [clock, profileId]);
    await evaluateProfileAlerts(db, profileId, settings, clock);
    expect((await db.query(`SELECT type, category FROM alerts`)).rows).toEqual([{ type: 'no_posts', category: 'profile' }]);
  });
});

describe('API: cadastro, segurança e consultas', () => {
  it('1/2. cadastra normalizando o @ e impede duplicidade', async () => {
    const { app, headers } = await appWithLogin(db, 'analyst', now);
    const r1 = await app.inject({ method: 'POST', url: '/api/clients', headers, payload: { name: 'FZA', instagram: 'https://www.instagram.com/Grupo.FZA/' } });
    expect(r1.statusCode).toBe(201);
    expect(r1.json().username).toBe('grupo.fza');
    const r2 = await app.inject({ method: 'POST', url: '/api/clients', headers, payload: { name: 'Outro', instagram: '@GRUPO.FZA' } });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().message).toContain('já está cadastrado');
    const r3 = await app.inject({ method: 'POST', url: '/api/clients', headers, payload: { name: 'X', instagram: 'instagram.com/p/abc' } });
    expect(r3.statusCode).toBe(400);
    await app.close();
  });

  it('10. rotas protegidas, papéis, CSRF e segredos', async () => {
    const { app, headers } = await appWithLogin(db, 'viewer', now);
    expect((await app.inject({ method: 'GET', url: '/api/clients' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/overview' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/clients', headers })).statusCode).toBe(200);
    // Visualizador não altera dados.
    expect((await app.inject({ method: 'POST', url: '/api/clients', headers, payload: { name: 'a', instagram: 'a' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: '/api/settings', headers, payload: {} })).statusCode).toBe(403);
    // Sem o cabeçalho CSRF ou com origem estranha: bloqueado.
    const noCsrf = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: headers.cookie } });
    expect(noCsrf.statusCode).toBe(403);
    const evil = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...headers, origin: 'https://evil.example' } });
    expect(evil.statusCode).toBe(403);
    // Configurações nunca devolvem o token.
    process.env.META_ACCESS_TOKEN = 'EAAtokenquenaopodevazar123456789';
    const s = await app.inject({ method: 'GET', url: '/api/settings', headers });
    expect(s.statusCode).toBe(200);
    expect(s.body).not.toContain('EAAtokenquenaopodevazar');
    delete process.env.META_ACCESS_TOKEN;
    // Cabeçalhos de segurança.
    expect(s.headers['content-security-policy']).toContain("default-src 'self'");
    expect(s.headers['x-frame-options']).toBeDefined();
    await app.close();
  });

  it('login: senha errada, bloqueio após tentativas e cookie seguro', async () => {
    const { app } = await appWithLogin(db, 'admin', now);
    const bad = () =>
      app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-fza-csrf': '1' }, payload: { email: 'admin@fza.test', password: 'errada' } });
    const r = await bad();
    expect(r.statusCode).toBe(401);
    expect(r.json().message).toBe('E-mail ou senha incorretos.');
    for (let i = 0; i < 4; i++) await bad();
    const good = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-fza-csrf': '1' }, payload: { email: 'admin@fza.test', password: 'senha-forte-123' } });
    expect(good.statusCode).toBe(401);
    expect(good.json().message).toContain('bloqueada');
    await app.close();
  });

  it('12. consultas por período: série com lacunas e variação do período', async () => {
    const { app, headers } = await appWithLogin(db, 'viewer', now);
    const { clientId, profileId } = await seedProfile(db, 'fza');
    await db.query(`UPDATE instagram_profiles SET profile_state = 'ok', current_followers = 1100, last_success_at = $1 WHERE id = $2`, [clock, profileId]);
    // 12/10 e 13/10 com coleta, 14/10 sem, 15/10 com coleta (horários em UTC−4 meio-dia).
    await insertSnapshot(db, profileId, new Date('2026-10-12T16:00:00Z'), 1000);
    await insertSnapshot(db, profileId, new Date('2026-10-13T16:00:00Z'), 1010);
    await insertSnapshot(db, profileId, new Date('2026-10-15T16:00:00Z'), 1030);
    await insertSnapshot(db, profileId, new Date('2026-10-20T14:00:00Z'), 1100);

    const r = await app.inject({ method: 'GET', url: `/api/clients/${clientId}/series?from=2026-10-12&to=2026-10-15`, headers });
    expect(r.statusCode).toBe(200);
    expect(r.json().series.map((p: { followers: number | null }) => p.followers)).toEqual([1000, 1010, null, 1030]);
    expect(r.json().series.map((p: { change: number | null }) => p.change)).toEqual([null, 10, null, null]);

    const d = await app.inject({ method: 'GET', url: `/api/clients/${clientId}`, headers });
    expect(d.statusCode).toBe(200);
    const body = d.json();
    expect(body.growth.lastVsPrevious).toMatchObject({ absolute: 70 });
    expect(body.summary.change7d).toMatchObject({ absolute: 100, percent: 10 });
    expect(body.summary.change30d).toMatchObject({ absolute: null, unavailable: 'insufficient_history' });
    expect(body.posting.available).toBe(false);

    const o = await app.inject({ method: 'GET', url: '/api/overview?from=2026-10-12&to=2026-10-20', headers });
    expect(o.statusCode).toBe(200);
    const ov = o.json();
    expect(ov.kpis.portfolioFollowers).toBe(1100);
    expect(ov.kpis.changes.d7).toMatchObject({ absolute: 100, profilesIncluded: 1 });
    expect(ov.kpis.changes.d30.absolute).toBeNull();
    expect(ov.charts.portfolio.find((p: { day: string }) => p.day === '2026-10-14').followers).toBeNull();

    const csv = await app.inject({ method: 'GET', url: '/api/export/snapshots.csv', headers });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\r\n').filter(Boolean)).toHaveLength(5);
    await app.close();
  });

  it('arquivar exige confirmação e preserva o histórico; exclusão definitiva só para admin', async () => {
    const { app, headers } = await appWithLogin(db, 'admin', now);
    const { clientId, profileId } = await seedProfile(db, 'fza');
    await insertSnapshot(db, profileId, clock, 10);
    expect((await app.inject({ method: 'POST', url: `/api/clients/${clientId}/archive`, headers, payload: { confirmUsername: 'errado' } })).statusCode).toBe(400);
    const a = await app.inject({ method: 'POST', url: `/api/clients/${clientId}/archive`, headers, payload: { confirmUsername: '@fza' } });
    expect(a.json()).toMatchObject({ ok: true, retentionDays: 180 });
    expect((await db.query('SELECT count(*)::int AS n FROM follower_snapshots')).rows[0].n).toBe(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/clients/${clientId}`, headers, payload: { confirmUsername: 'fza', confirmText: 'sim' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/clients/${clientId}`, headers, payload: { confirmUsername: 'fza', confirmText: 'EXCLUIR DEFINITIVAMENTE' } })).statusCode).toBe(200);
    expect((await db.query('SELECT count(*)::int AS n FROM follower_snapshots')).rows[0].n).toBe(0);
    await app.close();
  });
});
