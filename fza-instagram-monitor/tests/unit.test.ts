import { describe, expect, it } from 'vitest';
import { normalizeUsername } from '../src/core/username.js';
import { bestWorstDaily, dailySeries, lastVsPrevious, netChange, periodChange } from '../src/core/growth.js';
import { coverageStartFromFetch, postingStats } from '../src/core/posting.js';
import { backoffMs } from '../src/worker/backoff.js';
import { csvCell } from '../src/server/routes/export.js';
import { redactSecrets } from '../src/providers/errors.js';
import { suspectReason } from '../src/worker/collector.js';
import { DAY, HOUR, dayKey } from '../src/core/time.js';

const TZ = 'America/Campo_Grande';
const t = (iso: string) => new Date(iso);

describe('1. normalização do @', () => {
  it.each([
    ['@Grupo.FZA', 'grupo.fza'],
    ['  grupofza  ', 'grupofza'],
    ['https://www.instagram.com/grupofza/', 'grupofza'],
    ['instagram.com/grupofza?hl=pt-br', 'grupofza'],
    ['http://m.instagram.com/Grupo_FZA', 'grupo_fza'],
    ['@@fza', 'fza'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeUsername(input)).toEqual({ ok: true, username: expected });
  });

  it.each(['', '   ', 'fza fza', 'https://facebook.com/fza', 'https://instagram.com/p/ABC123/', 'a'.repeat(31), '.fza', 'fza..x', 'fza!'])(
    'rejeita %j',
    (input) => {
      expect(normalizeUsername(input).ok).toBe(false);
    },
  );
});

describe('4. variação absoluta e percentual', () => {
  it('calcula líquida e percentual', () => {
    expect(netChange(1000, 1050)).toEqual({ absolute: 50, percent: 5 });
    expect(netChange(2000, 1990)).toEqual({ absolute: -10, percent: -0.5 });
  });
  it('divisão por zero não vira número', () => {
    expect(netChange(0, 10)).toEqual({ absolute: 10, percent: null, percentUnavailable: 'division_by_zero' });
  });
  it('dado ausente não vira zero', () => {
    expect(netChange(null, 10)).toMatchObject({ absolute: null, percent: null, unavailable: 'no_data' });
  });
  it('última x anterior ignora snapshots suspeitos', () => {
    const r = lastVsPrevious([
      { observedAt: t('2026-10-01T10:00:00Z'), followers: 1000 },
      { observedAt: t('2026-10-01T11:00:00Z'), followers: 1 , validity: 'suspect' },
      { observedAt: t('2026-10-01T12:00:00Z'), followers: 1010 },
    ]);
    expect(r).toMatchObject({ absolute: 10, percent: 1 });
  });
});

describe('5/12. ausência de histórico e períodos', () => {
  const base = t('2026-10-20T12:00:00Z').getTime();
  it('sem histórico suficiente informa o motivo', () => {
    const snaps = [
      { observedAt: new Date(base - 2 * DAY), followers: 100 },
      { observedAt: new Date(base), followers: 110 },
    ];
    expect(periodChange(snaps, 7 * DAY)).toMatchObject({ absolute: null, unavailable: 'insufficient_history' });
    expect(periodChange([], 7 * DAY)).toMatchObject({ absolute: null, unavailable: 'no_data' });
  });
  it('usa o snapshot mais próximo antes do alvo dentro da tolerância', () => {
    const snaps = [
      { observedAt: new Date(base - 8 * DAY), followers: 90 },
      { observedAt: new Date(base - 7 * DAY - 2 * HOUR), followers: 100 },
      { observedAt: new Date(base), followers: 120 },
    ];
    const r = periodChange(snaps, 7 * DAY);
    expect(r).toMatchObject({ absolute: 20, percent: 20 });
    expect(r.from!.followers).toBe(100);
  });
  it('lacuna perto do início do período não é preenchida', () => {
    const snaps = [
      { observedAt: new Date(base - 20 * DAY), followers: 90 },
      { observedAt: new Date(base), followers: 120 },
    ];
    expect(periodChange(snaps, 7 * DAY)).toMatchObject({ absolute: null, unavailable: 'gap' });
  });
  it('série diária marca dias sem coleta como null (lacuna)', () => {
    const snaps = [
      { observedAt: t('2026-10-01T15:00:00Z'), followers: 100 },
      { observedAt: t('2026-10-01T20:00:00Z'), followers: 102 },
      { observedAt: t('2026-10-02T15:00:00Z'), followers: 105 },
      { observedAt: t('2026-10-04T15:00:00Z'), followers: 101 },
    ];
    const s = dailySeries(snaps, '2026-10-01', '2026-10-04', TZ);
    expect(s.map((p) => p.followers)).toEqual([102, 105, null, 101]);
    expect(s.map((p) => p.change)).toEqual([null, 3, null, null]);
    expect(bestWorstDaily(s)).toMatchObject({ best: { day: '2026-10-02', change: 3 }, daysWithData: 1 });
  });
  it('agrupa por dia no fuso de Campo Grande (UTC−4)', () => {
    // 02:00 UTC do dia 2 ainda é dia 1 em Campo Grande.
    expect(dayKey(t('2026-10-02T02:00:00Z'), TZ)).toBe('2026-10-01');
    expect(dayKey(t('2026-10-02T05:00:00Z'), TZ)).toBe('2026-10-02');
  });
});

describe('8. publicação mais recente', () => {
  const now = t('2026-10-20T12:00:00Z');
  it('usa a maior data, mesmo com publicação fixada antiga no topo', () => {
    const media = [
      { publishedAt: t('2026-01-01T10:00:00Z'), mediaType: 'image' as const }, // fixada
      { publishedAt: t('2026-10-18T10:00:00Z'), mediaType: 'video' as const },
      { publishedAt: t('2026-10-10T10:00:00Z'), mediaType: 'carousel' as const },
    ];
    const s = postingStats(media, { now, coverageStart: new Date(0), mediaCollected: true });
    expect(s.latestPublishedAt).toBe('2026-10-18T10:00:00.000Z');
    expect(s.daysSinceLatest).toBe(2);
    expect(s.windows.find((w) => w.days === 7)).toEqual({ days: 7, count: 1, complete: true });
  });
  it('contagem é marcada como parcial quando a cobertura não alcança a janela', () => {
    const media = [{ publishedAt: t('2026-10-15T10:00:00Z'), mediaType: 'image' as const }];
    const s = postingStats(media, { now, coverageStart: t('2026-10-12T00:00:00Z'), mediaCollected: true });
    expect(s.windows.find((w) => w.days === 7)!.complete).toBe(true);
    expect(s.windows.find((w) => w.days === 30)!.complete).toBe(false);
  });
  it('sem coleta de mídia não afirma inatividade', () => {
    const s = postingStats([], { now, coverageStart: null, mediaCollected: false });
    expect(s.available).toBe(false);
    expect(s.daysSinceLatest).toBeNull();
  });
  it('cobertura: sem "mais páginas" vimos tudo; com mais páginas, desde a mais antiga', () => {
    expect(coverageStartFromFetch([], false)!.getTime()).toBe(0);
    expect(coverageStartFromFetch([{ publishedAt: t('2026-10-01T00:00:00Z') }, { publishedAt: t('2026-09-01T00:00:00Z') }], true)).toEqual(
      t('2026-09-01T00:00:00Z'),
    );
  });
});

describe('backoff e qualidade de dados', () => {
  it('backoff exponencial com jitter e teto', () => {
    expect(backoffMs(1, 60_000, 3_600_000, () => 0)).toBe(30_000);
    expect(backoffMs(1, 60_000, 3_600_000, () => 1)).toBe(60_000);
    expect(backoffMs(3, 60_000, 3_600_000, () => 1)).toBe(240_000);
    expect(backoffMs(20, 60_000, 3_600_000, () => 1)).toBe(3_600_000);
  });
  it('queda brusca em poucas horas é marcada como suspeita', () => {
    expect(suspectReason(10_000, 4_000, 1)).toMatch(/60%/);
    expect(suspectReason(10_000, 9_000, 1)).toBeNull();
    expect(suspectReason(500, 10, 1)).toBeNull();
  });
});

describe('10. segredos e CSV', () => {
  it('remove tokens de textos', () => {
    const s = redactSecrets('GET https://graph.facebook.com/v25.0/1?access_token=EAABsecret123&x=1 Bearer abc.def');
    expect(s).not.toContain('EAABsecret123');
    expect(s).not.toContain('abc.def');
  });
  it('protege contra injeção de fórmula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
  });
});
