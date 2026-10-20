import type { FastifyInstance } from 'fastify';
import { loadSettings, saveSettings, settingsPatchSchema } from '../../core/settings.js';
import { ERROR_INFO } from '../../providers/errors.js';
import { activeProvider, describeProviders } from '../../providers/registry.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';

const WORKER_ALIVE_SECONDS = 120;

export async function registerSettingsRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get('/api/settings', async () => {
    const settings = await loadSettings(db);
    // Nunca devolve tokens: só se estão configurados e o que falta.
    return { settings, providers: describeProviders() };
  });

  app.patch('/api/settings', { preHandler: requireRole('admin') }, async (req, reply) => {
    const patch = settingsPatchSchema.parse(req.body);
    if (patch.activeProvider && !describeProviders().some((p) => p.id === patch.activeProvider)) {
      return reply.code(400).send({ error: 'validation', message: 'Fonte de dados indisponível neste ambiente.' });
    }
    const settings = await saveSettings(db, patch, req.user!.id);
    await audit(db, req.user!.id, 'update', 'settings', null, { keys: Object.keys(patch) });
    return { settings };
  });

  // Estado do worker e da fila: visível para todos os usuários (página Configurações).
  app.get('/api/system/status', async () => {
    const settings = await loadSettings(db);
    const provider = activeProvider(settings);
    const workers = (
      await db.query(
        `SELECT worker_id, started_at, last_heartbeat_at, version, info,
                (last_heartbeat_at > now() - make_interval(secs => $1)) AS alive
           FROM worker_heartbeats ORDER BY last_heartbeat_at DESC LIMIT 10`,
        [WORKER_ALIVE_SECONDS],
      )
    ).rows;
    const queue = (
      await db.query(
        `SELECT
           count(*) FILTER (WHERE c.status = 'active' AND (p.manual_requested_at IS NOT NULL OR p.next_collection_at <= now()))::int AS due,
           count(*) FILTER (WHERE c.status = 'active' AND p.manual_requested_at IS NOT NULL)::int AS manual_pending,
           count(*) FILTER (WHERE c.status = 'active' AND p.next_collection_at IS NULL AND p.manual_requested_at IS NULL)::int AS stopped,
           count(*) FILTER (WHERE p.lease_until > now())::int AS in_progress,
           min(p.next_collection_at) FILTER (WHERE c.status = 'active' AND p.next_collection_at > now()) AS next_scheduled
         FROM instagram_profiles p JOIN clients c ON c.id = p.client_id`,
      )
    ).rows[0];
    const lastRun = (await db.query(`SELECT started_at, finished_at, status FROM collection_runs ORDER BY started_at DESC LIMIT 1`)).rows[0] ?? null;
    const lastSuccess = (await db.query(`SELECT max(last_success_at) AS t FROM instagram_profiles`)).rows[0].t;
    const pause = provider
      ? (await db.query(`SELECT paused_until, reason FROM provider_state WHERE provider = $1 AND paused_until > now()`, [provider.id])).rows[0] ?? null
      : null;
    const usedLastHour = provider
      ? (await db.query(`SELECT count(*)::int AS n FROM collection_runs WHERE source = $1 AND started_at > now() - interval '1 hour'`, [provider.id])).rows[0].n
      : 0;
    return {
      provider: provider
        ? { id: provider.id, displayName: provider.displayName, isDemo: provider.isDemo, config: provider.configStatus() }
        : null,
      providerPause: pause,
      requestsLastHour: usedLastHour,
      maxRequestsPerHour: settings.maxRequestsPerHour,
      workers,
      workerAlive: workers.some((w) => w.alive),
      queue,
      lastRun,
      lastSuccessAt: lastSuccess,
      effectiveFrequency: {
        followersIntervalMinutes: settings.followersIntervalMinutes,
        mediaIntervalMinutes: settings.mediaIntervalMinutes,
        note: 'Não é tempo real: os dados são atualizados conforme estes intervalos e os limites da fonte.',
      },
    };
  });

  // Diagnóstico técnico (administrador).
  app.get('/api/system/diagnostics', { preHandler: requireRole('admin') }, async () => {
    const errorsByCode = (
      await db.query(
        `SELECT error_code, count(*)::int AS n, max(started_at) AS last_at FROM collection_runs
          WHERE status IN ('failed', 'abandoned') AND started_at > now() - interval '7 days'
          GROUP BY error_code ORDER BY n DESC`,
      )
    ).rows.map((r) => ({ ...r, label: ERROR_INFO[r.error_code as keyof typeof ERROR_INFO]?.label ?? r.error_code }));
    const recentErrors = (
      await db.query(
        `SELECT r.id, r.started_at, r.error_code, r.error_message, r.attempt, p.username::text AS username, c.name AS client_name
           FROM collection_runs r JOIN instagram_profiles p ON p.id = r.profile_id JOIN clients c ON c.id = p.client_id
          WHERE r.status IN ('failed', 'abandoned') ORDER BY r.started_at DESC LIMIT 50`,
      )
    ).rows;
    const runStats = (
      await db.query(
        `SELECT status, count(*)::int AS n, avg(duration_ms)::int AS avg_ms FROM collection_runs
          WHERE started_at > now() - interval '24 hours' GROUP BY status`,
      )
    ).rows;
    const stopped = (
      await db.query(
        `SELECT c.id AS client_id, c.name AS client_name, p.username::text AS username, p.last_error_code, p.last_error_message, p.last_attempt_at
           FROM instagram_profiles p JOIN clients c ON c.id = p.client_id
          WHERE c.status = 'active' AND p.next_collection_at IS NULL AND p.manual_requested_at IS NULL`,
      )
    ).rows;
    const db_ = (
      await db.query(
        `SELECT pg_database_size(current_database())::bigint AS size_bytes,
                (SELECT count(*)::int FROM follower_snapshots) AS snapshots,
                (SELECT count(*)::int FROM media_items) AS media,
                (SELECT count(*)::int FROM collection_runs) AS runs,
                (SELECT max(name) FROM schema_migrations) AS last_migration`,
      )
    ).rows[0];
    const providerStates = (await db.query(`SELECT * FROM provider_state ORDER BY provider`)).rows;
    return { errorsByCode, recentErrors, runStats24h: runStats, stoppedProfiles: stopped, database: db_, providerStates };
  });

  app.post('/api/system/provider/resume', { preHandler: requireRole('admin') }, async (req) => {
    await db.query(`UPDATE provider_state SET paused_until = NULL, reason = NULL, updated_at = now()`);
    await audit(db, req.user!.id, 'provider_resume', 'system', null);
    return { ok: true };
  });
}
