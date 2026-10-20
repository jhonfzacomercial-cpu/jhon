import { describe, expect, it } from 'vitest';
import { MetaBusinessDiscoveryProvider } from '../src/providers/meta.js';
import { CollectionError } from '../src/providers/errors.js';

// Testes do adaptador com respostas simuladas no formato documentado da Graph API.
// A validação contra a API real é feita com `npm run provider:check` (ver docs/PROVEDOR-META.md).

const TOKEN = 'EAAGtokenSecreto1234567890abcdef';

function provider(handler: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = [];
  const p = new MetaBusinessDiscoveryProvider({
    apiVersion: 'v25.0',
    igUserId: '17841400000000000',
    accessToken: TOKEN,
    appSecret: 'segredo-do-app',
    fetchImpl: (async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      return handler(url);
    }) as typeof fetch,
  });
  return { p, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('MetaBusinessDiscoveryProvider', () => {
  it('monta a consulta business_discovery e converte a resposta', async () => {
    const { p, calls } = provider(() =>
      json({
        business_discovery: {
          id: '17841401111111111',
          username: 'GrupoFZA',
          name: 'Grupo FZA',
          profile_picture_url: 'https://scontent.cdninstagram.com/x.jpg',
          followers_count: 12347,
          follows_count: 321,
          media_count: 512,
          media: {
            data: [
              { id: '1', media_type: 'IMAGE', media_url: 'https://scontent.cdninstagram.com/1.jpg', permalink: 'https://www.instagram.com/p/A/', timestamp: '2026-10-18T13:00:00+0000', like_count: 10, comments_count: 2 },
              { id: '2', media_type: 'VIDEO', media_url: 'https://video.cdninstagram.com/2.mp4', permalink: 'https://www.instagram.com/reel/B/', timestamp: '2026-10-17T13:00:00+0000' },
              { id: '3', media_type: 'CAROUSEL_ALBUM', permalink: 'https://www.instagram.com/p/C/', timestamp: '2026-10-16T13:00:00+0000' },
            ],
            paging: { cursors: { after: 'x' }, next: 'https://graph.facebook.com/next' },
          },
        },
        id: '17841400000000000',
      }),
    );
    const r = await p.fetchProfile('grupofza', { includeMedia: true, mediaLimit: 25 });
    const fields = calls[0].searchParams.get('fields')!;
    expect(calls[0].pathname).toBe('/v25.0/17841400000000000');
    expect(fields).toContain('business_discovery.username(grupofza)');
    expect(fields).toContain('followers_count');
    expect(fields).toContain('media.limit(25){');
    expect(calls[0].searchParams.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);

    expect(r.profile).toEqual({
      externalId: '17841401111111111',
      username: 'grupofza',
      fullName: 'Grupo FZA',
      profilePictureUrl: 'https://scontent.cdninstagram.com/x.jpg',
      followersCount: 12347,
      followsCount: 321,
      mediaCount: 512,
    });
    expect(r.media!.map((m) => m.mediaType)).toEqual(['image', 'video', 'carousel']);
    expect(r.media![0].publishedAt!.toISOString()).toBe('2026-10-18T13:00:00.000Z');
    // URL de vídeo não é usada como miniatura.
    expect(r.media![1].thumbnailUrl).toBeNull();
    expect(r.mediaHasMore).toBe(true);
  });

  it('sem mídia solicitada não pede o campo media', async () => {
    const { p, calls } = provider(() => json({ business_discovery: { id: '1', followers_count: 5 } }));
    const r = await p.fetchProfile('fza', { includeMedia: false, mediaLimit: 25 });
    expect(calls[0].searchParams.get('fields')).not.toContain('media.limit');
    expect(r.media).toBeNull();
  });

  it('campo ausente vira null, nunca zero', async () => {
    const { p } = provider(() => json({ business_discovery: { id: '1' } }));
    const r = await p.fetchProfile('fza', { includeMedia: false, mediaLimit: 5 });
    expect(r.profile.followersCount).toBeNull();
    expect(r.profile.mediaCount).toBeNull();
  });

  const cases: [string, Response, string][] = [
    ['perfil não encontrado/pessoal', json({ error: { message: 'Invalid user id', code: 110, error_subcode: 2207013 } }, 400), 'PROFILE_NOT_FOUND_OR_PERSONAL'],
    ['token expirado', json({ error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } }, 400), 'PROVIDER_AUTH_FAILED'],
    ['permissão ausente', json({ error: { message: 'Requires permission', code: 10 } }, 403), 'PROVIDER_AUTH_FAILED'],
    ['limite de requisições', json({ error: { message: 'Application request limit reached', code: 4 } }, 400), 'RATE_LIMITED'],
    ['campo não suportado', json({ error: { message: 'Tried accessing nonexisting field (foo)', code: 100 } }, 400), 'UNSUPPORTED_FIELD'],
    ['erro transitório', json({ error: { message: 'An unexpected error has occurred', code: 2, is_transient: true } }, 500), 'SOURCE_UNAVAILABLE'],
    ['HTML no lugar de JSON', new Response('<html>bad gateway</html>', { status: 502 }), 'SOURCE_UNAVAILABLE'],
    ['formato inesperado', json({ algo: 'diferente' }), 'INVALID_RESPONSE'],
  ];
  it.each(cases)('mapeia erro: %s', async (_name, response, code) => {
    const { p } = provider(() => response);
    const err = await p.fetchProfile('fza', { includeMedia: false, mediaLimit: 5 }).catch((e) => e);
    expect(err).toBeInstanceOf(CollectionError);
    expect(err.code).toBe(code);
    expect(err.message).not.toContain(TOKEN);
  });

  it('lê o tempo de recuperação do cabeçalho de uso da Meta', async () => {
    const usage = JSON.stringify({ '123': [{ type: 'instagram', call_count: 100, estimated_time_to_regain_access: 7 }] });
    const { p } = provider(() => json({ error: { message: 'limit', code: 80002 } }, 400, { 'x-business-use-case-usage': usage }));
    const err = await p.fetchProfile('fza', { includeMedia: false, mediaLimit: 5 }).catch((e) => e);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryAfterMs).toBe(7 * 60_000);
  });

  it('falha de rede não vaza a URL com o token', async () => {
    const p = new MetaBusinessDiscoveryProvider({
      apiVersion: 'v25.0',
      igUserId: '1',
      accessToken: TOKEN,
      fetchImpl: (async (u: string) => {
        throw new Error(`connect ECONNREFUSED ${u}`);
      }) as unknown as typeof fetch,
    });
    const err = await p.fetchProfile('fza', { includeMedia: false, mediaLimit: 5 }).catch((e) => e);
    expect(err.code).toBe('SOURCE_UNAVAILABLE');
    expect(JSON.stringify({ m: err.message, d: err.detail })).not.toContain(TOKEN);
  });

  it('timeout vira TIMEOUT', async () => {
    const p = new MetaBusinessDiscoveryProvider({
      apiVersion: 'v25.0',
      igUserId: '1',
      accessToken: TOKEN,
      timeoutMs: 20,
      fetchImpl: ((_u: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason)))) as unknown as typeof fetch,
    });
    const err = await p.fetchProfile('fza', { includeMedia: false, mediaLimit: 5 }).catch((e) => e);
    expect(err.code).toBe('TIMEOUT');
  });

  it('sem configuração não chama a API', async () => {
    const p = new MetaBusinessDiscoveryProvider({ apiVersion: 'v25.0' });
    expect(p.configStatus()).toMatchObject({ configured: false, missing: ['META_IG_USER_ID', 'META_ACCESS_TOKEN'] });
    await expect(p.fetchProfile('fza', { includeMedia: false, mediaLimit: 1 })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});
