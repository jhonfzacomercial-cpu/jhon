import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadSettings } from '../../core/settings.js';
import { ERROR_INFO } from '../../providers/errors.js';

const query = z.object({
  status: z.enum(['all', 'success', 'partial', 'failed', 'running', 'abandoned']).default('all'),
  clientId: z.string().uuid().optional(),
  errorCode: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).optional(),
});

export async function registerRunRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get('/api/runs', async (req) => {
    const q = query.parse(req.query);
    const settings = await loadSettings(db);
    const pageSize = q.pageSize ?? settings.pageSize;
    const params = [q.status === 'all' ? null : q.status, q.clientId ?? null, q.errorCode ?? null];
    const from = `FROM collection_runs r JOIN instagram_profiles p ON p.id = r.profile_id JOIN clients c ON c.id = p.client_id
      WHERE ($1::text IS NULL OR r.status = $1) AND ($2::uuid IS NULL OR c.id = $2) AND ($3::text IS NULL OR r.error_code = $3)`;
    const total = (await db.query(`SELECT count(*)::int AS n ${from}`, params)).rows[0].n;
    const { rows } = await db.query(
      `SELECT r.*, c.id AS client_id, c.name AS client_name, p.username::text AS username ${from}
        ORDER BY r.started_at DESC LIMIT $4 OFFSET $5`,
      [...params, pageSize, (q.page - 1) * pageSize],
    );
    return { items: rows, total, page: q.page, pageSize, errorLabels: Object.fromEntries(Object.entries(ERROR_INFO).map(([k, v]) => [k, v.label])) };
  });
}
