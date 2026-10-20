import { DAY } from './time.js';
import type { MediaType } from '../providers/types.js';

// Estatísticas de publicação a partir das publicações observadas pelo sistema.
//
// Cobertura: a fonte devolve só as N publicações mais recentes. Se houver mais além delas,
// só temos certeza de ter visto TODAS as publicações a partir da mais antiga retornada.
// O perfil guarda media_coverage_start = o menor desses limites já observado. Uma contagem
// numa janela que começa antes da cobertura é um limite inferior ("pelo menos N").

export interface MediaRow {
  publishedAt: Date | null;
  mediaType: MediaType;
}

export interface WindowCount {
  days: number;
  count: number;
  // false = a janela começa antes da cobertura conhecida; count é um mínimo.
  complete: boolean;
}

export interface PostingStats {
  available: boolean;
  unavailableReason?: string;
  latestPublishedAt: string | null;
  daysSinceLatest: number | null;
  windows: WindowCount[];
  byType: Record<MediaType, number>;
  byTypeWindowDays: number;
  postsPerWeek: number | null;
  postsPerWeekBasisDays: number | null;
  coverageStart: string | null;
}

export function coverageStartFromFetch(media: { publishedAt: Date | null }[], hasMore: boolean): Date | null {
  // Sem "mais publicações": vimos tudo o que o perfil tem.
  if (!hasMore) return new Date(0);
  const dates = media.map((m) => m.publishedAt?.getTime()).filter((t): t is number => t != null);
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates));
}

export function postingStats(
  media: MediaRow[],
  opts: { now: Date; coverageStart: Date | null; mediaCollected: boolean; windows?: number[] },
): PostingStats {
  const windows = opts.windows ?? [7, 15, 30];
  const emptyTypes: Record<MediaType, number> = { image: 0, carousel: 0, video: 0, reel: 0, unknown: 0 };
  if (!opts.mediaCollected) {
    return {
      available: false,
      unavailableReason: 'Publicações ainda não coletadas com sucesso para este perfil.',
      latestPublishedAt: null,
      daysSinceLatest: null,
      windows: [],
      byType: emptyTypes,
      byTypeWindowDays: 30,
      postsPerWeek: null,
      postsPerWeekBasisDays: null,
      coverageStart: null,
    };
  }
  const now = opts.now.getTime();
  const dated = media.filter((m) => m.publishedAt != null).map((m) => ({ t: m.publishedAt!.getTime(), type: m.mediaType }));
  // A mais recente é o MAIOR published_at (a ordem da fonte pode ter publicações fixadas no topo).
  const latest = dated.length ? Math.max(...dated.map((d) => d.t)) : null;
  const cov = opts.coverageStart?.getTime() ?? null;

  const winCounts = windows.map((days) => {
    const start = now - days * DAY;
    return {
      days,
      count: dated.filter((d) => d.t >= start && d.t <= now).length,
      complete: cov != null && cov <= start,
    };
  });

  const byType = { ...emptyTypes };
  const typeStart = now - 30 * DAY;
  for (const d of dated) if (d.t >= typeStart) byType[d.type]++;

  // Frequência semanal: na janela de 30 dias se completa; senão, no trecho efetivamente coberto.
  let postsPerWeek: number | null = null;
  let basis: number | null = null;
  const w30 = winCounts.find((w) => w.days === 30);
  if (w30?.complete) {
    postsPerWeek = (w30.count / 30) * 7;
    basis = 30;
  } else if (cov != null && cov > 0) {
    const spanDays = (now - cov) / DAY;
    if (spanDays >= 7) {
      const n = dated.filter((d) => d.t >= cov).length;
      postsPerWeek = (n / spanDays) * 7;
      basis = Math.floor(spanDays);
    }
  }

  return {
    available: true,
    latestPublishedAt: latest != null ? new Date(latest).toISOString() : null,
    daysSinceLatest: latest != null ? Math.floor((now - latest) / DAY) : null,
    windows: winCounts,
    byType,
    byTypeWindowDays: 30,
    postsPerWeek,
    postsPerWeekBasisDays: basis,
    coverageStart: cov != null ? new Date(cov).toISOString() : null,
  };
}

// Maior intervalo sem publicações dentro da cobertura conhecida (inclui o intervalo até agora).
export function longestGapDays(media: MediaRow[], now: Date, coverageStart: Date | null) {
  if (!coverageStart) return null;
  const cov = coverageStart.getTime();
  const ts = media
    .map((m) => m.publishedAt?.getTime())
    .filter((t): t is number => t != null && t >= cov)
    .sort((a, b) => a - b);
  if (ts.length === 0) return null;
  let best = { days: (now.getTime() - ts[ts.length - 1]) / DAY, from: ts[ts.length - 1], to: now.getTime() };
  for (let i = 1; i < ts.length; i++) {
    const g = (ts[i] - ts[i - 1]) / DAY;
    if (g > best.days) best = { days: g, from: ts[i - 1], to: ts[i] };
  }
  return { days: Math.floor(best.days), from: new Date(best.from).toISOString(), to: new Date(best.to).toISOString() };
}
