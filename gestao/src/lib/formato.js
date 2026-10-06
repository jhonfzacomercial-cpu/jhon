import { hoje, diffDias, parseData, nomeMes, MESES } from '../../shared/constantes.js';

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** 06/10 (ou 06/10/2025 se for de outro ano). */
export function data(s, { ano = false } = {}) {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-');
  return ano || y !== hoje().slice(0, 4) ? `${d}/${m}/${y}` : `${d}/${m}`;
}
export const dataHora = (s) => (s ? `${data(s)} ${s.slice(11, 16)}` : '—');
export const diaSemana = (s) => DIAS[parseData(s).getDay()];
export function dataLonga(s) {
  const d = parseData(s);
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()} de ${d.getFullYear()}`;
}

/** "hoje", "amanhã", "ontem", "em 3 dias", "há 2 dias". */
export function relativo(s) {
  if (!s) return '';
  const n = diffDias(s, hoje());
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  if (n > 1 && n <= 6) return `${diaSemana(s)}`;
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}

/** Prazo com rótulo e tom (para badge). */
export function prazo(s, fechado = false) {
  if (!s) return { texto: 'sem prazo', tom: 'outline' };
  if (fechado) return { texto: data(s), tom: '' };
  const n = diffDias(s, hoje());
  if (n < 0) return { texto: `${data(s)} · ${-n}d atraso`, tom: 'red' };
  if (n === 0) return { texto: 'hoje', tom: 'orange' };
  if (n === 1) return { texto: 'amanhã', tom: 'amber' };
  if (n <= 7) return { texto: `${data(s)} · ${diaSemana(s).slice(0, 3)}`, tom: 'amber' };
  return { texto: data(s), tom: '' };
}

export const mes = (m) => (m ? nomeMes(m) : '—');
export const iniciais = (nome = '') => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
export const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
export const tamanho = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
