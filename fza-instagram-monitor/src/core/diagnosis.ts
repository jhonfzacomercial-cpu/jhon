import { DAY } from './time.js';
import { classifyTrend, periodChange, usable, type Snapshot } from './growth.js';
import { longestGapDays, type MediaRow, type PostingStats } from './posting.js';

// Diagnóstico automatizado: só afirmações sustentadas pelos dados coletados.
// Cada achado informa o período analisado e a quantidade de dados.
// Nunca atribui causa a uma variação de seguidores.

export type FindingLevel = 'positive' | 'neutral' | 'attention' | 'insufficient';

export interface Finding {
  key: string;
  level: FindingLevel;
  title: string;
  text: string;
  period: string;
  dataPoints: string;
}

const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2).replace('.', ',')}%`;
const fmtInt = (n: number) => `${n >= 0 ? '+' : ''}${n.toLocaleString('pt-BR')}`;

export interface DiagnosisInput {
  snapshots: Snapshot[];
  media: MediaRow[];
  posting: PostingStats;
  coverageStart: Date | null;
  now: Date;
  postingGoalPerWeek: number | null;
  inactivityDays: number;
}

export function diagnose(input: DiagnosisInput): Finding[] {
  const out: Finding[] = [];
  const s = usable(input.snapshots);
  const first = s[0]?.observedAt;
  const last = s[s.length - 1]?.observedAt;
  const historyDays = first && last ? (last.getTime() - first.getTime()) / DAY : 0;

  // 1) Tendência: usa 30 dias se houver; senão 7 dias.
  const c30 = periodChange(s, 30 * DAY);
  const c7 = periodChange(s, 7 * DAY);
  const chosen = c30.absolute != null ? { c: c30, days: 30 } : c7.absolute != null ? { c: c7, days: 7 } : null;
  if (!chosen) {
    out.push({
      key: 'trend',
      level: 'insufficient',
      title: 'Tendência de seguidores',
      text: 'Ainda não há histórico suficiente para avaliar a tendência (mínimo: 7 dias de coletas).',
      period: first ? `desde ${first.toISOString()}` : 'sem coletas válidas',
      dataPoints: `${s.length} coleta(s) válida(s), ${historyDays.toFixed(1).replace('.', ',')} dia(s) de histórico`,
    });
  } else {
    const trend = classifyTrend(chosen.c.percent);
    const label = trend === 'growing' ? 'em crescimento' : trend === 'declining' ? 'em queda' : 'estável';
    out.push({
      key: 'trend',
      level: trend === 'growing' ? 'positive' : trend === 'declining' ? 'attention' : 'neutral',
      title: `Perfil ${label}`,
      text:
        `Variação líquida de ${fmtInt(chosen.c.absolute!)} seguidores` +
        (chosen.c.percent != null ? ` (${fmtPct(chosen.c.percent)})` : '') +
        ` nos últimos ${chosen.days} dias. Faixa de estabilidade: ±0,5%. ` +
        'A variação líquida não separa novos seguidores de quem deixou de seguir.',
      period: `${chosen.c.from!.observedAt} a ${chosen.c.to!.observedAt}`,
      dataPoints: `${s.filter((x) => x.observedAt.getTime() >= Date.parse(chosen.c.from!.observedAt)).length} coletas no período`,
    });
  }

  // 2) Aceleração: últimos 7 dias x 7 dias anteriores.
  if (s.length >= 3 && historyDays >= 14) {
    const lastT = last!.getTime();
    const prevSnaps = s.filter((x) => x.observedAt.getTime() <= lastT - 7 * DAY);
    const recent = periodChange(s, 7 * DAY);
    const previous = periodChange(prevSnaps, 7 * DAY);
    if (recent.absolute != null && previous.absolute != null) {
      const diff = recent.absolute - previous.absolute;
      const relevant = Math.abs(diff) >= Math.max(10, Math.abs(previous.absolute) * 0.5);
      out.push({
        key: 'acceleration',
        level: relevant ? (diff > 0 ? 'positive' : 'attention') : 'neutral',
        title: relevant
          ? diff > 0
            ? 'Aumento relevante da variação líquida'
            : 'Redução relevante da variação líquida'
          : 'Variação líquida semelhante à semana anterior',
        text: `Últimos 7 dias: ${fmtInt(recent.absolute)}; 7 dias anteriores: ${fmtInt(previous.absolute)}. Critério de relevância: diferença ≥ 10 seguidores e ≥ 50% da semana anterior.`,
        period: `${previous.from!.observedAt} a ${recent.to!.observedAt}`,
        dataPoints: `${s.filter((x) => x.observedAt.getTime() >= Date.parse(previous.from!.observedAt)).length} coletas`,
      });
    }
  }

  // 3) Comparação com o próprio histórico: média semanal desde o início x última semana.
  if (historyDays >= 21 && c7.absolute != null) {
    const total = s[s.length - 1].followers! - s[0].followers!;
    const weeklyAvg = (total / historyDays) * 7;
    out.push({
      key: 'own_history',
      level: c7.absolute > weeklyAvg ? 'positive' : c7.absolute < weeklyAvg ? 'attention' : 'neutral',
      title: 'Comparação com o histórico do perfil',
      text: `Últimos 7 dias: ${fmtInt(c7.absolute)}. Média semanal desde o início do monitoramento: ${fmtInt(Math.round(weeklyAvg))}.`,
      period: `${first!.toISOString()} a ${last!.toISOString()}`,
      dataPoints: `${s.length} coletas em ${Math.floor(historyDays)} dias`,
    });
  }

  // 4) Frequência de publicação x meta.
  const p = input.posting;
  if (!p.available) {
    out.push({
      key: 'posting',
      level: 'insufficient',
      title: 'Publicações',
      text: p.unavailableReason ?? 'Publicações indisponíveis nesta fonte.',
      period: '—',
      dataPoints: '0 publicações',
    });
  } else if (input.postingGoalPerWeek != null) {
    if (p.postsPerWeek == null) {
      out.push({
        key: 'posting_goal',
        level: 'insufficient',
        title: 'Frequência x meta',
        text: `Meta: ${input.postingGoalPerWeek} por semana. Cobertura de publicações ainda inferior a 7 dias para calcular a frequência.`,
        period: p.coverageStart ? `desde ${p.coverageStart}` : '—',
        dataPoints: `${input.media.length} publicações observadas`,
      });
    } else {
      const above = p.postsPerWeek >= input.postingGoalPerWeek;
      out.push({
        key: 'posting_goal',
        level: above ? 'positive' : 'attention',
        title: above ? 'Frequência dentro ou acima da meta' : 'Frequência abaixo da meta',
        text: `Média de ${p.postsPerWeek.toFixed(1).replace('.', ',')} publicações por semana; meta de ${input.postingGoalPerWeek}.`,
        period: `últimos ${p.postsPerWeekBasisDays} dias`,
        dataPoints: `${p.windows.find((w) => w.days === 30)?.count ?? 0} publicações em 30 dias`,
      });
    }
  }

  // 5) Períodos sem publicação.
  if (p.available) {
    const gap = longestGapDays(input.media, input.now, input.coverageStart);
    if (gap && gap.days >= input.inactivityDays) {
      out.push({
        key: 'posting_gap',
        level: 'attention',
        title: 'Período sem publicações',
        text: `Maior intervalo sem publicações observado: ${gap.days} dias (limite configurado: ${input.inactivityDays}).`,
        period: `${gap.from} a ${gap.to}`,
        dataPoints: `publicações desde ${input.coverageStart!.getTime() === 0 ? 'o início do perfil' : input.coverageStart!.toISOString()}`,
      });
    }
  }

  return out;
}
