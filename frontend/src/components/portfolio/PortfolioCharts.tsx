'use client';

import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface HistoryPoint {
  date: string;
  return_rate?: number;
  net_asset?: number; // 순자산 = 평가금액 + 예수금
}

export interface DistributionItem {
  name: string;
  value: number; // 평가금액
}

export type PeriodKey = '3m' | '6m' | '1y' | 'max';

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

interface PortfolioChartsProps {
  accountId: string;
  snapshotId: string | null;
  regionDistribution: DistributionItem[];
  riskDistribution: DistributionItem[];
  onPeriodChange?: (period: PeriodKey) => void;
  historyData: HistoryPoint[];
  historyLoading: boolean;
  activePeriod: PeriodKey;
  onActivePeriodChange: (period: PeriodKey) => void;
  /* 순자산 추이 (선택) — 제공 시 수익률 추이 아래에 그래프 표시 */
  netAssetData?: HistoryPoint[];
  netAssetLoading?: boolean;
  netAssetPeriod?: PeriodKey;
  onNetAssetPeriodChange?: (period: PeriodKey) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */
/* 데이터 시리즈 색 — 라이트/다크 양쪽에서 가독 가능한 값으로 통일 */
const REGION_COLORS: Record<string, string> = {
  국내: '#60A5FA',
  미국: '#3B82F6',
  글로벌: '#10B981',
  베트남: '#F59E0B',
  인도: '#EF4444',
  중국: '#8B5CF6',
  기타: '#94A3B8',
};

const RISK_COLORS: Record<string, string> = {
  절대안정형: '#3B82F6',
  안정형: '#10B981',
  성장형: '#F59E0B',
  절대성장형: '#EF4444',
};

const FALLBACK_COLORS = ['#60A5FA', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#94A3B8'];

/* 차트 SVG(축/그리드/라인) — 속성값이라 var() 대신 양쪽 호환 고정색 사용 */
const GRID = 'rgba(148,163,184,0.18)';
const AXIS_LINE = 'rgba(148,163,184,0.28)';
const TICK = '#94A3B8';
const RETURN_LINE = '#3B82F6';
const RETURN_DOT = '#60A5FA';
const NET_LINE = '#14B8A6';
const NET_DOT = '#5EEAD4';

const PERIOD_LABELS: Record<PeriodKey, string> = {
  '3m': '3개월',
  '6m': '6개월',
  '1y': '1년',
  max: 'MAX',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const fmt = (n: number) => n.toLocaleString('ko-KR');

function formatDateLabel(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[1]}/${parts[2]}`;
  return dateStr;
}

const tipBox: React.CSSProperties = {
  backgroundColor: 'var(--pf-card)',
  border: '1px solid var(--pf-border)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: '0.8125rem',
  boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
};

/* ------------------------------------------------------------------ */
/*  Custom Tooltips                                                     */
/* ------------------------------------------------------------------ */

function CustomLineTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value?: number; payload?: { date?: string } }> }) {
  if (!active || !payload || !payload.length) return null;
  const val = payload[0]?.value;
  if (val == null) return null;
  const fullDate = payload[0]?.payload?.date ?? '';
  const color = val > 0 ? '#10B981' : val < 0 ? '#EF4444' : 'var(--pf-text2)';
  return (
    <div style={tipBox}>
      <div style={{ color: 'var(--pf-text2)', marginBottom: 4 }}>{fullDate}</div>
      <div style={{ fontWeight: 700, color }}>{val > 0 ? '+' : ''}{val.toFixed(2)}%</div>
    </div>
  );
}

function CustomNetAssetTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value?: number; payload?: { date?: string } }> }) {
  if (!active || !payload || !payload.length) return null;
  const val = payload[0]?.value;
  if (val == null) return null;
  const fullDate = payload[0]?.payload?.date ?? '';
  return (
    <div style={tipBox}>
      <div style={{ color: 'var(--pf-text2)', marginBottom: 4 }}>{fullDate}</div>
      <div style={{ fontWeight: 700, color: NET_LINE }}>{val.toLocaleString('ko-KR')}원</div>
    </div>
  );
}

function CustomPieTooltip({ active, payload }: { active?: boolean; payload?: { name?: string; value?: number }[] }) {
  if (!active || !payload || !payload.length) return null;
  const item = payload[0];
  return (
    <div style={tipBox}>
      <div style={{ fontWeight: 600, color: 'var(--pf-text)' }}>{item.name}</div>
      <div style={{ color: 'var(--pf-text2)' }}>{fmt(item.value ?? 0)}원</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section title                                                       */
/* ------------------------------------------------------------------ */

function SectionTitle({ children, barColor = 'var(--pf-accent)' }: { children: React.ReactNode; barColor?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      <div style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: barColor, flexShrink: 0 }} />
      <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--pf-text)' }}>{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Donut chart component                                               */
/* ------------------------------------------------------------------ */

function DonutChart({ data, colorMap, title }: { data: DistributionItem[]; colorMap: Record<string, string>; title: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);

  if (data.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 220, color: 'var(--pf-muted)', fontSize: '0.875rem' }}>
        데이터 없음
      </div>
    );
  }

  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <ResponsiveContainer width={200} height={200}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
              {data.map((entry, idx) => (
                <Cell key={entry.name} fill={colorMap[entry.name] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]} stroke="none" />
              ))}
            </Pie>
            <Tooltip content={<CustomPieTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 120 }}>
          {data.map((entry, idx) => {
            const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0.0';
            const color = colorMap[entry.name] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
            return (
              <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color, flexShrink: 0 }} />
                <span style={{ fontSize: '0.8125rem', color: 'var(--pf-text2)', flex: 1 }}>{entry.name}</span>
                <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--pf-text)' }}>{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reusable line-chart card                                            */
/* ------------------------------------------------------------------ */

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--pf-border)',
  borderRadius: 12,
  padding: 20,
  backgroundColor: 'var(--pf-card)',
};
const emptyStyle: React.CSSProperties = {
  height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--pf-muted)', fontSize: '0.875rem',
};

function periodBtnStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    padding: '6px 14px',
    fontSize: '0.8125rem',
    fontWeight: active ? 700 : 500,
    color: active ? 'var(--pf-accent-text)' : 'var(--pf-muted)',
    backgroundColor: active ? accent : 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  };
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function PortfolioCharts({
  regionDistribution,
  riskDistribution,
  historyData,
  historyLoading,
  activePeriod,
  onActivePeriodChange,
  netAssetData,
  netAssetLoading = false,
  netAssetPeriod = '6m',
  onNetAssetPeriodChange,
}: PortfolioChartsProps) {
  const chartData = historyData.map((p) => ({ date: p.date, 수익률: p.return_rate ?? null }));
  const showNetAsset = !!netAssetData && !!onNetAssetPeriodChange;
  const netChartData = (netAssetData ?? []).map((p) => ({ date: p.date, 순자산: p.net_asset ?? null }));

  return (
    <div className="pf-charts" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 기간별 수익률 라인차트 */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: 'var(--pf-accent)' }} />
            <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--pf-text)' }}>기간별 수익률</span>
          </div>
          <div style={{ display: 'flex', gap: 0, border: '1px solid var(--pf-border)', borderRadius: 8, overflow: 'hidden' }}>
            {(['3m', '6m', '1y', 'max'] as PeriodKey[]).map((period) => (
              <button key={period} onClick={() => onActivePeriodChange(period)} style={periodBtnStyle(activePeriod === period, 'var(--pf-accent)')}>
                {PERIOD_LABELS[period]}
              </button>
            ))}
          </div>
        </div>

        {historyLoading ? (
          <div style={emptyStyle}>로딩 중...</div>
        ) : chartData.length === 0 ? (
          <div style={emptyStyle}>이력 데이터가 없습니다.</div>
        ) : chartData.length < 3 ? (
          <div style={{ ...emptyStyle, textAlign: 'center', padding: '0 20px' }}>데이터가 3개 이상인 경우 그래프가 구현됩니다.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="date" tickFormatter={formatDateLabel} tick={{ fontSize: 11, fill: TICK }} tickLine={false} axisLine={{ stroke: AXIS_LINE }} />
              <YAxis tickFormatter={(v: number) => `${v.toFixed(1)}%`} tick={{ fontSize: 11, fill: TICK }} tickLine={false} axisLine={false} width={50} />
              <Tooltip content={<CustomLineTooltip />} />
              <Line type="monotone" dataKey="수익률" stroke={RETURN_LINE} strokeWidth={2} dot={{ r: 3, fill: RETURN_LINE, strokeWidth: 0 }} activeDot={{ r: 5, fill: RETURN_DOT, strokeWidth: 0 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 기간별 순자산 라인차트 */}
      {showNetAsset && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: NET_LINE }} />
              <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--pf-text)' }}>순자산 추이</span>
            </div>
            <div style={{ display: 'flex', gap: 0, border: '1px solid var(--pf-border)', borderRadius: 8, overflow: 'hidden' }}>
              {(['3m', '6m', '1y', 'max'] as PeriodKey[]).map((period) => (
                <button key={period} onClick={() => onNetAssetPeriodChange?.(period)} style={periodBtnStyle(netAssetPeriod === period, NET_LINE)}>
                  {PERIOD_LABELS[period]}
                </button>
              ))}
            </div>
          </div>

          {netAssetLoading ? (
            <div style={emptyStyle}>로딩 중...</div>
          ) : netChartData.length === 0 ? (
            <div style={emptyStyle}>이력 데이터가 없습니다.</div>
          ) : netChartData.length < 3 ? (
            <div style={{ ...emptyStyle, textAlign: 'center', padding: '0 20px' }}>데이터가 3개 이상인 경우 그래프가 구현됩니다.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={netChartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="date" tickFormatter={formatDateLabel} tick={{ fontSize: 11, fill: TICK }} tickLine={false} axisLine={{ stroke: AXIS_LINE }} />
                <YAxis tickFormatter={(v: number) => `${Math.round(v / 10000).toLocaleString('ko-KR')}만`} tick={{ fontSize: 11, fill: TICK }} tickLine={false} axisLine={false} width={56} />
                <Tooltip content={<CustomNetAssetTooltip />} />
                <Line type="monotone" dataKey="순자산" stroke={NET_LINE} strokeWidth={2} dot={{ r: 3, fill: NET_LINE, strokeWidth: 0 }} activeDot={{ r: 5, fill: NET_DOT, strokeWidth: 0 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* 분산 차트 2개 */}
      <div style={{ display: 'grid', gap: 16 }} className="chart-distribution-grid">
        <div style={{ ...cardStyle, overflow: 'hidden', minWidth: 0 }}>
          <DonutChart data={regionDistribution} colorMap={REGION_COLORS} title="지역 분산" />
        </div>
        <div style={{ ...cardStyle, overflow: 'hidden', minWidth: 0 }}>
          <DonutChart data={riskDistribution} colorMap={RISK_COLORS} title="위험도 분산" />
        </div>
      </div>
      <style>{`
        .chart-distribution-grid { grid-template-columns: 1fr 1fr; }
        @media (max-width: 640px) { .chart-distribution-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

export default PortfolioCharts;
