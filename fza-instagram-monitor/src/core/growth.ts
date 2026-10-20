import { DAY, HOUR, addDays, dayKey, dayKeysRange } from './time.js';

// Cálculos de crescimento a partir de snapshots imutáveis.
//
// Variação líquida = total atual − total anterior.
// Variação percentual = (variação líquida ÷ total anterior) × 100.
// A variação líquida NÃO é "novos seguidores" nem "unfollows": a fonte não fornece ganhos e perdas.

export interface Snapshot {
  observedAt: Date;
  followers: number | null;
  validity?: 'valid' | 'suspect';
}

export type Unavailable =
  | 'no_data'
  | 'insufficient_history'
  | 'gap'
  | 'division_by_zero';

export const UNAVAILABLE_LABEL: Record<Unavailable, string> = {
  no_data: 'Sem coleta válida',
  insufficient_history: 'Histórico insuficiente para o período',
  gap: 'Sem coleta próxima ao início do período',
  division_by_zero: 'Percentual indefinido (total anterior igual a zero)',
};

export interface NetChange {
  absolute: number | null;
  percent: number | null;
  percentUnavailable?: Unavailable;
  unavailable?: Unavailable;
  from?: { observedAt: string; followers: number };
  to?: { observedAt: string; followers: number };
  hoursCovered?: number;
}

export function netChange(prev: number | null | undefined, curr: number | null | undefined): Pick<NetChange, 'absolute' | 'percent' | 'percentUnavailable' | 'unavailable'> {
  if (prev == null || curr == null) return { absolute: null, percent: null, unavailable: 'no_data' };
  const absolute = curr - prev;
  if (prev === 0) return { absolute, percent: null, percentUnavailable: 'division_by_zero' };
  return { absolute, percent: (absolute / prev) * 100 };
}

// Apenas snapshots válidos com número de seguidores, em ordem cronológica.
export function usable(snaps: Snapshot[]): Snapshot[] {
  return snaps
    .filter((s) => s.followers != null && (s.validity ?? 'valid') === 'valid')
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
}

// Tolerância para aceitar um snapshot como "início do período": 25% do período, entre 3 h e 3 dias.
export function toleranceFor(periodMs: number): number {
  return Math.min(3 * DAY, Math.max(3 * HOUR, periodMs * 0.25));
}

// Variação no período terminando no snapshot mais recente.
// O início é o último snapshot em [alvo − tolerância, alvo], onde alvo = fim − período.
// Sem snapshot nessa janela, informa o motivo em vez de inventar um valor.
export function periodChange(snaps: Snapshot[], periodMs: number): NetChange {
  const s = usable(snaps);
  if (s.length === 0) return { absolute: null, percent: null, unavailable: 'no_data' };
  const last = s[s.length - 1];
  const target = last.observedAt.getTime() - periodMs;
  const tol = toleranceFor(periodMs);
  if (s[0].observedAt.getTime() > target) {
    return { absolute: null, percent: null, unavailable: 'insufficient_history' };
  }
  let base: Snapshot | undefined;
  for (const x of s) {
    const t = x.observedAt.getTime();
    if (t > target) break;
    if (t >= target - tol) base = x;
  }
  if (!base) return { absolute: null, percent: null, unavailable: 'gap' };
  return {
    ...netChange(base.followers, last.followers),
    from: { observedAt: base.observedAt.toISOString(), followers: base.followers! },
    to: { observedAt: last.observedAt.toISOString(), followers: last.followers! },
    hoursCovered: (last.observedAt.getTime() - base.observedAt.getTime()) / HOUR,
  };
}

// Última coleta x coleta anterior.
export function lastVsPrevious(snaps: Snapshot[]): NetChange {
  const s = usable(snaps);
  if (s.length < 2) return { absolute: null, percent: null, unavailable: s.length ? 'insufficient_history' : 'no_data' };
  const a = s[s.length - 2];
  const b = s[s.length - 1];
  return {
    ...netChange(a.followers, b.followers),
    from: { observedAt: a.observedAt.toISOString(), followers: a.followers! },
    to: { observedAt: b.observedAt.toISOString(), followers: b.followers! },
    hoursCovered: (b.observedAt.getTime() - a.observedAt.getTime()) / HOUR,
  };
}

export interface DailyPoint {
  day: string;
  // Fechamento do dia: último snapshot válido do dia. null = sem coleta no dia (lacuna).
  followers: number | null;
  // Variação em relação ao fechamento do dia anterior; null se algum dos dois dias não tem coleta.
  change: number | null;
  samples: number;
}

export function dailySeries(snaps: Snapshot[], fromDay: string, toDay: string, tz: string): DailyPoint[] {
  const closes = new Map<string, { followers: number; samples: number }>();
  for (const x of usable(snaps)) {
    const k = dayKey(x.observedAt, tz);
    const prev = closes.get(k);
    closes.set(k, { followers: x.followers!, samples: (prev?.samples ?? 0) + 1 });
  }
  return dayKeysRange(fromDay, toDay).map((day) => {
    const c = closes.get(day);
    const p = closes.get(addDays(day, -1));
    return {
      day,
      followers: c ? c.followers : null,
      change: c && p ? c.followers - p.followers : null,
      samples: c?.samples ?? 0,
    };
  });
}

// Melhor e pior variação diária, considerando só dias com fechamento no dia e no dia anterior.
export function bestWorstDaily(series: DailyPoint[]) {
  const valid = series.filter((p) => p.change != null);
  if (valid.length === 0) return { best: null, worst: null, daysWithData: 0 };
  let best = valid[0];
  let worst = valid[0];
  for (const p of valid) {
    if (p.change! > best.change!) best = p;
    if (p.change! < worst.change!) worst = p;
  }
  return {
    best: { day: best.day, change: best.change! },
    worst: { day: worst.day, change: worst.change! },
    daysWithData: valid.length,
  };
}

// Classifica a tendência com base na variação percentual do período.
export function classifyTrend(percent: number | null, stableBandPct = 0.5): 'growing' | 'stable' | 'declining' | null {
  if (percent == null) return null;
  if (percent > stableBandPct) return 'growing';
  if (percent < -stableBandPct) return 'declining';
  return 'stable';
}
