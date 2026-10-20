import type { DbClient } from '../db/pool.js';
import { ERROR_INFO, type ErrorCode } from '../providers/errors.js';
import { loadSnapshots, profilePosting, type ProfileRow } from './analytics.js';
import { periodChange } from './growth.js';
import type { Settings } from './settings.js';
import { DAY } from './time.js';

// Regras de alerta.
// - Deduplicação: no máximo um alerta ativo (aberto ou reconhecido) por perfil e tipo
//   (índice único alerts_active_unique). Coletas repetidas só incrementam "occurrences".
// - Resolução automática quando a condição deixa de existir.
// - Resolução manual silencia o mesmo tipo por alertCooldownHours.
// - Reabertura: se a condição persistir após o silêncio, cria-se um novo alerta ligado ao anterior.

export type AlertType =
  | 'no_posts'
  | 'negative_change'
  | 'low_growth'
  | 'posting_below_goal'
  | 'collection_failing'
  | 'stale_data'
  | 'profile_unavailable';

export interface AlertCandidate {
  type: AlertType;
  category: 'profile' | 'collector';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  details: Record<string, unknown>;
}

interface Context {
  profile: ProfileRow & { client_status: string };
  client: {
    inactivity_alert_days: number | null;
    negative_change_threshold: number | null;
    growth_goal_pct_30d: number | null;
    posting_goal_per_week: number | null;
  };
  settings: Settings;
  now: Date;
}

export async function computeAlertCandidates(db: DbClient, ctx: Context): Promise<AlertCandidate[]> {
  const { profile: p, client: c, settings: s, now } = ctx;
  const out: AlertCandidate[] = [];

  const unavailable = ['not_found_or_personal', 'private', 'unavailable'].includes(p.profile_state);
  if (unavailable) {
    out.push({
      type: 'profile_unavailable',
      category: 'profile',
      severity: 'critical',
      title: `@${p.username} não pôde ser consultado`,
      message:
        p.profile_state === 'not_found_or_personal'
          ? 'A fonte não encontrou o perfil: ele pode não existir, ter mudado de @, ser conta pessoal ou ter restrição de idade.'
          : 'O perfil está privado ou indisponível na fonte.',
      details: { profileState: p.profile_state },
    });
  }

  const errCode = p.last_error_code as ErrorCode | null;
  const collectorError = errCode && ERROR_INFO[errCode]?.category === 'collector';
  if (collectorError && p.consecutive_failures >= s.alertFailureThreshold) {
    out.push({
      type: 'collection_failing',
      category: 'collector',
      severity: p.consecutive_failures >= s.alertFailureThreshold * 2 ? 'critical' : 'warning',
      title: `Coleta de @${p.username} falhando`,
      message: `${p.consecutive_failures} falhas seguidas. Último erro: ${ERROR_INFO[errCode!].label}.`,
      details: { consecutiveFailures: p.consecutive_failures, lastErrorCode: errCode },
    });
  }

  const staleMs = s.staleAfterIntervals * s.followersIntervalMinutes * 60_000;
  const reference = p.last_success_at ?? p.created_at;
  // Perfil indisponível já tem alerta próprio; não duplica como "dados desatualizados".
  if (!unavailable && now.getTime() - reference.getTime() > staleMs) {
    out.push({
      type: 'stale_data',
      category: 'collector',
      severity: 'warning',
      title: `Dados de @${p.username} desatualizados`,
      message: p.last_success_at
        ? `Última coleta bem-sucedida há ${Math.floor((now.getTime() - p.last_success_at.getTime()) / 3_600_000)} h (limite: ${Math.round(staleMs / 3_600_000)} h).`
        : `Nenhuma coleta bem-sucedida desde o cadastro (limite: ${Math.round(staleMs / 3_600_000)} h).`,
      details: { lastSuccessAt: p.last_success_at?.toISOString() ?? null },
    });
  }

  // Regras de conteúdo e crescimento só fazem sentido com dados válidos.
  if (p.profile_state !== 'ok') return out;

  const { stats } = await profilePosting(db, p, now);
  const inactivityDays = c.inactivity_alert_days ?? s.defaultInactivityDays;
  if (stats.available && stats.latestPublishedAt && stats.daysSinceLatest! > inactivityDays) {
    out.push({
      type: 'no_posts',
      category: 'profile',
      severity: 'warning',
      title: `@${p.username} sem publicar há ${stats.daysSinceLatest} dias`,
      message: `Última publicação observada em ${stats.latestPublishedAt}. Limite configurado: ${inactivityDays} dias.`,
      details: { daysSinceLatest: stats.daysSinceLatest, latestPublishedAt: stats.latestPublishedAt, limit: inactivityDays },
    });
  }

  const goalWeek = c.posting_goal_per_week ?? s.defaultPostingGoalPerWeek;
  if (goalWeek != null && stats.postsPerWeek != null && stats.postsPerWeek < goalWeek) {
    out.push({
      type: 'posting_below_goal',
      category: 'profile',
      severity: 'info',
      title: `@${p.username} abaixo da meta de publicações`,
      message: `${stats.postsPerWeek.toFixed(1).replace('.', ',')} por semana (base: ${stats.postsPerWeekBasisDays} dias); meta de ${goalWeek}.`,
      details: { postsPerWeek: stats.postsPerWeek, goal: goalWeek },
    });
  }

  const snaps = await loadSnapshots(db, p.id, new Date(now.getTime() - 40 * DAY));
  const threshold = c.negative_change_threshold ?? s.defaultNegativeChangeThreshold;
  const c7 = periodChange(snaps, 7 * DAY);
  if (c7.absolute != null && c7.absolute <= -threshold) {
    out.push({
      type: 'negative_change',
      category: 'profile',
      severity: 'warning',
      title: `@${p.username} com variação líquida negativa`,
      message: `${c7.absolute.toLocaleString('pt-BR')} seguidores em 7 dias (limite: −${threshold}). Variação líquida: não indica quantos deixaram de seguir.`,
      details: { change: c7, threshold },
    });
  }

  const growthGoal = c.growth_goal_pct_30d ?? s.defaultGrowthGoalPct30d;
  const c30 = periodChange(snaps, 30 * DAY);
  if (growthGoal != null && c30.percent != null && c30.percent < growthGoal) {
    out.push({
      type: 'low_growth',
      category: 'profile',
      severity: 'info',
      title: `@${p.username} abaixo da meta de crescimento`,
      message: `${c30.percent.toFixed(2).replace('.', ',')}% em 30 dias; meta de ${growthGoal}%.`,
      details: { change: c30, goal: growthGoal },
    });
  }

  return out;
}

export async function evaluateProfileAlerts(db: DbClient, profileId: string, settings: Settings, now = new Date()): Promise<void> {
  const { rows } = await db.query(
    `SELECT p.*, c.status AS client_status, c.inactivity_alert_days, c.negative_change_threshold,
            c.growth_goal_pct_30d, c.posting_goal_per_week
       FROM instagram_profiles p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
    [profileId],
  );
  const row = rows[0];
  if (!row) return;

  if (row.client_status !== 'active') {
    // Monitoramento pausado/arquivado: encerra alertas ativos sem gerar novos.
    await db.query(
      `UPDATE alerts SET status = 'resolved', resolved_at = $2, resolution = 'auto'
        WHERE profile_id = $1 AND status IN ('open', 'acknowledged')`,
      [profileId, now],
    );
    return;
  }

  const candidates = await computeAlertCandidates(db, { profile: row, client: row, settings, now });
  await applyAlerts(db, profileId, candidates, now);
}

export async function applyAlerts(db: DbClient, profileId: string, candidates: AlertCandidate[], now: Date): Promise<void> {
  const active = (
    await db.query<{ id: string; type: AlertType }>(
      `SELECT id, type FROM alerts WHERE profile_id = $1 AND status IN ('open', 'acknowledged')`,
      [profileId],
    )
  ).rows;
  const activeByType = new Map(active.map((a) => [a.type, a.id]));
  const wanted = new Set(candidates.map((c) => c.type));

  for (const c of candidates) {
    const existing = activeByType.get(c.type);
    if (existing) {
      await db.query(
        `UPDATE alerts SET last_triggered_at = $2, occurrences = occurrences + 1,
                title = $3, message = $4, details = $5::jsonb, severity = $6
          WHERE id = $1`,
        [existing, now, c.title, c.message, JSON.stringify(c.details), c.severity],
      );
      continue;
    }
    const last = (
      await db.query<{ id: string; silenced_until: Date | null }>(
        `SELECT id, silenced_until FROM alerts WHERE profile_id = $1 AND type = $2 AND status = 'resolved'
          ORDER BY resolved_at DESC NULLS LAST LIMIT 1`,
        [profileId, c.type],
      )
    ).rows[0];
    if (last?.silenced_until && last.silenced_until > now) continue;
    await db.query(
      `INSERT INTO alerts (profile_id, type, category, severity, title, message, details, reopened_from, created_at, last_triggered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $9)
       ON CONFLICT (profile_id, type) WHERE status IN ('open', 'acknowledged') DO NOTHING`,
      [profileId, c.type, c.category, c.severity, c.title, c.message, JSON.stringify(c.details), last?.id ?? null, now],
    );
  }

  for (const a of active) {
    if (!wanted.has(a.type)) {
      await db.query(
        `UPDATE alerts SET status = 'resolved', resolved_at = $2, resolution = 'auto' WHERE id = $1`,
        [a.id, now],
      );
    }
  }
}

export async function resolveAlertManually(db: DbClient, alertId: string, userId: string, cooldownHours: number, now = new Date()) {
  const { rowCount } = await db.query(
    `UPDATE alerts SET status = 'resolved', resolved_at = $2, resolved_by = $3, resolution = 'manual',
            silenced_until = $2::timestamptz + make_interval(hours => $4)
      WHERE id = $1 AND status IN ('open', 'acknowledged')`,
    [alertId, now, userId, cooldownHours],
  );
  return rowCount === 1;
}

export async function acknowledgeAlert(db: DbClient, alertId: string, userId: string, now = new Date()) {
  const { rowCount } = await db.query(
    `UPDATE alerts SET status = 'acknowledged', acknowledged_at = $2, acknowledged_by = $3
      WHERE id = $1 AND status = 'open'`,
    [alertId, now, userId],
  );
  return rowCount === 1;
}
