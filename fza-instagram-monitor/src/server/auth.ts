import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DbClient } from '../db/pool.js';

export type Role = 'admin' | 'analyst' | 'viewer';
export const SESSION_COOKIE = 'fza_session';
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 12) return 'A senha deve ter pelo menos 12 caracteres.';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'A senha deve conter letras e números.';
  return null;
}

// Hash fixo para comparar quando o e-mail não existe (mesmo custo de tempo: evita enumeração de usuários).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

export type LoginResult =
  | { ok: true; user: SessionUser; token: string }
  | { ok: false; reason: 'invalid' | 'locked' | 'disabled' };

export async function login(
  db: DbClient,
  email: string,
  password: string,
  meta: { ip?: string; userAgent?: string; ttlHours: number },
): Promise<LoginResult> {
  const { rows } = await db.query(
    `SELECT id, email::text, name, role, status, password_hash, failed_login_count, locked_until FROM users WHERE email = $1`,
    [email],
  );
  const u = rows[0];
  if (!u) {
    await bcrypt.compare(password, DUMMY_HASH);
    return { ok: false, reason: 'invalid' };
  }
  if (u.locked_until && u.locked_until > new Date()) return { ok: false, reason: 'locked' };
  const valid = await bcrypt.compare(password, u.password_hash);
  if (!valid) {
    // Após MAX_FAILED_LOGINS erros seguidos, bloqueia a conta por LOCK_MINUTES e zera o contador.
    const lock = u.failed_login_count + 1 >= MAX_FAILED_LOGINS;
    await db.query(
      `UPDATE users SET
         failed_login_count = CASE WHEN $2 THEN 0 ELSE failed_login_count + 1 END,
         locked_until = CASE WHEN $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
       WHERE id = $1`,
      [u.id, lock, LOCK_MINUTES],
    );
    return { ok: false, reason: lock ? 'locked' : 'invalid' };
  }
  if (u.status !== 'active') return { ok: false, reason: 'disabled' };

  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES ($1, $2, now() + make_interval(hours => $3), $4, $5)`,
    [hashToken(token), u.id, meta.ttlHours, meta.ip ?? null, (meta.userAgent ?? '').slice(0, 300)],
  );
  await db.query(`UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [u.id]);
  return { ok: true, token, user: { id: u.id, email: u.email, name: u.name, role: u.role } };
}

export async function userFromToken(db: DbClient, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const { rows } = await db.query(
    `UPDATE sessions s SET last_seen_at = now()
       FROM users u
      WHERE s.id = $1 AND s.expires_at > now() AND u.id = s.user_id AND u.status = 'active'
      RETURNING u.id, u.email::text AS email, u.name, u.role`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function logout(db: DbClient, token: string | undefined): Promise<void> {
  if (token) await db.query('DELETE FROM sessions WHERE id = $1', [hashToken(token)]);
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, analyst: 1, admin: 2 };

export function hasRole(user: SessionUser | undefined, min: Role): boolean {
  return !!user && ROLE_RANK[user.role] >= ROLE_RANK[min];
}

export function requireRole(min: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthenticated', message: 'Faça login para continuar.' });
    if (!hasRole(req.user, min)) return reply.code(403).send({ error: 'forbidden', message: 'Seu perfil de acesso não permite esta ação.' });
  };
}
