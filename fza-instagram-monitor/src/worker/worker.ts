import os from 'node:os';
import type pg from 'pg';
import { evaluateProfileAlerts } from '../core/alerts.js';
import { loadSettings, type Settings } from '../core/settings.js';
import { CollectionError } from '../providers/errors.js';
import type { ProfileProvider } from '../providers/types.js';
import { collectProfile, type ClaimedProfile } from './collector.js';
import type { Logger } from './logger.js';

// Worker de coleta, independente da interface web.
// A fila é a própria tabela instagram_profiles (next_collection_at / manual_requested_at),
// durável no PostgreSQL. Cada perfil é "arrendado" (lease) por quem o processa; se o worker
// cair, o lease expira e outro ciclo retoma o perfil. Vários workers podem rodar em paralelo
// (FOR UPDATE SKIP LOCKED).

export const LEASE_MINUTES = 10;
export const ABANDONED_RUN_MINUTES = 15;

export interface WorkerDeps {
  db: pg.Pool;
  log: Logger;
  providerFor: (s: Settings) => ProfileProvider | null;
  workerId?: string;
  now?: () => Date;
  random?: () => number;
}

export class CollectorWorker {
  readonly workerId: string;
  private inFlight = new Set<Promise<unknown>>();
  private stopping = false;
  private timers: NodeJS.Timeout[] = [];
  private lastTickAt: Date | null = null;
  private lastHousekeepingAt: Date | null = null;
  private lastStatus = 'starting';
  private readonly startedAt: Date;

  constructor(private readonly deps: WorkerDeps) {
    this.workerId = deps.workerId ?? `${os.hostname()}-${process.pid}`;
    this.startedAt = this.now();
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  // Um ciclo: reivindica perfis vencidos (respeitando concorrência e cota/hora) e coleta.
  async tick(): Promise<number> {
    const { db, log } = this.deps;
    const settings = await loadSettings(db);
    const provider = this.deps.providerFor(settings);
    this.lastTickAt = this.now();
    if (!provider) {
      this.lastStatus = 'no_provider';
      return 0;
    }
    const cfg = provider.configStatus();
    if (!cfg.configured) {
      this.lastStatus = 'provider_not_configured';
      return 0;
    }

    const paused = (
      await db.query<{ paused_until: Date; reason: string }>(
        'SELECT paused_until, reason FROM provider_state WHERE provider = $1 AND paused_until > $2',
        [provider.id, this.now()],
      )
    ).rows[0];
    if (paused) {
      this.lastStatus = `provider_paused:${paused.reason}`;
      return 0;
    }

    const used = (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM collection_runs WHERE source = $1 AND started_at > $2::timestamptz - interval '1 hour'`,
        [provider.id, this.now()],
      )
    ).rows[0].n;
    const budget = settings.maxRequestsPerHour - used;
    const slots = Math.min(settings.maxConcurrency - this.inFlight.size, budget);
    if (budget <= 0) this.lastStatus = 'hourly_budget_exhausted';
    else this.lastStatus = 'running';
    if (slots <= 0 || this.stopping) return 0;

    const claimed = await this.claim(slots);
    for (const p of claimed) {
      const job = collectProfile(db, provider, p, settings, {
        workerId: this.workerId,
        log,
        now: this.deps.now,
        random: this.deps.random,
      })
        .catch((err) => log.error('collect_unhandled', { profile: p.username, err: (err as Error).message }))
        .finally(() => this.inFlight.delete(job));
      this.inFlight.add(job);
    }
    return claimed.length;
  }

  async claim(limit: number): Promise<ClaimedProfile[]> {
    const now = this.now();
    const { rows } = await this.deps.db.query<ClaimedProfile>(
      `WITH due AS (
         SELECT p.id FROM instagram_profiles p JOIN clients c ON c.id = p.client_id
          WHERE c.status = 'active'
            AND (p.manual_requested_at IS NOT NULL OR (p.next_collection_at IS NOT NULL AND p.next_collection_at <= $1))
            AND (p.lease_until IS NULL OR p.lease_until < $1)
          ORDER BY (p.manual_requested_at IS NULL), p.manual_requested_at, p.next_collection_at
          LIMIT $2
          FOR UPDATE OF p SKIP LOCKED)
       UPDATE instagram_profiles p
          SET lease_owner = $3, lease_until = $1::timestamptz + make_interval(mins => $4)
         FROM due WHERE p.id = due.id
       RETURNING p.id, p.username::text AS username, p.manual_requested_at, p.last_media_success_at,
                 p.consecutive_failures, p.permanent_failures, p.current_followers`,
      [now, limit, this.workerId, LEASE_MINUTES],
    );
    return rows;
  }

  async drain(): Promise<void> {
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight]);
  }

  // Manutenção: execuções abandonadas, alertas por tempo, retenção.
  async housekeeping(): Promise<void> {
    const { db, log } = this.deps;
    const settings = await loadSettings(db);
    const now = this.now();
    this.lastHousekeepingAt = now;

    const abandoned = await db.query(
      `UPDATE collection_runs SET status = 'abandoned', finished_at = $1,
              error_code = 'PERMANENT_FAILURE', error_message = 'Execução interrompida (worker reiniciado ou travado).'
        WHERE status = 'running' AND started_at < $1::timestamptz - make_interval(mins => $2)`,
      [now, ABANDONED_RUN_MINUTES],
    );
    if (abandoned.rowCount) log.warn('runs_abandoned', { count: abandoned.rowCount });

    await db.query('DELETE FROM sessions WHERE expires_at < $1', [now]);

    // Alertas que dependem do relógio (dados desatualizados, dias sem publicar).
    const profiles = (await db.query<{ id: string }>(`SELECT id FROM instagram_profiles`)).rows;
    for (const p of profiles) {
      await evaluateProfileAlerts(db, p.id, settings, now).catch((err) =>
        log.error('alert_eval_failed', { profileId: p.id, err: (err as Error).message }),
      );
    }

    // Retenção: clientes arquivados cujo prazo venceu são excluídos definitivamente.
    const purged = await db.query<{ id: string; name: string }>(
      `DELETE FROM clients WHERE status = 'archived' AND purge_after IS NOT NULL AND purge_after < $1 RETURNING id, name`,
      [now],
    );
    for (const c of purged.rows) {
      await db.query(
        `INSERT INTO audit_log (action, entity, entity_id, details) VALUES ('purge_retention', 'client', $1, $2::jsonb)`,
        [c.id, JSON.stringify({ name: c.name })],
      );
      log.info('client_purged_by_retention', { clientId: c.id });
    }
    await db.query(
      `DELETE FROM collection_runs WHERE started_at < $1::timestamptz - make_interval(days => $2) AND status <> 'running'`,
      [now, settings.collectionRunRetentionDays],
    );
    if (settings.snapshotRetentionDays != null) {
      await db.query(`DELETE FROM follower_snapshots WHERE observed_at < $1::timestamptz - make_interval(days => $2)`, [
        now,
        settings.snapshotRetentionDays,
      ]);
    }
  }

  async heartbeat(): Promise<void> {
    await this.deps.db.query(
      `INSERT INTO worker_heartbeats (worker_id, started_at, last_heartbeat_at, version, info)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (worker_id) DO UPDATE SET last_heartbeat_at = EXCLUDED.last_heartbeat_at, info = EXCLUDED.info`,
      [
        this.workerId,
        this.startedAt,
        this.now(),
        process.env.npm_package_version ?? null,
        JSON.stringify({
          status: this.lastStatus,
          inFlight: this.inFlight.size,
          lastTickAt: this.lastTickAt?.toISOString() ?? null,
          lastHousekeepingAt: this.lastHousekeepingAt?.toISOString() ?? null,
        }),
      ],
    );
  }

  start(pollSeconds: number): void {
    const { log } = this.deps;
    const safe = (name: string, fn: () => Promise<unknown>) => () =>
      fn().catch((err) => log.error(`${name}_failed`, { err: err instanceof CollectionError ? err.code : (err as Error).message }));
    // Recuperação após reinício: execuções 'running' antigas viram 'abandoned' e leases expirados são retomados.
    void safe('housekeeping', () => this.housekeeping())();
    void safe('heartbeat', () => this.heartbeat())();
    this.timers.push(setInterval(safe('tick', () => this.tick()), pollSeconds * 1000));
    this.timers.push(setInterval(safe('heartbeat', () => this.heartbeat()), 30_000));
    this.timers.push(setInterval(safe('housekeeping', () => this.housekeeping()), 5 * 60_000));
    log.info('worker_started', { workerId: this.workerId, pollSeconds });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const t of this.timers) clearInterval(t);
    await this.drain();
    await this.deps.db
      .query(
        `UPDATE worker_heartbeats SET info = info || '{"status":"stopped"}'::jsonb, last_heartbeat_at = now() WHERE worker_id = $1`,
        [this.workerId],
      )
      .catch(() => undefined);
    this.deps.log.info('worker_stopped', { workerId: this.workerId });
  }
}
