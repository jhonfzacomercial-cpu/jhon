import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';
import type { Role, User } from './types';

interface AuthCtx {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (min: Role) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);
const RANK: Record<Role, number> = { viewer: 0, analyst: 1, admin: 2 };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api<{ user?: User }>('/api/auth/me')
      .then((r) => setUser(r.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const value: AuthCtx = {
    user,
    ready,
    login: async (email, password) => {
      const r = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: { email, password } });
      setUser(r.user);
    },
    logout: async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      setUser(null);
    },
    can: (min) => !!user && RANK[user.role] >= RANK[min],
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider ausente');
  return c;
}
