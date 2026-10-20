import type { DbClient } from '../db/pool.js';
import { DAY } from './time.js';
import { postingStats, type MediaRow } from './posting.js';
import type { Snapshot } from './growth.js';
import type { MediaType } from '../providers/types.js';

// Consultas compartilhadas entre a API e o avaliador de alertas.

export async function loadSnapshots(db: DbClient, profileId: string, from?: Date, to?: Date): Promise<Snapshot[]> {
  const { rows } = await db.query<{ observed_at: Date; followers_count: number | null; validity: 'valid' | 'suspect' }>(
    `SELECT observed_at, followers_count, validity FROM follower_snapshots
      WHERE profile_id = $1 AND ($2::timestamptz IS NULL OR observed_at >= $2) AND ($3::timestamptz IS NULL OR observed_at <= $3)
      ORDER BY observed_at`,
    [profileId, from ?? null, to ?? null],
  );
  return rows.map((r) => ({ observedAt: r.observed_at, followers: r.followers_count, validity: r.validity }));
}

export async function loadMediaRows(db: DbClient, profileId: string, since?: Date): Promise<MediaRow[]> {
  const { rows } = await db.query<{ published_at: Date | null; media_type: MediaType }>(
    `SELECT published_at, media_type FROM media_items
      WHERE profile_id = $1 AND ($2::timestamptz IS NULL OR published_at >= $2)`,
    [profileId, since ?? null],
  );
  return rows.map((r) => ({ publishedAt: r.published_at, mediaType: r.media_type }));
}

export interface ProfileRow {
  id: string;
  client_id: string;
  username: string;
  profile_state: string;
  last_success_at: Date | null;
  last_media_success_at: Date | null;
  media_coverage_start: Date | null;
  consecutive_failures: number;
  last_error_code: string | null;
  created_at: Date;
}

export async function profilePosting(db: DbClient, p: ProfileRow, now: Date) {
  const media = await loadMediaRows(db, p.id, new Date(now.getTime() - 400 * DAY));
  const stats = postingStats(media, {
    now,
    coverageStart: p.media_coverage_start,
    mediaCollected: p.last_media_success_at != null,
  });
  return { media, stats };
}
