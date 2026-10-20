import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { CollectionError } from './errors.js';
import type {
  ConfigStatus,
  FetchOptions,
  MediaObservation,
  MediaType,
  ProfileFetchResult,
  ProfileProvider,
  ProviderCapabilities,
} from './types.js';

// Adaptador da API oficial: Instagram Graph API — Business Discovery
// (Instagram API with Facebook Login). Ver docs/PROVEDOR-META.md.
//
// GET https://graph.facebook.com/{versão}/{ig-user-id-da-FZA}
//     ?fields=business_discovery.username(<alvo>){campos...}
//
// Só retorna perfis profissionais (Business/Creator). Contas pessoais e com
// restrição de idade não são retornadas.

const PROFILE_FIELDS = ['id', 'username', 'name', 'profile_picture_url', 'followers_count', 'follows_count', 'media_count'];
const MEDIA_FIELDS = ['id', 'caption', 'media_type', 'media_url', 'permalink', 'timestamp', 'like_count', 'comments_count'];

const mediaSchema = z.object({
  id: z.string(),
  caption: z.string().optional().nullable(),
  media_type: z.string().optional().nullable(),
  media_url: z.string().optional().nullable(),
  permalink: z.string().optional().nullable(),
  timestamp: z.string().optional().nullable(),
  like_count: z.number().int().nonnegative().optional().nullable(),
  comments_count: z.number().int().nonnegative().optional().nullable(),
});

const responseSchema = z.object({
  business_discovery: z.object({
    id: z.string().optional(),
    username: z.string().optional(),
    name: z.string().optional().nullable(),
    profile_picture_url: z.string().optional().nullable(),
    followers_count: z.number().int().nonnegative().optional().nullable(),
    follows_count: z.number().int().nonnegative().optional().nullable(),
    media_count: z.number().int().nonnegative().optional().nullable(),
    media: z
      .object({
        data: z.array(mediaSchema),
        paging: z.object({ next: z.string().optional() }).passthrough().optional(),
      })
      .optional(),
  }),
});

const graphErrorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    type: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    is_transient: z.boolean().optional(),
    fbtrace_id: z.string().optional(),
  }),
});

export interface MetaConfig {
  apiVersion: string;
  igUserId?: string;
  accessToken?: string;
  appSecret?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const META_CAPABILITIES: ProviderCapabilities = {
  followersCount: true,
  followsCount: true,
  mediaCount: true,
  recentMedia: true,
  distinguishesReels: false,
  followerGainsAndLosses: false,
  followerBackfill: false,
  supportedAccountTypes: 'Somente contas profissionais (Business ou Creator) que não tenham restrição de idade.',
  notes: [
    'Contas pessoais não são retornadas; a API não distingue "perfil inexistente" de "perfil pessoal".',
    'Seguidores ganhos e perdidos não são fornecidos: o sistema mostra apenas a variação líquida entre coletas.',
    'Reels aparecem como VIDEO nesta consulta; o sistema não os separa de vídeos comuns.',
    'Miniatura não é fornecida para vídeos (media_url de vídeo é o arquivo e é omitido quando há áudio licenciado).',
    'Não há histórico anterior à primeira coleta: a evolução começa no cadastro.',
    'Limite da Meta: 200 chamadas por hora × usuários do app (compartilhado com consultas de hashtag).',
  ],
};

export class MetaBusinessDiscoveryProvider implements ProfileProvider {
  readonly id = 'meta_business_discovery' as const;
  readonly displayName = 'Meta — Instagram Business Discovery (API oficial)';
  readonly isDemo = false;
  readonly capabilities = META_CAPABILITIES;

  constructor(private readonly cfg: MetaConfig) {}

  configStatus(): ConfigStatus {
    const missing: string[] = [];
    if (!this.cfg.igUserId) missing.push('META_IG_USER_ID');
    if (!this.cfg.accessToken) missing.push('META_ACCESS_TOKEN');
    return {
      configured: missing.length === 0,
      missing,
      instructions: [
        'Converta o Instagram da FZA em conta profissional e vincule-o a uma Página do Facebook.',
        'Crie um app em developers.facebook.com com o produto "Facebook Login for Business".',
        'Gere um token de longa duração com instagram_basic e pages_read_engagement (e ads_read se a Página estiver em um Business Manager).',
        'Descubra o ID da conta do Instagram da FZA (GET /{page-id}?fields=instagram_business_account).',
        'Defina META_IG_USER_ID e META_ACCESS_TOKEN (e opcionalmente META_APP_SECRET) nas variáveis de ambiente do servidor e do worker.',
        'Valide com: npm run provider:check -- <@ de um perfil profissional>.',
      ],
    };
  }

  buildUrl(username: string, opts: FetchOptions): string {
    const fields = [...PROFILE_FIELDS];
    if (opts.includeMedia) {
      fields.push(`media.limit(${Math.max(1, Math.min(50, opts.mediaLimit))}){${MEDIA_FIELDS.join(',')}}`);
    }
    // O username já foi validado por normalizeUsername ([a-z0-9._]), seguro dentro da expressão de campos.
    const params = new URLSearchParams({
      fields: `business_discovery.username(${username}){${fields.join(',')}}`,
      access_token: this.cfg.accessToken ?? '',
    });
    if (this.cfg.appSecret && this.cfg.accessToken) {
      params.set('appsecret_proof', createHmac('sha256', this.cfg.appSecret).update(this.cfg.accessToken).digest('hex'));
    }
    return `https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.igUserId}?${params.toString()}`;
  }

  async fetchProfile(username: string, opts: FetchOptions): Promise<ProfileFetchResult> {
    const status = this.configStatus();
    if (!status.configured) {
      throw new CollectionError('NOT_CONFIGURED', `Variáveis ausentes: ${status.missing.join(', ')}`);
    }
    const fetchImpl = this.cfg.fetchImpl ?? fetch;
    const timeout = AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await fetchImpl(this.buildUrl(username, opts), { method: 'GET', signal, headers: { Accept: 'application/json' } });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new CollectionError('TIMEOUT', 'A API da Meta não respondeu dentro do tempo limite.');
      }
      // Não propaga a mensagem original: pode conter a URL com o token.
      throw new CollectionError('SOURCE_UNAVAILABLE', 'Falha de rede ao acessar a API da Meta.');
    }
    const observedAt = new Date();

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      if (res.status >= 500) throw new CollectionError('SOURCE_UNAVAILABLE', `A API da Meta respondeu HTTP ${res.status}.`);
      throw new CollectionError('INVALID_RESPONSE', `Resposta não-JSON da API da Meta (HTTP ${res.status}).`);
    }

    if (!res.ok) throw mapGraphError(res, body);

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      throw new CollectionError('INVALID_RESPONSE', 'A resposta da Meta não tem o formato esperado.', {
        detail: { issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) },
      });
    }
    const bd = parsed.data.business_discovery;

    return {
      profile: {
        externalId: bd.id ?? null,
        username: (bd.username ?? username).toLowerCase(),
        fullName: bd.name ?? null,
        profilePictureUrl: bd.profile_picture_url ?? null,
        followersCount: bd.followers_count ?? null,
        followsCount: bd.follows_count ?? null,
        mediaCount: bd.media_count ?? null,
      },
      media: opts.includeMedia ? (bd.media?.data ?? []).map(mapMedia) : null,
      mediaHasMore: Boolean(bd.media?.paging?.next),
      observedAt,
      requestsMade: 1,
    };
  }
}

export function mapMediaType(t: string | null | undefined): MediaType {
  switch ((t ?? '').toUpperCase()) {
    case 'IMAGE':
      return 'image';
    case 'CAROUSEL_ALBUM':
      return 'carousel';
    case 'VIDEO':
      return 'video';
    default:
      return 'unknown';
  }
}

function mapMedia(m: z.infer<typeof mediaSchema>): MediaObservation {
  const type = mapMediaType(m.media_type);
  const ts = m.timestamp ? new Date(m.timestamp) : null;
  return {
    externalId: m.id,
    permalink: m.permalink ?? null,
    mediaType: type,
    sourceMediaType: m.media_type ?? null,
    publishedAt: ts && !Number.isNaN(ts.getTime()) ? ts : null,
    caption: m.caption ?? null,
    // media_url de vídeo é o arquivo de vídeo, não uma miniatura.
    thumbnailUrl: type === 'image' || type === 'carousel' ? (m.media_url ?? null) : null,
    likeCount: m.like_count ?? null,
    commentsCount: m.comments_count ?? null,
  };
}

// Converte o erro da Graph API para o código padronizado.
export function mapGraphError(res: Response, body: unknown): CollectionError {
  const parsed = graphErrorSchema.safeParse(body);
  const e = parsed.success ? parsed.data.error : {};
  const code = e.code;
  const sub = e.error_subcode;
  const detail = { httpStatus: res.status, graphCode: code, graphSubcode: sub, fbtraceId: e.fbtrace_id };
  const msg = (e.message ?? '').slice(0, 300);

  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80002 || res.status === 429) {
    return new CollectionError('RATE_LIMITED', 'Limite de requisições da Meta atingido.', {
      retryAfterMs: retryAfterFromHeaders(res),
      detail,
    });
  }
  if (code === 190 || code === 102 || code === 10 || (code !== undefined && code >= 200 && code < 300)) {
    return new CollectionError('PROVIDER_AUTH_FAILED', `Token ou permissão inválidos na Meta: ${msg}`, { detail });
  }
  if (code === 110 || sub === 2207013) {
    return new CollectionError(
      'PROFILE_NOT_FOUND_OR_PERSONAL',
      'A Meta não encontrou o perfil. Ele pode não existir, ter mudado de @, ser conta pessoal ou ter restrição de idade.',
      { detail },
    );
  }
  if (code === 100 && /nonexist|field/i.test(msg)) {
    return new CollectionError('UNSUPPORTED_FIELD', `Campo não suportado pela Meta: ${msg}`, { detail });
  }
  if (code === 1 || code === 2 || e.is_transient || res.status >= 500) {
    return new CollectionError('SOURCE_UNAVAILABLE', 'API da Meta temporariamente indisponível.', { detail });
  }
  return new CollectionError('PERMANENT_FAILURE', `Erro da Meta (código ${code ?? '?'}): ${msg}`, { detail });
}

// A Meta informa o tempo estimado para recuperar acesso (em minutos) nos cabeçalhos de uso.
function retryAfterFromHeaders(res: Response): number | null {
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  for (const h of ['x-business-use-case-usage', 'x-app-usage']) {
    const raw = res.headers.get(h);
    if (!raw) continue;
    try {
      const minutes = findNumberKey(JSON.parse(raw), 'estimated_time_to_regain_access');
      if (minutes !== null && minutes > 0) return minutes * 60_000;
    } catch {
      /* cabeçalho malformado: ignora */
    }
  }
  return null;
}

function findNumberKey(obj: unknown, key: string): number | null {
  if (obj === null || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const v = findNumberKey(x, key);
      if (v !== null) return v;
    }
    return null;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === key && typeof v === 'number') return v;
    const nested = findNumberKey(v, key);
    if (nested !== null) return nested;
  }
  return null;
}
