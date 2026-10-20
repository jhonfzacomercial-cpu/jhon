import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtCompact, fmtDayKey, fmtDayKeyFull, fmtInt, fmtSigned } from '../lib/format';

// Cores por função (ver docs/DESIGN.md):
// - série única de magnitude: grafite;
// - polaridade (variação +/−): azul ↔ vermelho (par divergente validado para daltonismo);
// - amarelo FZA é cor de destaque da interface, não de dado.
export const C = {
  series: '#2b2f36',
  pos: '#2a78d6',
  neg: '#e34948',
  grid: '#e7e6e2',
  axis: '#6b6a65',
  goal: '#b7791f',
};

const axisProps = { stroke: C.axis, tick: { fill: C.axis, fontSize: 12 }, tickLine: false, axisLine: { stroke: C.grid } };

function TipBox({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="chart-tip">
      <strong>{title}</strong>
      {rows.map(([k, v]) => (
        <div key={k}>
          <span className="muted">{k}:</span> {v}
        </div>
      ))}
    </div>
  );
}

// Linha de seguidores. Dias sem coleta ficam como lacuna (null + connectNulls=false).
export function FollowersLine({ data, height = 260 }: { data: { day: string; followers: number | null; note?: string }[]; height?: number }) {
  const gaps = data.filter((d) => d.followers == null).length;
  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="day" tickFormatter={fmtDayKey} {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} width={56} tickFormatter={(v) => fmtCompact(v)} domain={['auto', 'auto']} allowDecimals={false} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { day: string; followers: number | null; note?: string };
              return (
                <TipBox
                  title={fmtDayKeyFull(p.day)}
                  rows={[['Seguidores (fechamento)', p.followers == null ? 'sem coleta neste dia' : fmtInt(p.followers)], ...(p.note ? [['Obs.', p.note] as [string, string]] : [])]}
                />
              );
            }}
          />
          <Line type="linear" dataKey="followers" stroke={C.series} strokeWidth={2} dot={data.length <= 31 ? { r: 3, fill: C.series, stroke: '#fff', strokeWidth: 2 } : false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      {gaps > 0 && <p className="chart-note">Lacunas na linha = dias sem coleta válida ({gaps} no período). Nenhum valor é interpolado.</p>}
    </>
  );
}

// Barras de variação líquida (positivas azuis, negativas vermelhas; null = sem dado).
export function ChangeBars<T extends { change: number | null }>({
  data,
  xKey,
  xFormat = (v: string) => v,
  height = 240,
  tipExtra,
}: {
  data: T[];
  xKey: string;
  xFormat?: (v: string) => string;
  height?: number;
  tipExtra?: (row: T) => [string, string][];
}) {
  const missing = data.filter((d) => d.change == null).length;
  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={xFormat} {...axisProps} minTickGap={16} />
          <YAxis {...axisProps} width={56} tickFormatter={(v) => fmtCompact(v)} allowDecimals={false} />
          <ReferenceLine y={0} stroke={C.axis} />
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as T;
              return (
                <TipBox
                  title={xFormat(String((r as Record<string, unknown>)[xKey]))}
                  rows={[['Variação líquida', r.change == null ? 'sem dados comparáveis' : fmtSigned(r.change)], ...(tipExtra?.(r) ?? [])]}
                />
              );
            }}
          />
          <Bar dataKey="change" maxBarSize={24} radius={[4, 4, 4, 4]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={(d.change ?? 0) >= 0 ? C.pos : C.neg} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="chart-note">
        <span className="key" style={{ background: C.pos }} /> positiva <span className="key" style={{ background: C.neg }} /> negativa
        {missing > 0 && ` · ${missing} período(s) sem dados comparáveis (sem barra)`}. Variação líquida: não separa ganhos de perdas.
      </p>
    </>
  );
}

// Barras horizontais por cliente (uma medida), com meta opcional por linha no tooltip.
export function ClientBars({
  data,
  valueKey,
  format,
  diverging = false,
  emptyLabel,
}: {
  data: { label: string; value: number | null; extra?: [string, string][] }[];
  valueKey?: string;
  format: (n: number) => string;
  diverging?: boolean;
  emptyLabel: string;
}) {
  const rows = data.filter((d) => d.value != null);
  const missing = data.length - rows.length;
  if (rows.length === 0) return <p className="muted">{emptyLabel}</p>;
  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 34 + 30)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }} barCategoryGap={6}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtCompact(v)} />
          <YAxis type="category" dataKey="label" {...axisProps} width={130} tick={{ fill: '#2b2f36', fontSize: 12 }} />
          {diverging && <ReferenceLine x={0} stroke={C.axis} />}
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as { label: string; value: number; extra?: [string, string][] };
              return <TipBox title={r.label} rows={[[valueKey ?? 'Valor', format(r.value)], ...(r.extra ?? [])]} />;
            }}
          />
          <Bar dataKey="value" maxBarSize={22} radius={[4, 4, 4, 4]} isAnimationActive={false}>
            {rows.map((d, i) => (
              <Cell key={i} fill={diverging ? (d.value! >= 0 ? C.pos : C.neg) : C.series} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {missing > 0 && <p className="chart-note">{missing} cliente(s) sem dados suficientes não aparecem no gráfico.</p>}
    </>
  );
}

export function CountBars({ data, xKey, xFormat = (v: string) => v, label }: { data: Record<string, unknown>[]; xKey: string; xFormat?: (v: string) => string; label: string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap={2}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey={xKey} tickFormatter={xFormat} {...axisProps} minTickGap={12} />
        <YAxis {...axisProps} width={40} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: 'rgba(0,0,0,0.04)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as Record<string, unknown>;
            return <TipBox title={xFormat(String(r[xKey]))} rows={[[label, fmtInt(payload[0].value as number)]]} />;
          }}
        />
        <Bar dataKey="posts" fill={C.series} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
