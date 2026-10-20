import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { acknowledgeAlert, resolveAlertManually } from '../../core/alerts.js';
import { loadSettings } from '../../core/settings.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';

const query = z.object({
  status: z.enum(['active', 'open', 'acknowledged', 'resolved', 'all']).default('active'),
  category: z.enum(['profile', 'collector']).optional(),
  clientId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).optional(),
});
const idParam = z.object({ id: z.string().uuid() });

export async function registerAlertRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get('/api/alerts', async (req) => {
    const q = query.parse(req.query);
    const settings = await loadSettings(db);
    const pageSize = q.pageSize ?? settings.pageSize;
    const statuses =
      q.status === 'active' ? ['open', 'acknowledged'] : q.status === 'all' ? ['open', 'acknowledged', 'resolved'] : [q.status];
    const params = [statuses, q.category ?? null, q.clientId ?? null];
    const where = `WHERE a.status = ANY($1::text[]) AND ($2::text IS NULL OR a.category = $2) AND ($3::uuid IS NULL OR c.id = $3)`;
    const from = `FROM alerts a JOIN instagram_profiles p ON p.id = a.profile_id JOIN clients c ON c.id = p.client_id`;
    const total = (await db.query(`SELECT count(*)::int AS n ${from} ${where}`, params)).rows[0].n;
    const counts = (
      await db.query(
        `SELECT a.status, count(*)::int AS n ${from} WHERE ($1::uuid IS NULL OR c.id = $1) GROUP BY a.status`,
        [q.clientId ?? null],
      )
    ).rows;
    const { rows } = await db.query(
      `SELECT a.*, c.id AS client_id, c.name AS client_name, p.username::text AS username,
              ua.name AS acknowledged_by_name, ur.name AS resolved_by_name
         ${from}
         LEFT JOIN users ua ON ua.id = a.acknowledged_by
         LEFT JOIN users ur ON ur.id = a.resolved_by
         ${where}
        ORDER BY CASE a.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
                 CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                 a.last_triggered_at DESC
        LIMIT $4 OFFSET $5`,
      [...params, pageSize, (q.page - 1) * pageSize],
    );
    return { items: rows, total, page: q.page, pageSize, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  });

  app.post('/api/alerts/:id/acknowledge', { preHandler: requireRole('analyst') }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!(await acknowledgeAlert(db, id, req.user!.id))) {
      return reply.code(409).send({ error: 'invalid_state', message: 'Só alertas abertos podem ser reconhecidos.' });
    }
    await audit(db, req.user!.id, 'acknowledge', 'alert', id);
    return { ok: true };
  });

  app.post('/api/alerts/:id/resolve', { preHandler: requireRole('analyst') }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const settings = await loadSettings(db);
    if (!(await resolveAlertManually(db, id, req.user!.id, settings.alertCooldownHours))) {
      return reply.code(409).send({ error: 'invalid_state', message: 'O alerta já está resolvido.' });
    }
    await audit(db, req.user!.id, 'resolve', 'alert', id, { cooldownHours: settings.alertCooldownHours });
    return { ok: true, silencedHours: settings.alertCooldownHours };
  });
}
