import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadSettings } from '../../core/settings.js';

const query = z.object({
  clientId: z.string().uuid().optional(),
  type: z.enum(['image', 'carousel', 'video', 'reel', 'unknown']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).optional(),
});

export async function registerMediaRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  // Publicações observadas. published_at = data de publicação informada pela fonte;
  // first_seen_at = quando o sistema descobriu a publicação (não confundir).
  app.get('/api/media', async (req) => {
    const q = query.parse(req.query);
    const settings = await loadSettings(db);
    const pageSize = q.pageSize ?? settings.pageSize;
    const tz = settings.displayTimezone;
    const params = [q.clientId ?? null, q.type ?? null, q.from ?? null, q.to ?? null, tz];
    const where = `
      WHERE c.status <> 'archived'
        AND ($1::uuid IS NULL OR c.id = $1)
        AND ($2::text IS NULL OR m.media_type = $2)
        AND ($3::date IS NULL OR (m.published_at AT TIME ZONE $5)::date >= $3::date)
        AND ($4::date IS NULL OR (m.published_at AT TIME ZONE $5)::date <= $4::date)`;
    const total = (
      await db.query(
        `SELECT count(*)::int AS n FROM media_items m JOIN instagram_profiles p ON p.id = m.profile_id JOIN clients c ON c.id = p.client_id ${where}`,
        params,
      )
    ).rows[0].n;
    const { rows } = await db.query(
      `SELECT m.id, m.external_id, m.permalink, m.media_type, m.source_media_type, m.published_at, m.caption,
              m.thumbnail_url, m.like_count, m.comments_count, m.source, m.first_seen_at, m.last_seen_at,
              c.id AS client_id, c.name AS client_name, p.username::text AS username
         FROM media_items m JOIN instagram_profiles p ON p.id = m.profile_id JOIN clients c ON c.id = p.client_id
         ${where}
        ORDER BY m.published_at DESC NULLS LAST, m.id DESC
        LIMIT $6 OFFSET $7`,
      [...params, pageSize, (q.page - 1) * pageSize],
    );
    return { items: rows, total, page: q.page, pageSize };
  });
}
