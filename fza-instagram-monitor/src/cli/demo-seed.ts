// Gera uma carteira de DEMONSTRAÇÃO para desenvolvimento local da interface.
// Tudo é gravado com source = 'demo' e aparece com o selo DEMO. Recusa rodar em produção
// ou sem ALLOW_DEMO_PROVIDER=true. Uso: npm run demo:seed
import { env } from '../config/env.js';
import { migrate } from '../db/migrate.js';
import { getPool } from '../db/pool.js';
import { DemoProvider } from '../providers/demo.js';
import { saveSettings } from '../core/settings.js';
import { profileUrl } from '../core/username.js';

const e = env();
if (e.NODE_ENV === 'production' || e.ALLOW_DEMO_PROVIDER !== 'true') {
  console.error('demo:seed só roda fora de produção e com ALLOW_DEMO_PROVIDER=true.');
  process.exit(1);
}

const CLIENTS: [string, string, string][] = [
  ['DEMO Clínica Vida', 'demo_clinicavida', 'Saúde'],
  ['DEMO Loja Centro', 'demo_lojacentro', 'Varejo'],
  ['DEMO Restaurante Sabor', 'demo_restaurantesabor', 'Alimentação'],
  ['DEMO Imobiliária Lagoa', 'demo_imobiliarialagoa', 'Imóveis'],
  ['DEMO Academia Forte', 'demo_instavel_academia', 'Fitness'],
  ['DEMO Perfil Removido', 'demo_naoexiste_perfil', 'Teste'],
];

const db = getPool();
await migrate(db);
await saveSettings(db, { activeProvider: 'demo' }, null);
const days = 45;
const now = Date.now();

for (const [name, username, category] of CLIENTS) {
  const exists = (await db.query('SELECT 1 FROM instagram_profiles WHERE username = $1', [username])).rowCount;
  if (exists) continue;
  const c = (await db.query(`INSERT INTO clients (name, category, notes, posting_goal_per_week) VALUES ($1, $2, 'Cliente de demonstração (DEMO).', 3) RETURNING id`, [name, category])).rows[0];
  const p = (
    await db.query(`INSERT INTO instagram_profiles (client_id, username, canonical_url, next_collection_at) VALUES ($1, $2, $3, now()) RETURNING id`, [
      c.id,
      username,
      profileUrl(username),
    ])
  ).rows[0];
  if (username.startsWith('demo_naoexiste')) continue;
  // Histórico DEMO a cada 6 h, com alguns dias sem coleta para exibir lacunas.
  for (let h = days * 24; h >= 6; h -= 6) {
    const t = new Date(now - h * 3_600_000);
    if (Math.floor(h / 24) % 13 === 5) continue;
    const r = await new DemoProvider(() => t).fetchProfile(username, { includeMedia: h % 48 === 0, mediaLimit: 25 }).catch(() => null);
    if (!r) continue;
    await db.query(
      `INSERT INTO follower_snapshots (profile_id, followers_count, follows_count, media_count, observed_at, collected_at, source) VALUES ($1, $2, $3, $4, $5, $5, 'demo')`,
      [p.id, r.profile.followersCount, r.profile.followsCount, r.profile.mediaCount, t],
    );
    for (const m of r.media ?? []) {
      await db.query(
        `INSERT INTO media_items (profile_id, external_id, dedupe_key, media_type, source_media_type, published_at, caption, like_count, comments_count, source, first_seen_at, last_seen_at)
         VALUES ($1, $2, $2, $3, 'DEMO', $4, $5, $6, $7, 'demo', $8, $8) ON CONFLICT DO NOTHING`,
        [p.id, m.externalId, m.mediaType, m.publishedAt, m.caption, m.likeCount, m.commentsCount, t],
      );
    }
  }
  await db.query(
    `UPDATE instagram_profiles SET media_coverage_start = (SELECT min(published_at) FROM media_items WHERE profile_id = $1),
            last_media_success_at = now() - interval '6 hours' WHERE id = $1`,
    [p.id],
  );
}
console.log('Carteira DEMO criada. Inicie o worker para as coletas DEMO continuarem.');
await db.end();
