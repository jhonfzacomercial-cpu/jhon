import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE, login, logout } from '../auth.js';
import { audit } from '../audit.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export async function registerAuthRoutes(app: FastifyInstance) {
  const { db, env } = app.deps;

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const body = loginSchema.parse(req.body);
      const r = await login(db, body.email, body.password, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        ttlHours: env.SESSION_TTL_HOURS,
      });
      if (!r.ok) {
        const message =
          r.reason === 'locked'
            ? 'Conta bloqueada temporariamente por excesso de tentativas. Tente novamente em alguns minutos.'
            : 'E-mail ou senha incorretos.';
        return reply.code(401).send({ error: 'invalid_credentials', message });
      }
      reply.setCookie(SESSION_COOKIE, r.token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: env.SESSION_TTL_HOURS * 3600,
      });
      await audit(db, r.user.id, 'login', 'user', r.user.id, { ip: req.ip });
      return { user: r.user };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    await logout(db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: req.user }));
}
