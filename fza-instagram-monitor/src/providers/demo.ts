import { createHash } from 'node:crypto';
import { CollectionError } from './errors.js';
import type { FetchOptions, MediaObservation, MediaType, ProfileFetchResult, ProfileProvider } from './types.js';

// Fonte de DEMONSTRAÇÃO: gera números sintéticos para desenvolvimento local.
// Tudo o que ela produz é gravado com source = 'demo' e a interface exibe o selo DEMO.
// Bloqueada em produção (ver config/env.ts).
//
// Usernames especiais para testar estados de erro:
//   demo_naoexiste*  -> perfil não encontrado
//   demo_privado*    -> perfil indisponível
//   demo_instavel*   -> fonte indisponível em ~50% das coletas

function seed(s: string): number {
  return createHash('sha256').update(s).digest().readUInt32BE(0);
}

export class DemoProvider implements ProfileProvider {
  readonly id = 'demo' as const;
  readonly displayName = 'DEMO — dados sintéticos (não são do Instagram)';
  readonly isDemo = true;
  readonly capabilities = {
    followersCount: true,
    followsCount: true,
    mediaCount: true,
    recentMedia: true,
    distinguishesReels: true,
    followerGainsAndLosses: false,
    followerBackfill: false,
    supportedAccountTypes: 'Qualquer @ (dados inventados).',
    notes: ['Fonte de demonstração: os números são sintéticos e não representam o Instagram.'],
  };

  constructor(private readonly now: () => Date = () => new Date()) {}

  configStatus() {
    return { configured: true, missing: [], instructions: [] };
  }

  async fetchProfile(username: string, opts: FetchOptions): Promise<ProfileFetchResult> {
    const now = this.now();
    if (username.startsWith('demo_naoexiste')) {
      throw new CollectionError('PROFILE_NOT_FOUND_OR_PERSONAL', 'DEMO: perfil não encontrado.');
    }
    if (username.startsWith('demo_privado')) {
      throw new CollectionError('PROFILE_PRIVATE_OR_UNAVAILABLE', 'DEMO: perfil indisponível.');
    }
    if (username.startsWith('demo_instavel') && seed(username + now.toISOString().slice(0, 15)) % 2 === 0) {
      throw new CollectionError('SOURCE_UNAVAILABLE', 'DEMO: fonte indisponível.');
    }

    const s = seed(username);
    const base = 2_000 + (s % 50_000);
    const trendPerDay = ((s >> 8) % 41) - 15; // de -15 a +25 por dia
    const days = now.getTime() / 86_400_000;
    const noise = (seed(username + Math.floor(days * 24)) % 21) - 10;
    const followers = Math.max(0, Math.round(base + trendPerDay * (days - 20_697) + noise));

    const everyDays = 1 + (s % 5);
    const media: MediaObservation[] = [];
    const types: MediaType[] = ['image', 'carousel', 'reel', 'video'];
    const startDay = Math.floor(days);
    for (let d = startDay; media.length < opts.mediaLimit && d > startDay - 120; d--) {
      if (d % everyDays !== 0) continue;
      const publishedAt = new Date(d * 86_400_000 + ((s >> 4) % 12) * 3_600_000 + 11 * 3_600_000);
      if (publishedAt > now) continue;
      const id = `demo_${username}_${d}`;
      media.push({
        externalId: id,
        permalink: null,
        mediaType: types[seed(id) % types.length],
        sourceMediaType: 'DEMO',
        publishedAt,
        caption: 'Publicação de demonstração (DEMO)',
        thumbnailUrl: null,
        likeCount: seed(id) % 500,
        commentsCount: seed(id) % 40,
      });
    }

    return {
      profile: {
        externalId: `demo_${s}`,
        username,
        fullName: `DEMO ${username}`,
        profilePictureUrl: null,
        followersCount: followers,
        followsCount: 100 + (s % 900),
        mediaCount: 50 + Math.floor(days / everyDays) % 1000,
      },
      media: opts.includeMedia ? media : null,
      mediaHasMore: true,
      observedAt: now,
      requestsMade: 1,
    };
  }
}
