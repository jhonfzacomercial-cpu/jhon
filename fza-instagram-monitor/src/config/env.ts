import { z } from 'zod';

// Segredos e parâmetros de infraestrutura vêm exclusivamente de variáveis de ambiente.
// Parâmetros operacionais (intervalos, limites de alerta etc.) ficam na tabela settings.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  // Origem pública da aplicação (ex.: https://monitor.grupofza.com.br). Usada na checagem de CSRF.
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Fonte oficial: Meta Business Discovery
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v25.0'),
  META_IG_USER_ID: z.string().regex(/^\d+$/).optional(),
  META_ACCESS_TOKEN: z.string().min(1).optional(),
  // Opcional: se definido, envia appsecret_proof (recomendado pela Meta para chamadas do servidor).
  META_APP_SECRET: z.string().min(1).optional(),

  // Fonte de demonstração: só para desenvolvimento local. Nunca habilitada em produção.
  ALLOW_DEMO_PROVIDER: z.enum(['true', 'false']).default('false'),

  WORKER_ID: z.string().optional(),
  WORKER_POLL_SECONDS: z.coerce.number().positive().default(15),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Mostra apenas os nomes das variáveis com problema, nunca os valores.
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Variáveis de ambiente inválidas ou ausentes: ${names}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.ALLOW_DEMO_PROVIDER === 'true') {
    throw new Error('ALLOW_DEMO_PROVIDER não pode ser habilitado em produção');
  }
  return env;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

export function setEnvForTests(e: Env): void {
  cached = e;
}
