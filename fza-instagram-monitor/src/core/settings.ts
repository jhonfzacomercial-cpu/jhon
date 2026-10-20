import { z } from 'zod';
import type { DbClient } from '../db/pool.js';

// Configurações operacionais editáveis pela tela de Configurações.
// Segredos (tokens) NÃO ficam aqui: só em variáveis de ambiente.
export const settingsSchema = z.object({
  activeProvider: z.enum(['meta_business_discovery', 'demo']).default('meta_business_discovery'),
  followersIntervalMinutes: z.number().int().min(15).max(1440).default(60),
  mediaIntervalMinutes: z.number().int().min(15).max(1440).default(180),
  mediaFetchLimit: z.number().int().min(1).max(50).default(25),
  maxConcurrency: z.number().int().min(1).max(10).default(2),
  // Teto de requisições por hora à fonte (Meta: 200/h por usuário do app; usamos margem).
  maxRequestsPerHour: z.number().int().min(1).max(5000).default(150),
  retryBaseSeconds: z.number().int().min(5).max(3600).default(60),
  retryMaxMinutes: z.number().int().min(1).max(1440).default(360),
  // Após N falhas permanentes seguidas (ex.: perfil não encontrado) o perfil sai do agendamento.
  maxPermanentFailures: z.number().int().min(1).max(20).default(3),
  permanentRetryHours: z.number().int().min(1).max(168).default(24),
  displayTimezone: z.string().default('America/Campo_Grande'),
  defaultInactivityDays: z.number().int().min(1).max(365).default(7),
  defaultNegativeChangeThreshold: z.number().int().min(1).default(50),
  defaultPostingGoalPerWeek: z.number().min(0).max(100).nullable().default(null),
  defaultGrowthGoalPct30d: z.number().min(-100).max(1000).nullable().default(null),
  alertFailureThreshold: z.number().int().min(1).max(50).default(3),
  // Dados considerados desatualizados após N × intervalo de coleta.
  staleAfterIntervals: z.number().int().min(2).max(48).default(3),
  alertCooldownHours: z.number().int().min(0).max(720).default(24),
  archivedClientRetentionDays: z.number().int().min(7).max(3650).default(180),
  collectionRunRetentionDays: z.number().int().min(7).max(3650).default(180),
  // null = histórico de seguidores e publicações mantido indefinidamente.
  snapshotRetentionDays: z.number().int().min(30).max(36500).nullable().default(null),
  pageSize: z.number().int().min(10).max(200).default(25),
});

export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export async function loadSettings(db: DbClient): Promise<Settings> {
  const { rows } = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM settings');
  const raw: Record<string, unknown> = {};
  for (const r of rows) raw[r.key] = r.value;
  // Chaves desconhecidas ou inválidas no banco caem para o padrão sem derrubar o sistema.
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(raw)) {
    const field = (settingsSchema.shape as Record<string, z.ZodTypeAny>)[k];
    if (field && field.safeParse(v).success) merged[k] = v;
  }
  return settingsSchema.parse(merged);
}

export const settingsPatchSchema = settingsSchema.partial().strict();

export async function saveSettings(
  db: DbClient,
  patch: Partial<Settings>,
  userId: string | null,
): Promise<Settings> {
  const parsed = settingsPatchSchema.parse(patch);
  for (const [key, value] of Object.entries(parsed)) {
    await db.query(
      `INSERT INTO settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [key, JSON.stringify(value), userId],
    );
  }
  return loadSettings(db);
}
