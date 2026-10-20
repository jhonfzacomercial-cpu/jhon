import type { DbClient } from '../db/pool.js';

export async function audit(
  db: DbClient,
  userId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId, action, entity, entityId, JSON.stringify(details)],
  );
}
