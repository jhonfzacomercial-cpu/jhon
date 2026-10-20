import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadSettings } from '../../core/settings.js';
import { dailySeries, usable, type DailyPoint } from '../../core/growth.js';
import { profilePosting } from '../../core/analytics.js';
import { DAY, addDays, dayKey, dayKeysRange, monthKey, weekKey } from '../../core/time.js';
import { activeProvider } from '../../providers/registry.js';
import { aggregateChange, loadSnapshotsByProfile, loadSummaries } from '../services.js';

const query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  clientIds: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.string().uuid()).max(500).optional()),
});

export async function registerOverviewRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get('/api/overview', async (req, reply) => {
    const q = query.parse(req.query);
    const settings = await loadSettings(db);
    const tz = settings.displayTimezone;
    const now = app.clock();
    const to = q.to ?? dayKey(now, tz);
    const from = q.from ?? addDays(to, -29);
    if (from > to || Date.parse(to) - Date.parse(from) > 731 * DAY) {
      return reply.code(400).send({ error: 'validation', message: 'Intervalo inválido (máximo de 2 anos).' });
    }

    const summaries = await loadSummaries(db, settings, now, { clientIds: q.clientIds });
    const active = summaries.filter((s) => s.clientStatus === 'active');
    const valid = summaries.filter((s) => s.currentFollowers != null && s.profileState === 'ok');

    const changes = {
      h24: aggregateChange(summaries.map((s) => s.change24h)),
      d7: aggregateChange(summaries.map((s) => s.change7d)),
      d30: aggregateChange(summaries.map((s) => s.change30d)),
    };
    const comparable7 = summaries.filter((s) => s.change7d.absolute != null);
    const noPosts = (
      await db.query<{ n: number }>(
        `SELECT count(DISTINCT a.profile_id)::int AS n FROM alerts a
           JOIN instagram_profiles p ON p.id = a.profile_id
          WHERE a.type = 'no_posts' AND a.status IN ('open', 'acknowledged') AND p.id = ANY($1::uuid[])`,
        [summaries.map((s) => s.profileId)],
      )
    ).rows[0].n;
    const lastSuccess = summaries.reduce<string | null>((acc, s) => (s.lastSuccessAt && (!acc || s.lastSuccessAt > acc) ? s.lastSuccessAt : acc), null);

    // ----- Séries diárias por perfil
    const profileIds = summaries.map((s) => s.profileId);
    const snaps = await loadSnapshotsByProfile(db, profileIds, new Date(Date.parse(from) - 2 * DAY), new Date(Date.parse(to) + 2 * DAY));
    const spans = new Map(
      (
        await db.query<{ profile_id: string; first: Date; last: Date }>(
          `SELECT profile_id, min(observed_at) AS first, max(observed_at) AS last FROM follower_snapshots
            WHERE profile_id = ANY($1::uuid[]) AND validity = 'valid' AND followers_count IS NOT NULL GROUP BY profile_id`,
          [profileIds],
        )
      ).rows.map((r) => [r.profile_id, { first: dayKey(r.first, tz), last: dayKey(r.last, tz) }]),
    );
    const perProfile = new Map<string, DailyPoint[]>();
    for (const s of summaries) perProfile.set(s.profileId, dailySeries(snaps.get(s.profileId) ?? [], from, to, tz));

    const days = dayKeysRange(from, to);
    const portfolio = days.map((day, i) => {
      let sum = 0;
      let present = 0;
      let expected = 0;
      let changeSum = 0;
      let changeCount = 0;
      for (const s of summaries) {
        const span = spans.get(s.profileId);
        const pt = perProfile.get(s.profileId)![i];
        // Um perfil é "esperado" no dia se o dia está dentro do período em que ele tem coletas.
        if (span && span.first <= day && day <= span.last) expected++;
        if (pt.followers != null) {
          sum += pt.followers;
          present++;
        }
        if (pt.change != null) {
          changeSum += pt.change;
          changeCount++;
        }
      }
      const complete = expected > 0 && present >= expected;
      return {
        day,
        // Sem todos os perfis esperados no dia, o total não é exibido (lacuna), para não sugerir queda/alta falsa.
        followers: complete ? sum : null,
        profiles: present,
        expectedProfiles: expected,
        change: changeCount > 0 ? changeSum : null,
        changeProfiles: changeCount,
        changeComplete: expected > 0 && changeCount >= expected,
      };
    });

    const group = (keyFn: (d: string) => string) => {
      const m = new Map<string, { period: string; change: number; daysWithData: number; days: number; complete: boolean }>();
      for (const p of portfolio) {
        const k = keyFn(p.day);
        const g = m.get(k) ?? { period: k, change: 0, daysWithData: 0, days: 0, complete: true };
        g.days++;
        if (p.change != null) {
          g.change += p.change;
          g.daysWithData++;
        }
        if (!p.changeComplete) g.complete = false;
        m.set(k, g);
      }
      return [...m.values()].map((g) => ({ ...g, change: g.daysWithData ? g.change : null }));
    };

    // ----- Crescimento por cliente no intervalo (primeiro x último fechamento disponível)
    const growthByClient = summaries.map((s) => {
      const pts = perProfile.get(s.profileId)!.filter((p) => p.followers != null);
      const a = pts[0];
      const b = pts[pts.length - 1];
      const ok = a && b && a.day !== b.day;
      return {
        clientId: s.clientId,
        clientName: s.clientName,
        username: s.username,
        isDemo: s.isDemo,
        fromDay: ok ? a.day : null,
        toDay: ok ? b.day : null,
        change: ok ? b.followers! - a.followers! : null,
        percent: ok && a.followers! > 0 ? ((b.followers! - a.followers!) / a.followers!) * 100 : null,
      };
    });

    // ----- Publicações
    const postingByClient = [];
    for (const s of summaries) {
      const pr = (await db.query(`SELECT * FROM instagram_profiles WHERE id = $1`, [s.profileId])).rows[0];
      const { stats } = await profilePosting(db, pr, now);
      postingByClient.push({
        clientId: s.clientId,
        clientName: s.clientName,
        username: s.username,
        isDemo: s.isDemo,
        available: stats.available,
        postsPerWeek: stats.postsPerWeek,
        basisDays: stats.postsPerWeekBasisDays,
        goal: s.postingGoalPerWeek ?? settings.defaultPostingGoalPerWeek,
        daysSinceLatest: stats.daysSinceLatest,
        last30: stats.windows.find((w) => w.days === 30) ?? null,
      });
    }
    const postsPerWeek = (
      await db.query<{ week: string; n: number }>(
        `SELECT to_char(date_trunc('week', m.published_at AT TIME ZONE $4), 'IYYY-"W"IW') AS week, count(*)::int AS n
           FROM media_items m
          WHERE m.profile_id = ANY($1::uuid[]) AND m.published_at IS NOT NULL
            AND (m.published_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
          GROUP BY 1 ORDER BY 1`,
        [profileIds, from, to, tz],
      )
    ).rows;
    const weekMap = new Map(postsPerWeek.map((r) => [r.week, r.n]));
    const weeks = [...new Set(days.map(weekKey))];

    const provider = activeProvider(settings);
    const anyDemo = summaries.some((s) => s.isDemo);

    return {
      range: { from, to, timezone: tz },
      kpis: {
        clients: summaries.length,
        clientsActive: active.length,
        profilesMonitored: active.length,
        portfolioFollowers: valid.length ? valid.reduce((a, s) => a + s.currentFollowers!, 0) : null,
        portfolioFollowersProfiles: valid.length,
        changes,
        growing: comparable7.filter((s) => s.change7d.absolute! > 0).length,
        declining: comparable7.filter((s) => s.change7d.absolute! < 0).length,
        stableOrZero: comparable7.filter((s) => s.change7d.absolute === 0).length,
        comparable7d: comparable7.length,
        noPostsBeyondLimit: noPosts,
        delayedOrError: active.filter((s) => s.stale || s.profileState !== 'ok' || s.consecutiveFailures > 0).length,
        lastSuccessAt: lastSuccess,
      },
      collection: {
        provider: provider ? { id: provider.id, displayName: provider.displayName, isDemo: provider.isDemo, configured: provider.configStatus().configured } : null,
        followersIntervalMinutes: settings.followersIntervalMinutes,
        mediaIntervalMinutes: settings.mediaIntervalMinutes,
      },
      containsDemoData: anyDemo,
      charts: {
        portfolio,
        weekly: group(weekKey),
        monthly: group(monthKey),
        growthByClient,
        postingByClient,
        postsPerWeek: weeks.map((w) => ({ week: w, posts: weekMap.get(w) ?? 0 })),
      },
      profiles: summaries.map((s) => ({
        clientId: s.clientId,
        clientName: s.clientName,
        username: s.username,
        validSnapshots: usable(snaps.get(s.profileId) ?? []).length,
      })),
    };
  });
}
