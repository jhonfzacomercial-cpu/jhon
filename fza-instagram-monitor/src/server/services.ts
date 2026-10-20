import type { DbClient } from '../db/pool.js';
import { periodChange, type NetChange, type Snapshot } from '../core/growth.js';
import type { Settings } from '../core/settings.js';
import { DAY, HOUR } from '../core/time.js';

export interface ProfileSummary {
  clientId: string;
  clientName: string;
  category: string | null;
  clientStatus: 'active' | 'paused' | 'archived';
  notes: string | null;
  postingGoalPerWeek: number | null;
  inactivityAlertDays: number | null;
  negativeChangeThreshold: number | null;
  growthGoalPct30d: number | null;
  archivedAt: string | null;
  purgeAfter: string | null;
  profileId: string;
  username: string;
  canonicalUrl: string | null;
  fullName: string | null;
  profilePictureUrl: string | null;
  profileState: string;
  stateReason: string | null;
  source: string | null;
  isDemo: boolean;
  currentFollowers: number | null;
  currentFollows: number | null;
  currentMediaCount: number | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  nextCollectionAt: string | null;
  manualRequestedAt: string | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  stale: boolean;
  openAlerts: number;
  change24h: NetChange;
  change7d: NetChange;
  change30d: NetChange;
  createdAt: string;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function staleThresholdMs(s: Settings): number {
  return s.staleAfterIntervals * s.followersIntervalMinutes * 60_000;
}

export async function loadSnapshotsByProfile(db: DbClient, profileIds: string[], from: Date, to?: Date) {
  const map = new Map<string, Snapshot[]>();
  if (profileIds.length === 0) return map;
  const { rows } = await db.query<{ profile_id: string; observed_at: Date; followers_count: number | null; validity: 'valid' | 'suspect' }>(
    `SELECT profile_id, observed_at, followers_count, validity FROM follower_snapshots
      WHERE profile_id = ANY($1::uuid[]) AND observed_at >= $2 AND ($3::timestamptz IS NULL OR observed_at <= $3)
      ORDER BY observed_at`,
    [profileIds, from, to ?? null],
  );
  for (const r of rows) {
    const arr = map.get(r.profile_id) ?? [];
    arr.push({ observedAt: r.observed_at, followers: r.followers_count, validity: r.validity });
    map.set(r.profile_id, arr);
  }
  return map;
}

export async function loadSummaries(
  db: DbClient,
  settings: Settings,
  now: Date,
  filter: { clientIds?: string[]; includeArchived?: boolean; clientId?: string } = {},
): Promise<ProfileSummary[]> {
  const { rows } = await db.query(
    `SELECT c.id AS client_id, c.name, c.category, c.status AS client_status, c.notes,
            c.posting_goal_per_week, c.inactivity_alert_days, c.negative_change_threshold, c.growth_goal_pct_30d,
            c.archived_at, c.purge_after,
            p.id AS profile_id, p.username::text AS username, p.canonical_url, p.full_name, p.profile_picture_url,
            p.profile_state, p.state_reason, p.source, p.current_followers, p.current_follows, p.current_media_count,
            p.last_success_at, p.last_attempt_at, p.next_collection_at, p.manual_requested_at,
            p.consecutive_failures, p.last_error_code, p.last_error_message, p.created_at,
            (SELECT count(*)::int FROM alerts a WHERE a.profile_id = p.id AND a.status IN ('open', 'acknowledged')) AS open_alerts
       FROM clients c JOIN instagram_profiles p ON p.client_id = c.id
      WHERE ($1::boolean OR c.status <> 'archived')
        AND ($2::uuid[] IS NULL OR c.id = ANY($2::uuid[]))
        AND ($3::uuid IS NULL OR c.id = $3)
      ORDER BY c.name`,
    [filter.includeArchived ?? false, filter.clientIds?.length ? filter.clientIds : null, filter.clientId ?? null],
  );
  // 30 dias + tolerância máxima (3 dias) para encontrar o início do período.
  const snaps = await loadSnapshotsByProfile(
    db,
    rows.map((r) => r.profile_id),
    new Date(now.getTime() - 34 * DAY),
  );
  const staleMs = staleThresholdMs(settings);
  return rows.map((r) => {
    const s = snaps.get(r.profile_id) ?? [];
    return {
      clientId: r.client_id,
      clientName: r.name,
      category: r.category,
      clientStatus: r.client_status,
      notes: r.notes,
      postingGoalPerWeek: r.posting_goal_per_week,
      inactivityAlertDays: r.inactivity_alert_days,
      negativeChangeThreshold: r.negative_change_threshold,
      growthGoalPct30d: r.growth_goal_pct_30d,
      archivedAt: iso(r.archived_at),
      purgeAfter: iso(r.purge_after),
      profileId: r.profile_id,
      username: r.username,
      canonicalUrl: r.canonical_url,
      fullName: r.full_name,
      profilePictureUrl: r.profile_picture_url,
      profileState: r.profile_state,
      stateReason: r.state_reason,
      source: r.source,
      isDemo: r.source === 'demo',
      currentFollowers: r.current_followers,
      currentFollows: r.current_follows,
      currentMediaCount: r.current_media_count,
      lastSuccessAt: iso(r.last_success_at),
      lastAttemptAt: iso(r.last_attempt_at),
      nextCollectionAt: iso(r.next_collection_at),
      manualRequestedAt: iso(r.manual_requested_at),
      consecutiveFailures: r.consecutive_failures,
      lastErrorCode: r.last_error_code,
      lastErrorMessage: r.last_error_message,
      stale: !r.last_success_at || now.getTime() - r.last_success_at.getTime() > staleMs,
      openAlerts: r.open_alerts,
      change24h: periodChange(s, 24 * HOUR),
      change7d: periodChange(s, 7 * DAY),
      change30d: periodChange(s, 30 * DAY),
      createdAt: r.created_at.toISOString(),
    } satisfies ProfileSummary;
  });
}

// Soma das variações apenas entre perfis com dados comparáveis no período.
export function aggregateChange(items: NetChange[]) {
  const comparable = items.filter((c) => c.absolute != null && c.from);
  if (comparable.length === 0) return { absolute: null, percent: null, profilesIncluded: 0, profilesTotal: items.length };
  const absolute = comparable.reduce((a, c) => a + c.absolute!, 0);
  const base = comparable.reduce((a, c) => a + c.from!.followers, 0);
  return {
    absolute,
    percent: base > 0 ? (absolute / base) * 100 : null,
    profilesIncluded: comparable.length,
    profilesTotal: items.length,
  };
}
