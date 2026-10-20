import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, requireRole, validatePasswordStrength } from '../auth.js';
import { audit } from '../audit.js';

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(120),
  role: z.enum(['admin', 'analyst', 'viewer']),
  password: z.string().max(200),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['admin', 'analyst', 'viewer']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  password: z.string().max(200).optional(),
});

export async function registerUserRoutes(app: FastifyInstance) {
  const { db } = app.deps;
  const admin = { preHandler: requireRole('admin') };

  app.get('/api/users', admin, async () => {
    const { rows } = await db.query(
      `SELECT id, email::text AS email, name, role, status, last_login_at, created_at FROM users ORDER BY name`,
    );
    return { items: rows };
  });

  app.post('/api/users', admin, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const weak = validatePasswordStrength(body.password);
    if (weak) return reply.code(400).send({ error: 'validation', message: weak });
    try {
      const { rows } = await db.query(
        `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
        [body.email, body.name, body.role, await hashPassword(body.password)],
      );
      await audit(db, req.user!.id, 'create', 'user', rows[0].id, { email: body.email, role: body.role });
      return reply.code(201).send({ id: rows[0].id });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'duplicate', message: 'E-mail já cadastrado.' });
      throw err;
    }
  });

  app.patch('/api/users/:id', admin, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateSchema.parse(req.body);
    if (id === req.user!.id && (body.role && body.role !== 'admin' || body.status === 'disabled')) {
      return reply.code(400).send({ error: 'validation', message: 'Você não pode rebaixar ou desativar a própria conta.' });
    }
    if (body.password !== undefined) {
      const weak = validatePasswordStrength(body.password);
      if (weak) return reply.code(400).send({ error: 'validation', message: weak });
    }
    const { rowCount } = await db.query(
      `UPDATE users SET name = COALESCE($2, name), role = COALESCE($3, role), status = COALESCE($4, status),
              password_hash = COALESCE($5, password_hash), updated_at = now() WHERE id = $1`,
      [id, body.name ?? null, body.role ?? null, body.status ?? null, body.password ? await hashPassword(body.password) : null],
    );
    if (!rowCount) return reply.code(404).send({ error: 'not_found', message: 'Usuário não encontrado.' });
    // Desativação ou troca de senha encerra as sessões abertas.
    if (body.status === 'disabled' || body.password) await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await audit(db, req.user!.id, 'update', 'user', id, { fields: Object.keys(body).filter((k) => k !== 'password'), passwordChanged: !!body.password });
    return { ok: true };
  });
}
