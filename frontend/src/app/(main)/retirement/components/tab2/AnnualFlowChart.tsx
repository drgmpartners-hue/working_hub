'use client';

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface AnnualFlowRow {
  year: number;
  total_contribution: number;
  annual_evaluation: number;
  annual_return: number;
  annual_return_rate: number | null;
  deposit_in: number;
  cumulative_deposit_in: number;
  cumulative_withdrawal: number;
  total_evaluation: number; // 순자산
}

/* ---- 공통 유틸 ---- */

const formatAmount = (value: number) => {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(1)}억`;
  if (abs >= 10000000) return `${sign}${(abs / 10000000).toFixed(0)}천만`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(0)}만`;
  return `${sign}${abs.toLocaleString()}`;
};

/* ------------------------------------------------------------------ */
/*  자산 성장 그래프 (고객 설명용 단일 그래프)                            */
/*  깔끔함 우선 설계:                                                   */
/*  - 면적 2겹만: 원금(옅은 파랑, 위 경계선 = 넣으신 돈) + 수익(초록)     */
/*  - 순자산은 굵은 선 하나, 점은 마지막 연도에만                         */
/*  - 툴팁은 순입금액·순자산·수익 3줄로 요약                             */
/* ------------------------------------------------------------------ */

export interface AssetGrowthOptions {
  showRate: boolean;   // 순자산수익률(%) 선 표시 (기본 꺼짐 — 이중축 최소화)
}

interface AssetGrowthChartProps {
  data: AnnualFlowRow[];
  options: AssetGrowthOptions;
  noAnimation?: boolean;
}

interface GrowthPoint {
  year: string;
  순입금액: number;
  순자산: number;
  원금부: number;
  수익: number;
  손실: number;
  순자산수익률: number;
}

/* 요약형 커스텀 툴팁 — 내부 시리즈(원금부 등) 대신 고객 언어 3줄만 */
function GrowthTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { payload?: GrowthPoint }[];
  label?: string;
}) {
  if (!active || !payload?.length || !payload[0]?.payload) return null;
  const p = payload[0].payload;
  const profit = p.순자산 - p.순입금액;
  const profitColor = profit > 0 ? '#34D399' : profit < 0 ? '#F87171' : '#C9D6E3';
  const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: 18, fontSize: 12 } as const;
  return (
    <div style={{ backgroundColor: '#16203A', border: '1px solid #2F3D5C', borderRadius: 8, padding: '8px 12px', color: '#C9D6E3' }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5 }}>{label}년</div>
      <div style={rowStyle}><span style={{ color: '#7A8FA6' }}>순입금액</span><span>{p.순입금액.toLocaleString()}원</span></div>
      <div style={rowStyle}><span style={{ color: '#7A8FA6' }}>순자산</span><span style={{ color: '#7CC0FF', fontWeight: 700 }}>{p.순자산.toLocaleString()}원</span></div>
      <div style={rowStyle}><span style={{ color: '#7A8FA6' }}>수익</span><span style={{ color: profitColor, fontWeight: 700 }}>{profit >= 0 ? '+' : ''}{profit.toLocaleString()}원</span></div>
    </div>
  );
}

export function AssetGrowthChart({ data, options, noAnimation }: AssetGrowthChartProps) {
  const chartData: GrowthPoint[] = data.map((row) => {
    const netDeposit = row.cumulative_deposit_in - row.cumulative_withdrawal;   // 순입금액
    const netAsset = row.total_evaluation;                                      // 순자산
    return {
      year: `${row.year}`,
      순입금액: netDeposit,
      순자산: netAsset,
      원금부: Math.min(netDeposit, netAsset),
      수익: Math.max(0, netAsset - netDeposit),
      손실: Math.max(0, netDeposit - netAsset),
      순자산수익률: netDeposit > 0 ? ((netAsset - netDeposit) / netDeposit) * 100 : 0,
    };
  });

  const lastIdx = chartData.length - 1;

  // 마지막 연도에만 점 + 값 라벨 — 인쇄물에서도 결론 숫자가 보이도록
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastDot = (props: any) => {
    const { cx, cy, index } = props as { cx?: number; cy?: number; index?: number };
    if (index !== lastIdx || cx == null || cy == null) return <g key={`d${index}`} />;
    const v = chartData[lastIdx]?.순자산 ?? 0;
    return (
      <g key={`d${index}`}>
        <circle cx={cx} cy={cy} r={4.5} fill="#3B82F6" stroke="#0B1220" strokeWidth={1.5} />
        <text x={cx - 8} y={cy - 12} textAnchor="end" fill="#7CC0FF" fontSize={13} fontWeight={800}>
          {formatAmount(v)}
        </text>
      </g>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={chartData} margin={{ top: 26, right: options.showRate ? 40 : 16, left: 6, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(36,48,73,0.6)" />
        <XAxis dataKey="year" fontSize={12} tickLine={false} axisLine={{ stroke: '#2F3D5C' }} tick={{ fill: '#7A8FA6' }} />
        <YAxis yAxisId="left" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatAmount} width={58} tick={{ fill: '#7A8FA6' }} />
        {options.showRate && (
          <YAxis yAxisId="right" orientation="right" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={48} tick={{ fill: '#7A8FA6' }} />
        )}
        <Tooltip content={<GrowthTooltip />} />

        {/* 갭 밴드: 두 선 사이만 색칠 — 바닥(원금부)은 투명 베이스로만 사용.
            선(monotone 곡선)과 같은 보간을 써야 띠가 선에 정확히 붙는다 */}
        <Area yAxisId="left" type="monotone" dataKey="원금부" stackId="asset" stroke="none" fill="transparent" isAnimationActive={!noAnimation} />
        <Area yAxisId="left" type="monotone" dataKey="수익" stackId="asset" stroke="none" fill="#10B981" fillOpacity={0.28} isAnimationActive={!noAnimation} />
        <Area yAxisId="left" type="monotone" dataKey="손실" stackId="asset" stroke="none" fill="#EF4444" fillOpacity={0.22} isAnimationActive={!noAnimation} />

        {/* 넣으신 돈 기준선 — 독립 점선 (손실 연도에도 항상 정확한 위치) */}
        <Line yAxisId="left" type="monotone" dataKey="순입금액" stroke="#8B9DB5" strokeWidth={1.5} strokeDasharray="6 4" dot={false} isAnimationActive={!noAnimation} />

        {/* 순자산 성장 곡선 — 점은 마지막 연도에만 */}
        <Line yAxisId="left" type="monotone" dataKey="순자산" stroke="#3B82F6" strokeWidth={2.5} dot={lastDot} activeDot={{ r: 5 }} isAnimationActive={!noAnimation} />

        {options.showRate && (
          <Line yAxisId="right" type="monotone" dataKey="순자산수익률" stroke="#F59E0B" strokeWidth={1.8} strokeDasharray="4 3" dot={false} isAnimationActive={!noAnimation} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
