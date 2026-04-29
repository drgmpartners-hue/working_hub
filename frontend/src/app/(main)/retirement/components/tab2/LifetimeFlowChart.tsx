'use client';

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts';

/* ------------------------------------------------------------------ */
/*  타입                                                                */
/* ------------------------------------------------------------------ */

interface ChartDataPoint {
  age: number;
  '누적 입금액': number;
  총평가액: number;
  보정후순자산: number;
  phase: string;
  isAdjusted: boolean;
}

interface LifetimeFlowChartProps {
  data: ChartDataPoint[];
  retirementAge: number;
  noAnimation?: boolean;
}

/* ------------------------------------------------------------------ */
/*  포맷 유틸                                                           */
/* ------------------------------------------------------------------ */

function formatAmount(value: number): string {
  if (value >= 100000) return `${(value / 100000).toFixed(1)}억`;    // 10만 만원 = 10억
  if (value >= 10000) return `${(value / 10000).toFixed(0)}천만`;    // 1만 만원 = 1억 (과도)
  if (value >= 1000) return `${(value / 1000).toFixed(0)}천`;
  return `${value.toLocaleString()}`;
}

function tooltipFormatter(value: unknown, name: unknown): [string, string] {
  const v = Number(value);
  const n = String(name);
  const formatted =
    v >= 100000
      ? `${(v / 100000).toFixed(1)}억원`
      : `${Math.round(v).toLocaleString('ko-KR')}만원`;
  return [formatted, n];
}

const tooltipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB' };

/* ------------------------------------------------------------------ */
/*  커스텀 툴팁                                                          */
/* ------------------------------------------------------------------ */

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        backgroundColor: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 12,
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      }}
    >
      <div style={{ fontWeight: 700, color: '#1E3A5F', marginBottom: 6 }}>{label}세</div>
      {payload.map((p) => {
        const v = p.value;
        const formatted =
          v >= 100000
            ? `${(v / 100000).toFixed(2)}억원`
            : `${Math.round(v).toLocaleString('ko-KR')}만원`;
        return (
          <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.color, marginBottom: 2 }}>
            <span>{p.name}</span>
            <span style={{ fontWeight: 600 }}>{formatted}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  메인 차트 컴포넌트                                                   */
/* ------------------------------------------------------------------ */

export function LifetimeFlowChart({ data, retirementAge, noAnimation }: LifetimeFlowChartProps) {
  return (
    <ResponsiveContainer width="100%" height={400}>
      <ComposedChart data={data} margin={{ top: 16, right: 24, left: 16, bottom: 8 }}>
        <defs>
          <linearGradient id="principalGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#1E3A5F" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#1E3A5F" stopOpacity={0.04} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />

        <XAxis
          dataKey="age"
          fontSize={11}
          tickLine={false}
          axisLine={{ stroke: '#E5E7EB' }}
          tickFormatter={(v: number) => `${v}세`}
          interval={4}
        />
        <YAxis
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatAmount}
          width={64}
        />

        <Tooltip content={<CustomTooltip />} />
        <Legend
          iconType="square"
          iconSize={10}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(value: string) => <span style={{ color: '#374151', fontSize: 11 }}>{value}</span>}
        />

        {/* 은퇴나이 기준선 */}
        <ReferenceLine
          x={retirementAge}
          stroke="#DC2626"
          strokeDasharray="6 3"
          strokeWidth={1.5}
          label={{
            value: `은퇴 ${retirementAge}세`,
            position: 'insideTopRight',
            fontSize: 11,
            fill: '#DC2626',
            fontWeight: 600,
          }}
        />

        {/* 누적 입금액 Area (Navy) */}
        <Area
          type="monotone"
          dataKey="누적 입금액"
          stroke="#1E3A5F"
          strokeWidth={1.5}
          fill="url(#principalGrad)"
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={!noAnimation}
        />

        {/* 총 평가액 Line (연한 파란) */}
        <Line
          type="monotone"
          dataKey="총평가액"
          stroke="#93C5FD"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          strokeDasharray="4 2"
          isAnimationActive={!noAnimation}
        />

        {/* 보정후순자산 Line (Teal 실선) */}
        <Line
          type="monotone"
          dataKey="보정후순자산"
          stroke="#0D9488"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5, fill: '#0D9488' }}
          isAnimationActive={!noAnimation}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export default LifetimeFlowChart;
