// Datas: armazenadas em UTC; agrupamento por dia e exibição no fuso de apresentação.

export const DEFAULT_TZ = 'America/Campo_Grande';
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

const keyFormatters = new Map<string, Intl.DateTimeFormat>();

// 'YYYY-MM-DD' da data no fuso indicado.
export function dayKey(d: Date, tz = DEFAULT_TZ): string {
  let f = keyFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    keyFormatters.set(tz, f);
  }
  return f.format(d);
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * DAY;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetweenKeys(a: string, b: string): number {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / DAY);
}

export function dayKeysRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

// ISO week key 'YYYY-Www' a partir de uma chave de dia.
export function weekKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function monthKey(key: string): string {
  return key.slice(0, 7);
}
