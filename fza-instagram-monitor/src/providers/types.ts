// Contrato entre o coletor e qualquer fonte de dados.
// Trocar de fonte = escrever outro adaptador que implemente ProfileProvider.

export type ProviderId = 'meta_business_discovery' | 'demo';

export type MediaType = 'image' | 'carousel' | 'video' | 'reel' | 'unknown';

export interface ProviderCapabilities {
  followersCount: boolean;
  followsCount: boolean;
  mediaCount: boolean;
  recentMedia: boolean;
  // Se a fonte distingue Reel de vídeo comum.
  distinguishesReels: boolean;
  // Seguidores ganhos e perdidos separadamente. Nenhuma fonte pública oferece.
  followerGainsAndLosses: boolean;
  // Se a fonte fornece histórico anterior à primeira coleta.
  followerBackfill: boolean;
  // Que tipos de perfil a fonte consegue consultar.
  supportedAccountTypes: string;
  notes: string[];
}

export interface ProfileObservation {
  externalId: string | null;
  username: string;
  fullName: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
}

export interface MediaObservation {
  externalId: string | null;
  permalink: string | null;
  mediaType: MediaType;
  sourceMediaType: string | null;
  publishedAt: Date | null;
  caption: string | null;
  thumbnailUrl: string | null;
  likeCount: number | null;
  commentsCount: number | null;
}

export interface ProfileFetchResult {
  profile: ProfileObservation;
  // null = mídia não solicitada nesta coleta ou não suportada.
  media: MediaObservation[] | null;
  // true quando a fonte indicou que há mais publicações além das retornadas.
  mediaHasMore: boolean;
  // Momento em que a fonte respondeu (a fonte não informa outro horário de observação).
  observedAt: Date;
  requestsMade: number;
}

export interface FetchOptions {
  includeMedia: boolean;
  mediaLimit: number;
  signal?: AbortSignal;
}

export interface ConfigStatus {
  configured: boolean;
  missing: string[];
  instructions: string[];
}

export interface ProfileProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly isDemo: boolean;
  readonly capabilities: ProviderCapabilities;
  configStatus(): ConfigStatus;
  fetchProfile(username: string, opts: FetchOptions): Promise<ProfileFetchResult>;
}
