import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { loadSettings } from '../../core/settings.js';
import { loadSummaries } from '../services.js';

// Célula CSV segura: aspas escapadas e proteção contra injeção de fórmulas em planilhas.
export function csvCell(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM para o Excel reconhecer UTF-8; separador ";" (padrão do Excel em pt-BR).
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

function send(reply: FastifyReply, name: string, body: string) {
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${name}"`)
    .header('Cache-Control', 'no-store')
    .send(body);
}

const localFmt = (tz: string) => {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'medium' });
  return (d: Date | string | null) => (d ? f.format(new Date(d)) : '');
};

export async function registerExportRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get('/api/export/clients.csv', async (_req, reply) => {
    const settings = await loadSettings(db);
    const fmt = localFmt(settings.displayTimezone);
    const items = await loadSummaries(db, settings, app.clock(), { includeArchived: true });
    const csv = toCsv(
      ['cliente', 'categoria', 'status', 'instagram', 'estado_perfil', 'fonte', 'demo', 'seguidores_atuais',
       'variacao_liquida_24h', 'variacao_liquida_7d', 'variacao_pct_7d', 'variacao_liquida_30d', 'variacao_pct_30d',
       'ultima_coleta_ok_utc', 'ultima_coleta_ok_local', 'falhas_seguidas', 'ultimo_erro', 'alertas_ativos'],
      items.map((s) => [
        s.clientName, s.category, s.clientStatus, `@${s.username}`, s.profileState, s.source, s.isDemo ? 'sim' : 'não',
        s.currentFollowers, s.change24h.absolute, s.change7d.absolute, s.change7d.percent, s.change30d.absolute,
        s.change30d.percent, s.lastSuccessAt, fmt(s.lastSuccessAt), s.consecutiveFailures, s.lastErrorCode, s.openAlerts,
      ]),
    );
    return send(reply, 'fza-clientes.csv', csv);
  });

  app.get('/api/export/snapshots.csv', async (req, reply) => {
    const q = z.object({ clientId: z.string().uuid().optional() }).parse(req.query);
    const settings = await loadSettings(db);
    const fmt = localFmt(settings.displayTimezone);
    const { rows } = await db.query(
      `SELECT c.name, p.username::text AS username, s.followers_count, s.follows_count, s.media_count,
              s.observed_at, s.collected_at, s.source, s.validity, s.validity_reason
         FROM follower_snapshots s JOIN instagram_profiles p ON p.id = s.profile_id JOIN clients c ON c.id = p.client_id
        WHERE ($1::uuid IS NULL OR c.id = $1) ORDER BY c.name, s.observed_at`,
      [q.clientId ?? null],
    );
    const csv = toCsv(
      ['cliente', 'instagram', 'seguidores', 'seguindo', 'publicacoes', 'observado_em_utc', 'observado_em_local',
       'coletado_em_utc', 'fonte', 'validade', 'motivo_validade'],
      rows.map((r) => [r.name, `@${r.username}`, r.followers_count, r.follows_count, r.media_count, r.observed_at,
        fmt(r.observed_at), r.collected_at, r.source, r.validity, r.validity_reason]),
    );
    return send(reply, 'fza-historico-seguidores.csv', csv);
  });

  app.get('/api/export/media.csv', async (req, reply) => {
    const q = z.object({ clientId: z.string().uuid().optional() }).parse(req.query);
    const settings = await loadSettings(db);
    const fmt = localFmt(settings.displayTimezone);
    const { rows } = await db.query(
      `SELECT c.name, p.username::text AS username, m.external_id, m.media_type, m.source_media_type, m.published_at,
              m.first_seen_at, m.permalink, m.like_count, m.comments_count, m.source
         FROM media_items m JOIN instagram_profiles p ON p.id = m.profile_id JOIN clients c ON c.id = p.client_id
        WHERE ($1::uuid IS NULL OR c.id = $1) ORDER BY c.name, m.published_at DESC NULLS LAST`,
      [q.clientId ?? null],
    );
    const csv = toCsv(
      ['cliente', 'instagram', 'id_fonte', 'tipo', 'tipo_na_fonte', 'publicado_em_utc', 'publicado_em_local',
       'descoberto_pelo_sistema_utc', 'link', 'curtidas', 'comentarios', 'fonte'],
      rows.map((r) => [r.name, `@${r.username}`, r.external_id, r.media_type, r.source_media_type, r.published_at,
        fmt(r.published_at), r.first_seen_at, r.permalink, r.like_count, r.comments_count, r.source]),
    );
    return send(reply, 'fza-publicacoes.csv', csv);
  });
}
