// Teste real da fonte configurada, fora do banco (não grava nada).
// Uso: npm run provider:check -- <@ de um perfil profissional público>
// Mostra o que a fonte devolveu e quais campos vieram vazios, para validar o adaptador.
import { env } from '../config/env.js';
import { normalizeUsername } from '../core/username.js';
import { CollectionError, redactSecrets } from '../providers/errors.js';
import { createProvider } from '../providers/registry.js';

const input = process.argv[2];
const u = normalizeUsername(input ?? '');
if (!u.ok) {
  console.error(`Informe um @ válido. ${u.error}`);
  process.exit(1);
}
env();
const provider = createProvider('meta_business_discovery')!;
const cfg = provider.configStatus();
if (!cfg.configured) {
  console.error(`Fonte não configurada. Faltam: ${cfg.missing.join(', ')}`);
  for (const step of cfg.instructions) console.error(` - ${step}`);
  process.exit(1);
}

try {
  const r = await provider.fetchProfile(u.username, { includeMedia: true, mediaLimit: 10 });
  const missing = Object.entries(r.profile).filter(([, v]) => v == null).map(([k]) => k);
  console.log(JSON.stringify({
    ok: true,
    observedAt: r.observedAt,
    profile: r.profile,
    camposAusentes: missing,
    publicacoes: r.media?.length ?? 0,
    haMaisPublicacoes: r.mediaHasMore,
    amostra: r.media?.slice(0, 3),
    tipos: [...new Set(r.media?.map((m) => m.sourceMediaType))],
  }, null, 2));
} catch (err) {
  const e = err instanceof CollectionError ? err : null;
  console.error(JSON.stringify({ ok: false, code: e?.code ?? 'UNKNOWN', message: redactSecrets((err as Error).message), detail: e?.detail }, null, 2));
  process.exit(2);
}
