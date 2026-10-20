import { useState } from 'react';
import { useApi } from '../lib/hooks';
import { addDaysKey, todayKey } from '../lib/format';
import type { Paged, ProfileSummary } from '../lib/types';

export interface RangeFilter {
  from: string;
  to: string;
  clientIds: string[];
}

const PRESETS = [
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
  { label: '12 meses', days: 365 },
];

export function useRangeFilter(days = 30): [RangeFilter, (f: RangeFilter) => void] {
  const to = todayKey();
  return useState<RangeFilter>({ from: addDaysKey(to, -(days - 1)), to, clientIds: [] });
}

// Filtros em uma linha acima dos gráficos: período (atalhos + datas) e clientes.
export function FilterBar({ value, onChange, showClients = true }: { value: RangeFilter; onChange: (f: RangeFilter) => void; showClients?: boolean }) {
  const clients = useApi<Paged<ProfileSummary>>(showClients ? '/api/clients?pageSize=200&status=all' : null);
  const today = todayKey();
  const activeDays = Math.round((Date.parse(value.to) - Date.parse(value.from)) / 86_400_000) + 1;
  return (
    <div className="filter-bar">
      <div className="seg" role="group" aria-label="Período">
        {PRESETS.map((p) => (
          <button
            key={p.days}
            className={value.to === today && activeDays === p.days ? 'on' : ''}
            onClick={() => onChange({ ...value, from: addDaysKey(today, -(p.days - 1)), to: today })}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="inline">
        De
        <input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
      </label>
      <label className="inline">
        até
        <input type="date" value={value.to} min={value.from} max={today} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
      </label>
      {showClients && (
        <label className="inline">
          Clientes
          <select
            value={value.clientIds.length === 1 ? value.clientIds[0] : ''}
            onChange={(e) => onChange({ ...value, clientIds: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">Todos</option>
            {clients.data?.items
              .filter((c) => c.clientStatus !== 'archived')
              .map((c) => (
                <option key={c.clientId} value={c.clientId}>
                  {c.clientName} (@{c.username})
                </option>
              ))}
          </select>
        </label>
      )}
    </div>
  );
}
