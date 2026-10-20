import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.js';
import { loadSettings } from '../../core/settings.js';
import { normalizeUsername, profileUrl } from '../../core/username.js';
import { bestWorstDaily, dailySeries, lastVsPrevious, UNAVAILABLE_LABEL, usable } from '../../core/growth.js';
import { diagnose } from '../../core/diagnosis.js';
import { loadSnapshots, profilePosting } from '../../core/analytics.js';
import { DAY, addDays, dayKey } from '../../core/time.js';
import { activeProvider } from '../../providers/registry.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { loadSummaries, type ProfileSummary } from '../services.js';

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), schema.nullable()).optional();

const clientFields = {
  name: z.string().trim().min(1, 'Informe o nome do cliente.').max(120),
  category: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
  notes: z.string().trim().max(2000).nullable().optional().transform((v) => v || null),
  postingGoalPerWeek: optionalNumber(z.coerce.number().min(0).max(100)),
  inactivityAlertDays: optionalNumber(z.coerce.number().int().min(1).max(365)),
  negativeChangeThreshold: optionalNumber(z.coerce.number().int().min(1).max(10_000_000)),
  growthGoalPct30d: optionalNumber(z.coerce.number().min(-100).max(1000)),
};

const createSchema = z.object({ ...clientFields, instagram: z.string().max(300) });
const updateSchema = z.object({ ...clientFields, instagram: z.string().max(300) }).partial();
const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'active', 'paused', 'archived', 'attention']).default('all'),
  sort: z.enum(['name', 'followers', 'change7d', 'change30d', 'lastSuccess', 'alerts']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).optional(),
});

function sortValue(s: ProfileSummary, key: string): number | string | null {
  switch (key) {
    case 'followers':
      return s.currentFollowers;
    case 'change7d':
      return s.change7d.absolute;
    case 'change30d':
      return s.change30d.absolute;
    case 'lastSuccess':
      return s.lastSuccessAt;
    case 'alerts':
      return s.openAlerts;
    default:
      return s.clientName.toLocaleLowerCase('pt-BR');
  }
}

export function needsAttention(s: ProfileSummary): boolean {
  return s.clientStatus === 'active' && (s.profileState !== 'ok' || s.stale || s.consecutiveFailures > 0 || s.openAlerts > 0);
}

export async function registerClientRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get('/api/clients', async (req) => {
    const q = listQuery.parse(req.query);
    const settings = await loadSettings(db);
    let items = await loadSummaries(db, settings, app.clock(), { includeArchived: q.status === 'archived' || q.status === 'all' });
    if (q.search) {
      const term = q.search.toLocaleLowerCase('pt-BR').replace(/^@/, '');
      items = items.filter((s) => s.clientName.toLocaleLowerCase('pt-BR').includes(term) || s.username.includes(term));
    }
    if (q.status === 'attention') items = items.filter(needsAttention);
    else if (q.status !== 'all') items = items.filter((s) => s.clientStatus === q.status);

    // Valores ausentes sempre ao final, independentemente da direção.
    items.sort((a, b) => {
      const va = sortValue(a, q.sort);
      const vb = sortValue(b, q.sort);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return q.dir === 'asc' ? cmp : -cmp;
    });
    const pageSize = q.pageSize ?? settings.pageSize;
    const total = items.length;
    return {
      items: items.slice((q.page - 1) * pageSize, q.page * pageSize),
      total,
      page: q.page,
      pageSize,
    };
  });

  app.post('/api/clients', { preHandler: requireRole('analyst') }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const u = normalizeUsername(body.instagram);
    if (!u.ok) return reply.code(400).send({ error: 'validation', message: u.error, issues: [{ path: 'instagram', message: u.error }] });

    const existing = (
      await db.query<{ client_name: string; status: string }>(
        `SELECT c.name AS client_name, c.status FROM instagram_profiles p JOIN clients c ON c.id = p.client_id WHERE p.username = $1`,
        [u.username],
      )
    ).rows[0];
    if (existing) {
      const message =
        existing.status === 'archived'
          ? `@${u.username} já está cadastrado no cliente arquivado "${existing.client_name}". Restaure-o em vez de cadastrar de novo.`
          : `@${u.username} já está cadastrado no cliente "${existing.client_name}".`;
      return reply.code(409).send({ error: 'duplicate', message });
    }

    const created = await withTransaction(db, async (tx) => {
      const c = (
        await tx.query<{ id: string }>(
          `INSERT INTO clients (name, category, notes, posting_goal_per_week, inactivity_alert_days, negative_change_threshold, growth_goal_pct_30d)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [body.name, body.category, body.notes, body.postingGoalPerWeek ?? null, body.inactivityAlertDays ?? null,
           body.negativeChangeThreshold ?? null, body.growthGoalPct30d ?? null],
        )
      ).rows[0];
      // Primeira coleta é priorizada como manual.
      await tx.query(
        `INSERT INTO instagram_profiles (client_id, username, canonical_url, next_collection_at, manual_requested_at)
         VALUES ($1, $2, $3, now(), now())`,
        [c.id, u.username, profileUrl(u.username)],
      );
      return c;
    }).catch((err) => {
      if ((err as { code?: string }).code === '23505') return null;
      throw err;
    });
    if (!created) return reply.code(409).send({ error: 'duplicate', message: `@${u.username} já está cadastrado.` });
    await audit(db, req.user!.id, 'create', 'client', created.id, { username: u.username, name: body.name });
    return reply.code(201).send({ id: created.id, username: u.username });
  });

  app.patch('/api/clients/:id', { preHandler: requireRole('analyst') }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = updateSchema.parse(req.body);
    const current = (await db.query(`SELECT p.id, p.username::text AS username FROM instagram_profiles p WHERE p.client_id = $1`, [id])).rows[0];
    if (!current) return reply.code(404).send({ error: 'not_found', message: 'Cliente não encontrado.' });

    let newUsername: string | null = null;
    if (body.instagram !== undefined) {
      const u = normalizeUsername(body.instagram);
      if (!u.ok) return reply.code(400).send({ error: 'validation', message: u.error, issues: [{ path: 'instagram', message: u.error }] });
      if (u.username !== current.username) newUsername = u.username;
    }

    const sets: string[] = [];
    const vals: unknown[] = [id];
    const map: Record<string, string> = {
      name: 'name',
      category: 'category',
      notes: 'notes',
      postingGoalPerWeek: 'posting_goal_per_week',
      inactivityAlertDays: 'inactivity_alert_days',
      negativeChangeThreshold: 'negative_change_threshold',
      growthGoalPct30d: 'growth_goal_pct_30d',
    };
    for (const [k, col] of Object.entries(map)) {
      if ((body as Record<string, unknown>)[k] !== undefined) {
        vals.push((body as Record<string, unknown>)[k]);
        sets.push(`${col} = $${vals.length}`);
      }
    }

    try {
      await withTransaction(db, async (tx) => {
        if (sets.length) await tx.query(`UPDATE clients SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
        if (newUsername) {
          // Troca de @ (ex.: perfil mudou de nome). O histórico permanece ligado ao mesmo perfil.
          await tx.query(
            `UPDATE instagram_profiles SET username = $2, canonical_url = $3, profile_state = 'pending', state_reason = NULL,
                    permanent_failures = 0, next_collection_at = now(), manual_requested_at = now(), updated_at = now()
              WHERE id = $1`,
            [current.id, newUsername, profileUrl(newUsername)],
          );
        }
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'duplicate', message: `@${newUsername} já está cadastrado em outro cliente.` });
      }
      throw err;
    }
    await audit(db, req.user!.id, 'update', 'client', id, { fields: Object.keys(body), newUsername, previousUsername: newUsername ? current.username : undefined });
    return { ok: true };
  });

  const setStatus = (status: 'active' | 'paused', action: string) =>
    async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
      const { id } = idParam.parse(req.params);
      const { rowCount } = await db.query(
        `UPDATE clients SET status = $2, updated_at = now() WHERE id = $1 AND status IN ('active', 'paused')`,
        [id, status],
      );
      if (!rowCount) return reply.code(404).send({ error: 'not_found', message: 'Cliente não encontrado ou arquivado.' });
      if (status === 'active') {
        await db.query(`UPDATE instagram_profiles SET next_collection_at = LEAST(COALESCE(next_collection_at, now()), now()) WHERE client_id = $1`, [id]);
      }
      await audit(db, req.user!.id, action, 'client', id);
      return { ok: true };
    };
  app.post('/api/clients/:id/pause', { preHandler: requireRole('analyst') }, setStatus('paused', 'pause'));
  app.post('/api/clients/:id/resume', { preHandler: requireRole('analyst') }, setStatus('active', 'resume'));

  // "Excluir" = arquivar: para a coleta e oculta o cliente, mantendo o histórico até o fim do prazo de retenção.
  app.post('/api/clients/:id/archive', { preHandler: requireRole('analyst') }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { confirmUsername } = z.object({ confirmUsername: z.string() }).parse(req.body);
    const settings = await loadSettings(db);
    const p = (await db.query(`SELECT username::text AS username FROM instagram_profiles WHERE client_id = $1`, [id])).rows[0];
    if (!p) return reply.code(404).send({ error: 'not_found', message: 'Cliente não encontrado.' });
    if (confirmUsername.replace(/^@/, '').toLowerCase() !== p.username) {
      return reply.code(400).send({ error: 'confirmation', message: 'Digite o @ do perfil para confirmar.' });
    }
    await db.query(
      `UPDATE clients SET status = 'archived', archived_at = now(),
              purge_after = now() + make_interval(days => $2), updated_at = now() WHERE id = $1`,
      [id, settings.archivedClientRetentionDays],
    );
    await db.query(
      `UPDATE alerts SET status = 'resolved', resolved_at = now(), resolution = 'auto'
        WHERE profile_id IN (SELECT id FROM instagram_profiles WHERE client_id = $1) AND status IN ('open', 'acknowledged')`,
      [id],
    );
    await audit(db, req.user!.id, 'archive', 'client', id, { retentionDays: settings.archivedClientRetentionDays });
    return { ok: true, retentionDays: settings.archivedClientRetentionDays };
  });

  app.post('/api/clients/:id/restore', { preHandler: requireRole('analyst') }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { rowCount } = await db.query(
      `UPDATE clients SET status = 'paused', archived_at = NULL, purge_after = NULL, updated_at = now()
        WHERE id = $1 AND status = 'archived'`,
      [id],
    );
    if (!rowCount) return reply.code(404).send({ error: 'not_found', message: 'Cliente arquivado não encontrado.' });
    await audit(db, req.user!.id, 'restore', 'client', id);
    return { ok: true, status: 'paused' };
  });

  // Exclusão definitiva e irreversível: só administradores, só de clientes já arquivados, com dupla confirmação.
  app.delete('/api/clients/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ confirmUsername: z.string(), confirmText: z.string() }).parse(req.body);
    const row = (
      await db.query(
        `SELECT c.status, c.name, p.username::text AS username FROM clients c JOIN instagram_profiles p ON p.client_id = c.id WHERE c.id = $1`,
        [id],
      )
    ).rows[0];
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'Cliente não encontrado.' });
    if (row.status !== 'archived') {
      return reply.code(409).send({ error: 'not_archived', message: 'Arquive o cliente antes de excluí-lo definitivamente.' });
    }
    if (body.confirmUsername.replace(/^@/, '').toLowerCase() !== row.username || body.confirmText !== 'EXCLUIR DEFINITIVAMENTE') {
      return reply.code(400).send({ error: 'confirmation', message: 'Confirmação incorreta.' });
    }
    await db.query('DELETE FROM clients WHERE id = $1', [id]);
    await audit(db, req.user!.id, 'purge', 'client', id, { name: row.name, username: row.username });
    return { ok: true };
  });

  app.post('/api/clients/:id/collect', { preHandler: requireRole('analyst'), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { rowCount } = await db.query(
      `UPDATE instagram_profiles p SET manual_requested_at = now(), permanent_failures = 0,
              next_collection_at = COALESCE(next_collection_at, now())
         FROM clients c WHERE c.id = p.client_id AND c.id = $1 AND c.status = 'active'`,
      [id],
    );
    if (!rowCount) return reply.code(409).send({ error: 'not_active', message: 'Só é possível coletar clientes ativos.' });
    const settings = await loadSettings(db);
    const provider = activeProvider(settings);
    const paused = provider
      ? (await db.query(`SELECT paused_until, reason FROM provider_state WHERE provider = $1 AND paused_until > now()`, [provider.id])).rows[0]
      : null;
    await audit(db, req.user!.id, 'manual_collect', 'client', id);
    return {
      ok: true,
      message: !provider || !provider.configStatus().configured
        ? 'Pedido registrado, mas nenhuma fonte de dados está configurada: a coleta não será executada até a configuração.'
        : paused
          ? `Pedido registrado. A fonte está pausada até ${paused.paused_until.toISOString()} (${paused.reason}).`
          : 'Pedido registrado. O worker processará a coleta em instantes.',
    };
  });

  app.get('/api/clients/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const settings = await loadSettings(db);
    const now = app.clock();
    const summary = (await loadSummaries(db, settings, now, { clientId: id, includeArchived: true }))[0];
    if (!summary) return reply.code(404).send({ error: 'not_found', message: 'Cliente não encontrado.' });

    const prof = (await db.query(`SELECT * FROM instagram_profiles WHERE id = $1`, [summary.profileId])).rows[0];
    const snaps = await loadSnapshots(db, summary.profileId, new Date(now.getTime() - 120 * DAY));
    const tz = settings.displayTimezone;
    const today = dayKey(now, tz);
    const series90 = dailySeries(snaps, addDays(today, -89), today, tz);
    const { media, stats } = await profilePosting(db, prof, now);
    const latestSnap = (
      await db.query(
        `SELECT followers_count, follows_count, media_count, observed_at, collected_at, source, validity, validity_reason
           FROM follower_snapshots WHERE profile_id = $1 ORDER BY observed_at DESC LIMIT 1`,
        [summary.profileId],
      )
    ).rows[0];
    const counts = (
      await db.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE validity = 'suspect')::int AS suspect, min(observed_at) AS first
           FROM follower_snapshots WHERE profile_id = $1`,
        [summary.profileId],
      )
    ).rows[0];
    const provider = activeProvider(settings);

    return {
      summary,
      growth: {
        lastVsPrevious: lastVsPrevious(snaps),
        change7d: summary.change7d,
        change30d: summary.change30d,
        bestWorst90d: bestWorstDaily(series90),
        snapshotsTotal: counts.total,
        snapshotsSuspect: counts.suspect,
        historyStartedAt: counts.first ? counts.first.toISOString() : null,
        unavailableLabels: UNAVAILABLE_LABEL,
      },
      latestSnapshot: latestSnap
        ? {
            followers: latestSnap.followers_count,
            follows: latestSnap.follows_count,
            mediaCount: latestSnap.media_count,
            observedAt: latestSnap.observed_at.toISOString(),
            collectedAt: latestSnap.collected_at.toISOString(),
            source: latestSnap.source,
            validity: latestSnap.validity,
            validityReason: latestSnap.validity_reason,
            stale: summary.stale,
          }
        : null,
      posting: stats,
      diagnosis: diagnose({
        snapshots: snaps,
        media,
        posting: stats,
        coverageStart: prof.media_coverage_start,
        now,
        postingGoalPerWeek: summary.postingGoalPerWeek ?? settings.defaultPostingGoalPerWeek,
        inactivityDays: summary.inactivityAlertDays ?? settings.defaultInactivityDays,
      }),
      validSnapshotsInWindow: usable(snaps).length,
      provider: provider ? { id: provider.id, displayName: provider.displayName, capabilities: provider.capabilities, isDemo: provider.isDemo } : null,
      collection: {
        followersIntervalMinutes: settings.followersIntervalMinutes,
        mediaIntervalMinutes: settings.mediaIntervalMinutes,
        permanentlyStopped: summary.clientStatus === 'active' && summary.nextCollectionAt == null && !summary.manualRequestedAt,
      },
    };
  });

  app.get('/api/clients/:id/series', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
    if (q.from > q.to || Date.parse(q.to) - Date.parse(q.from) > 731 * DAY) {
      return reply.code(400).send({ error: 'validation', message: 'Intervalo inválido (máximo de 2 anos).' });
    }
    const p = (await db.query(`SELECT id FROM instagram_profiles WHERE client_id = $1`, [id])).rows[0];
    if (!p) return reply.code(404).send({ error: 'not_found', message: 'Cliente não encontrado.' });
    const settings = await loadSettings(db);
    // Um dia antes do início para calcular a variação do primeiro dia.
    const snaps = await loadSnapshots(db, p.id, new Date(Date.parse(q.from) - 2 * DAY), new Date(Date.parse(q.to) + 2 * DAY));
    const series = dailySeries(snaps, q.from, q.to, settings.displayTimezone);
    return { series, bestWorst: bestWorstDaily(series), timezone: settings.displayTimezone };
  });

  app.get('/api/clients/:id/snapshots', async (req) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const { rows } = await db.query(
      `SELECT s.id, s.followers_count, s.follows_count, s.media_count, s.observed_at, s.collected_at, s.source, s.validity, s.validity_reason, s.run_id
         FROM follower_snapshots s JOIN instagram_profiles p ON p.id = s.profile_id
        WHERE p.client_id = $1 ORDER BY s.observed_at DESC LIMIT $2`,
      [id, q.limit],
    );
    return { items: rows };
  });

  app.get('/api/clients/:id/history', async (req) => {
    const { id } = idParam.parse(req.params);
    const { rows } = await db.query(
      `SELECT a.id, a.action, a.details, a.created_at, u.name AS user_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.entity = 'client' AND a.entity_id = $1 ORDER BY a.created_at DESC LIMIT 100`,
      [id],
    );
    return { items: rows };
  });
}
