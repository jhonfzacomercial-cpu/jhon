import type pg from 'pg';
import { withTransaction } from '../db/pool.js';
import { evaluateProfileAlerts } from '../core/alerts.js';
import { coverageStartFromFetch } from '../core/posting.js';
import type { Settings } from '../core/settings.js';
import { profileUrl } from '../core/username.js';
import { CollectionError, redactSecrets, toCollectionError } from '../providers/errors.js';
import type { ProfileFetchResult, ProfileProvider } from '../providers/types.js';
import { backoffMs } from './backoff.js';
import type { Logger } from './logger.js';

// Coleta de um perfil: chama a fonte, persiste snapshot e publicações e reagenda.
// Regras de integridade:
// - Uma falha nunca grava zero, nunca apaga histórico e nunca altera last_success_at nem current_*.
// - Snapshots são imutáveis; cada coleta bem-sucedida gera um novo registro.

export interface ClaimedProfile {
  id: string;
  username: string;
  manual_requested_at: Date | null;
  last_media_success_at: Date | null;
  consecutive_failures: number;
  permanent_failures: number;
  current_followers: number | null;
}

// Variação brusca demais entre coletas próximas é marcada como "suspeita" e fica fora dos cálculos.
export function suspectReason(prev: number | null, curr: number, hoursApart: number | null): string | null {
  if (prev == null || prev < 1000) return null;
  const change = Math.abs(curr - prev) / prev;
  if (change >= 0.5 && (hoursApart == null || hoursApart <= 48)) {
    return `Variação de ${(change * 100).toFixed(0)}% em ${hoursApart?.toFixed(1) ?? '?'} h em relação à coleta anterior`;
  }
  return null;
}

export async function collectProfile(
  db: pg.Pool,
  provider: ProfileProvider,
  profile: ClaimedProfile,
  settings: Settings,
  opts: { workerId: string; log: Logger; now?: () => Date; random?: () => number },
): Promise<'success' | 'partial' | 'failed'> {
  const now = opts.now ?? (() => new Date());
  const trigger = profile.manual_requested_at ? 'manual' : 'scheduled';
  const mediaDue =
    trigger === 'manual' ||
    !profile.last_media_success_at ||
    now().getTime() - profile.last_media_success_at.getTime() >= settings.mediaIntervalMinutes * 60_000;

  const run = await db.query<{ id: number }>(
    `INSERT INTO collection_runs (profile_id, source, trigger, worker_id, attempt, media_requested, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [profile.id, provider.id, trigger, opts.workerId, profile.consecutive_failures + 1, mediaDue, now()],
  );
  const runId = run.rows[0].id;
  const started = Date.now();

  let result: ProfileFetchResult;
  try {
    result = await provider.fetchProfile(profile.username, { includeMedia: mediaDue, mediaLimit: settings.mediaFetchLimit });
  } catch (err) {
    const e = toCollectionError(err);
    await recordFailure(db, provider, profile, settings, runId, e, started, now(), opts.random);
    opts.log.warn('collection_failed', { profile: profile.username, runId, code: e.code, msg: redactSecrets(e.message) });
    await evaluateProfileAlerts(db, profile.id, settings, now()).catch((ae) =>
      opts.log.error('alert_eval_failed', { profile: profile.username, err: (ae as Error).message }),
    );
    return 'failed';
  }

  try {
    const status = await persistSuccess(db, provider, profile, settings, runId, result, started, now());
    opts.log.info('collection_ok', {
      profile: profile.username,
      runId,
      status,
      followers: result.profile.followersCount,
      media: result.media?.length ?? null,
    });
    await evaluateProfileAlerts(db, profile.id, settings, now()).catch((ae) =>
      opts.log.error('alert_eval_failed', { profile: profile.username, err: (ae as Error).message }),
    );
    return status;
  } catch (err) {
    const e = new CollectionError('PERSISTENCE_ERROR', 'Falha ao gravar a coleta no banco.', {
      detail: { error: (err as Error).message },
    });
    await recordFailure(db, provider, profile, settings, runId, e, started, now(), opts.random).catch(() => undefined);
    opts.log.error('persistence_failed', { profile: profile.username, runId, err: (err as Error).message });
    return 'failed';
  }
}

async function persistSuccess(
  db: pg.Pool,
  provider: ProfileProvider,
  profile: ClaimedProfile,
  settings: Settings,
  runId: number,
  r: ProfileFetchResult,
  started: number,
  now: Date,
): Promise<'success' | 'partial'> {
  return withTransaction(db, async (tx) => {
    let records = 0;
    let mediaNew = 0;
    const partialReasons: string[] = [];

    // Snapshot (somente se a fonte devolveu o total de seguidores).
    if (r.profile.followersCount != null) {
      const prev = (
        await tx.query<{ followers_count: number; observed_at: Date }>(
          `SELECT followers_count, observed_at FROM follower_snapshots
            WHERE profile_id = $1 AND validity = 'valid' AND followers_count IS NOT NULL
            ORDER BY observed_at DESC LIMIT 1`,
          [profile.id],
        )
      ).rows[0];
      const hours = prev ? (r.observedAt.getTime() - prev.observed_at.getTime()) / 3_600_000 : null;
      const suspect = suspectReason(prev?.followers_count ?? null, r.profile.followersCount, hours);
      await tx.query(
        `INSERT INTO follower_snapshots
           (profile_id, followers_count, follows_count, media_count, observed_at, collected_at, source, validity, validity_reason, run_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          profile.id,
          r.profile.followersCount,
          r.profile.followsCount,
          r.profile.mediaCount,
          r.observedAt,
          now,
          provider.id,
          suspect ? 'suspect' : 'valid',
          suspect,
          runId,
        ],
      );
      records++;
      if (suspect) partialReasons.push(`snapshot marcado como suspeito: ${suspect}`);
    } else {
      partialReasons.push('a fonte não retornou o total de seguidores');
    }

    // Publicações: deduplicadas pelo id da fonte; sem id, pelo permalink.
    let coverageUpdate: Date | null = null;
    if (r.media) {
      const latestKnown = (
        await tx.query<{ max: Date | null }>('SELECT max(published_at) AS max FROM media_items WHERE profile_id = $1', [profile.id])
      ).rows[0].max;
      for (const m of r.media) {
        const dedupeKey = m.externalId ?? (m.permalink ? `permalink:${m.permalink}` : null);
        if (!dedupeKey) continue;
        const ins = await tx.query<{ inserted: boolean }>(
          `INSERT INTO media_items (profile_id, external_id, dedupe_key, permalink, media_type, source_media_type,
                                    published_at, caption, thumbnail_url, like_count, comments_count, source, first_seen_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
           ON CONFLICT (profile_id, dedupe_key) DO UPDATE SET
             last_seen_at = EXCLUDED.last_seen_at,
             permalink = COALESCE(EXCLUDED.permalink, media_items.permalink),
             published_at = COALESCE(media_items.published_at, EXCLUDED.published_at),
             caption = COALESCE(EXCLUDED.caption, media_items.caption),
             thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, media_items.thumbnail_url),
             like_count = COALESCE(EXCLUDED.like_count, media_items.like_count),
             comments_count = COALESCE(EXCLUDED.comments_count, media_items.comments_count)
           RETURNING (xmax = 0) AS inserted`,
          [
            profile.id,
            m.externalId,
            dedupeKey,
            m.permalink,
            m.mediaType,
            m.sourceMediaType,
            m.publishedAt,
            m.caption,
            m.thumbnailUrl,
            m.likeCount,
            m.commentsCount,
            provider.id,
            now,
          ],
        );
        records++;
        if (ins.rows[0]?.inserted) mediaNew++;
      }
      const fetchCoverage = coverageStartFromFetch(r.media, r.mediaHasMore);
      if (fetchCoverage) {
        // Se a lista nova não alcança a publicação mais recente já conhecida, houve um buraco
        // (ex.: worker parado e muitas publicações no período): a cobertura recomeça aqui.
        const overlaps = !latestKnown || !r.mediaHasMore || fetchCoverage.getTime() <= latestKnown.getTime();
        coverageUpdate = fetchCoverage;
        await tx.query(
          `UPDATE instagram_profiles SET media_coverage_start =
             CASE WHEN $3 AND media_coverage_start IS NOT NULL THEN LEAST(media_coverage_start, $2) ELSE $2 END
           WHERE id = $1`,
          [profile.id, coverageUpdate, overlaps],
        );
      }
    }

    // Perfil: estado ok, último valor válido e próxima coleta.
    const nextAt = new Date(now.getTime() + settings.followersIntervalMinutes * 60_000);
    await tx.query(
      `UPDATE instagram_profiles SET
         profile_state = 'ok', state_reason = NULL, source = $2,
         full_name = COALESCE($3, full_name),
         profile_picture_url = COALESCE($4, profile_picture_url),
         canonical_url = $5,
         current_followers = COALESCE($6, current_followers),
         current_follows = COALESCE($7, current_follows),
         current_media_count = COALESCE($8, current_media_count),
         last_attempt_at = $9,
         last_success_at = CASE WHEN $6::int IS NOT NULL THEN $10 ELSE last_success_at END,
         last_media_success_at = CASE WHEN $11 THEN $10 ELSE last_media_success_at END,
         consecutive_failures = 0, permanent_failures = 0,
         last_error_code = NULL, last_error_message = NULL,
         next_collection_at = $12, manual_requested_at = NULL, lease_owner = NULL, lease_until = NULL,
         updated_at = $9
       WHERE id = $1`,
      [
        profile.id,
        provider.id,
        r.profile.fullName,
        r.profile.profilePictureUrl,
        profileUrl(profile.username),
        r.profile.followersCount,
        r.profile.followsCount,
        r.profile.mediaCount,
        now,
        r.observedAt,
        r.media != null,
        nextAt,
      ],
    );
    if (r.profile.externalId) {
      // O id externo é único; se outro perfil já o tem (ex.: @ trocado e recadastrado), não sobrescreve.
      await tx.query(
        `UPDATE instagram_profiles SET external_id = $2 WHERE id = $1
           AND NOT EXISTS (SELECT 1 FROM instagram_profiles WHERE external_id = $2 AND id <> $1)`,
        [profile.id, r.profile.externalId],
      );
    }

    const status = partialReasons.length ? 'partial' : 'success';
    await tx.query(
      `UPDATE collection_runs SET finished_at = $2, status = $3, records_processed = $4, media_new = $5,
              duration_ms = $6, error_message = $7 WHERE id = $1`,
      [runId, now, status, records, mediaNew, Date.now() - started, partialReasons.join('; ') || null],
    );
    return status;
  });
}

async function recordFailure(
  db: pg.Pool,
  provider: ProfileProvider,
  profile: ClaimedProfile,
  settings: Settings,
  runId: number,
  e: CollectionError,
  started: number,
  now: Date,
  random?: () => number,
): Promise<void> {
  const failures = profile.consecutive_failures + 1;
  let nextAt: Date | null;
  let profileState: string | null = null;
  let permanentFailures = profile.permanent_failures;

  if (e.code === 'PROFILE_NOT_FOUND_OR_PERSONAL' || e.code === 'PROFILE_PRIVATE_OR_UNAVAILABLE') {
    profileState = e.code === 'PROFILE_NOT_FOUND_OR_PERSONAL' ? 'not_found_or_personal' : 'private';
    permanentFailures++;
    // Não repete indefinidamente: após N falhas permanentes, sai do agendamento até nova tentativa manual.
    nextAt = permanentFailures >= settings.maxPermanentFailures ? null : new Date(now.getTime() + settings.permanentRetryHours * 3_600_000);
  } else if (e.code === 'PERMANENT_FAILURE' || e.code === 'UNSUPPORTED_FIELD') {
    permanentFailures++;
    nextAt = permanentFailures >= settings.maxPermanentFailures ? null : new Date(now.getTime() + settings.permanentRetryHours * 3_600_000);
  } else {
    const delay = Math.max(
      e.retryAfterMs ?? 0,
      backoffMs(failures, settings.retryBaseSeconds * 1000, settings.retryMaxMinutes * 60_000, random),
    );
    nextAt = new Date(now.getTime() + delay);
  }

  // Problemas da fonte que afetam todos os perfis pausam a fonte inteira.
  if (e.code === 'RATE_LIMITED' || e.code === 'PROVIDER_AUTH_FAILED' || e.code === 'NOT_CONFIGURED') {
    const pauseMs = e.code === 'RATE_LIMITED' ? Math.max(e.retryAfterMs ?? 0, 15 * 60_000) : 30 * 60_000;
    await db.query(
      `INSERT INTO provider_state (provider, paused_until, reason, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider) DO UPDATE SET paused_until = GREATEST(provider_state.paused_until, EXCLUDED.paused_until),
         reason = EXCLUDED.reason, updated_at = EXCLUDED.updated_at`,
      [provider.id, new Date(now.getTime() + pauseMs), e.code, now],
    );
  }

  const message = redactSecrets(e.message).slice(0, 500);
  await withTransaction(db, async (tx) => {
    await tx.query(
      `UPDATE collection_runs SET finished_at = $2, status = 'failed', error_code = $3, error_message = $4, duration_ms = $5
        WHERE id = $1`,
      [runId, now, e.code, message, Date.now() - started],
    );
    await tx.query(
      `UPDATE instagram_profiles SET
         last_attempt_at = $2, consecutive_failures = $3, permanent_failures = $4,
         last_error_code = $5, last_error_message = $6,
         profile_state = COALESCE($7, CASE WHEN profile_state = 'pending' AND $8 THEN 'error' ELSE profile_state END),
         state_reason = CASE WHEN $7::text IS NOT NULL THEN $6 ELSE state_reason END,
         next_collection_at = $9, manual_requested_at = NULL, lease_owner = NULL, lease_until = NULL, updated_at = $2
       WHERE id = $1`,
      [profile.id, now, failures, permanentFailures, e.code, message, profileState, nextAt === null, nextAt],
    );
  });
}
