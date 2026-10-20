// Formatação de exibição: datas no fuso America/Campo_Grande, números em pt-BR.

export const TZ = 'America/Campo_Grande';

const dt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const d = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const nf = new Intl.NumberFormat('pt-BR');
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtDateTime = (iso: string | null | undefined) => (iso ? dt.format(new Date(iso)) : '—');
export const fmtDate = (iso: string | null | undefined) => (iso ? d.format(new Date(iso)) : '—');
// Chave 'YYYY-MM-DD' (já no fuso de apresentação) -> 'DD/MM'.
export const fmtDayKey = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;
export const fmtDayKeyFull = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}`;
// 'YYYY-Www' -> 'sem. 39/26'; 'YYYY-MM' -> 'out/26'
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const fmtPeriod = (k: string) =>
  /^\d{4}-W\d{2}$/.test(k) ? `sem. ${k.slice(6)}/${k.slice(2, 4)}` : /^\d{4}-\d{2}$/.test(k) ? `${MONTHS[Number(k.slice(5)) - 1]}/${k.slice(2, 4)}` : k;
export const fmtInt = (n: number | null | undefined) => (n == null ? '—' : nf.format(n));
export const fmtCompact = (n: number) => compact.format(n);
export const fmtSigned = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf.format(Math.abs(n))}`);
export const fmtPct = (n: number | null | undefined, digits = 2) =>
  n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits).replace('.', ',')}%`;

export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'nunca';
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60_000);
  const txt = m < 1 ? 'agora' : m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} dias`;
  if (txt === 'agora') return txt;
  return diff < 0 ? `há ${txt}` : `em ${txt}`;
}

export function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDaysKey(key: string, n: number): string {
  const [y, m, dd] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd) + n * 86_400_000).toISOString().slice(0, 10);
}

export const UNAVAILABLE: Record<string, string> = {
  no_data: 'Sem coleta válida',
  insufficient_history: 'Histórico insuficiente',
  gap: 'Sem coleta no início do período',
  division_by_zero: 'Indefinido (base zero)',
};

export const PROFILE_STATE: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Aguardando 1ª coleta', tone: 'neutral' },
  ok: { label: 'OK', tone: 'good' },
  not_found_or_personal: { label: 'Não encontrado / conta pessoal', tone: 'critical' },
  private: { label: 'Privado / indisponível', tone: 'critical' },
  unavailable: { label: 'Indisponível', tone: 'critical' },
  error: { label: 'Erro de coleta', tone: 'serious' },
};

export const CLIENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Ativo', tone: 'good' },
  paused: { label: 'Pausado', tone: 'neutral' },
  archived: { label: 'Arquivado', tone: 'neutral' },
};

export const MEDIA_TYPE: Record<string, string> = {
  image: 'Imagem',
  carousel: 'Carrossel',
  video: 'Vídeo',
  reel: 'Reel',
  unknown: 'Não identificado',
};

export const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  success: { label: 'Sucesso', tone: 'good' },
  partial: { label: 'Parcial', tone: 'warning' },
  failed: { label: 'Falhou', tone: 'critical' },
  running: { label: 'Em execução', tone: 'neutral' },
  abandoned: { label: 'Interrompida', tone: 'serious' },
};

export const ALERT_TYPE: Record<string, string> = {
  no_posts: 'Sem publicações',
  negative_change: 'Variação negativa',
  low_growth: 'Crescimento abaixo da meta',
  posting_below_goal: 'Publicações abaixo da meta',
  collection_failing: 'Falha repetida na coleta',
  stale_data: 'Dados desatualizados',
  profile_unavailable: 'Perfil indisponível',
};

export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'info';
