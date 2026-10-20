import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type pg from 'pg';
import type { Env } from '../config/env.js';
import { redactSecrets } from '../providers/errors.js';
import { SESSION_COOKIE, userFromToken } from './auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerClientRoutes } from './routes/clients.js';
import { registerOverviewRoutes } from './routes/overview.js';
import { registerAlertRoutes } from './routes/alerts.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerUserRoutes } from './routes/users.js';
import { registerExportRoutes } from './routes/export.js';
import { registerMediaRoutes } from './routes/media.js';

export interface AppDeps {
  db: pg.Pool;
  env: Env;
  now?: () => Date;
  webDir?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    clock: () => Date;
  }
}

const PUBLIC_API = new Set(['/api/auth/login', '/api/auth/me', '/api/health']);
const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;
  const app = Fastify({
    trustProxy: env.TRUST_PROXY === 'true',
    bodyLimit: 256 * 1024,
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          },
  });
  app.decorate('deps', deps);
  app.decorate('clock', deps.now ?? (() => new Date()));

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Fotos e miniaturas vêm das CDNs do Instagram/Facebook.
        imgSrc: ["'self'", 'data:', 'https://*.cdninstagram.com', 'https://*.fbcdn.net'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    // A interface carrega imagens de outras origens (CDN do Instagram).
    crossOriginEmbedderPolicy: false,
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(rateLimit, { global: false });

  // Sessão: cookie httpOnly com token aleatório; o banco guarda só o hash.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    req.user = (await userFromToken(deps.db, req.cookies[SESSION_COOKIE])) ?? undefined;
    const route = req.url.split('?')[0];

    // CSRF: além do cookie SameSite=Strict, toda requisição que altera estado precisa do
    // cabeçalho X-FZA-CSRF (formulários de outros sites não conseguem enviá-lo sem CORS,
    // que não é habilitado) e, se houver Origin, ela deve ser a da aplicação.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (req.headers['x-fza-csrf'] !== '1' || (origin && origin !== env.APP_ORIGIN)) {
        return reply.code(403).send({ error: 'csrf', message: 'Requisição bloqueada (origem não permitida).' });
      }
    }
    if (!PUBLIC_API.has(route) && !req.user) {
      return reply.code(401).send({ error: 'unauthenticated', message: 'Faça login para continuar.' });
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation',
        message: 'Dados inválidos.',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err: redactSecrets(String(err.stack ?? err.message)) }, 'request_failed');
    return reply.code(status).send({
      error: status === 429 ? 'rate_limited' : status >= 500 ? 'internal' : 'bad_request',
      // Erros internos não expõem detalhes (podem conter dados sensíveis).
      message: status === 429 ? 'Muitas tentativas. Aguarde e tente novamente.' : status >= 500 ? 'Erro interno.' : err.message,
    });
  });

  app.get('/api/health', async () => {
    await deps.db.query('SELECT 1');
    return { ok: true };
  });

  await registerAuthRoutes(app);
  await registerClientRoutes(app);
  await registerOverviewRoutes(app);
  await registerMediaRoutes(app);
  await registerAlertRoutes(app);
  await registerRunRoutes(app);
  await registerSettingsRoutes(app);
  await registerUserRoutes(app);
  await registerExportRoutes(app);

  // Interface (build do Vite) servida pelo mesmo processo; rotas do SPA caem no index.html.
  const webDir = deps.webDir ?? path.resolve(here, '../../dist/web');
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, wildcard: true, index: false });
    app.get('/', (_req, reply) => reply.header('Cache-Control', 'no-cache').sendFile('index.html'));
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0];
      // API e arquivos inexistentes (com extensão) respondem 404; demais rotas são do SPA.
      if (path.startsWith('/api/') || /\.[a-z0-9]+$/i.test(path)) {
        return reply.code(404).send({ error: 'not_found', message: 'Rota não encontrada.' });
      }
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found', message: 'Rota não encontrada.' }));
  }

  return app;
}
