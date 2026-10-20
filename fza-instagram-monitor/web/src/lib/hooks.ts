import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

export interface Query<T> {
  data: T | undefined;
  error: ApiError | Error | undefined;
  loading: boolean;
  reload: () => void;
}

// Busca simples com recarga; mantém os dados anteriores enquanto recarrega.
export function useApi<T>(path: string | null, refreshMs?: number): Query<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | Error>();
  const [loading, setLoading] = useState(Boolean(path));
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(undefined);
      })
      .catch((e) => id === seq.current && setError(e))
      .finally(() => id === seq.current && setLoading(false));
  }, [path, tick]);

  useEffect(() => {
    if (!refreshMs) return;
    const t = setInterval(() => setTick((x) => x + 1), refreshMs);
    return () => clearInterval(t);
  }, [refreshMs]);

  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, error, loading, reload };
}
