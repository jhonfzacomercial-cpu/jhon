// Backoff exponencial com jitter ("equal jitter"): metade fixa + metade aleatória.
// Evita que vários perfis com falha voltem a tentar no mesmo instante.
export function backoffMs(
  failures: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, failures - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}
