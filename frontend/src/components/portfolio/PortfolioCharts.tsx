'use client';

import { useState } from 'react';
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
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
}

export interface DistributionItem {
  name: string;
  value: number; // 평가금액
}

export type PeriodKey = '3m' | '6m' | '1y';

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
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const REGION_COLORS: Record<string, string> = {
  국내: '#1E3A5F',
  미국: '#3B82F6',
  글로벌: '#10B981',
  베트남: '#F59E0B',
  인도: '#EF4444',
  중국: '#8B5CF6',
  기타: '#9CA3AF',
};

const RISK_COLORS: Record<string, string> = {
  절대안정형: '#3B82F6',
  안정형: '#10B981',
  성장형: '#F59E0B',
  절대성장형: '#EF4444',
};

const FALLBACK_COLORS = ['#1E3A5F', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#9CA3AF'];

const PERIOD_LABELS: Record<PeriodKey, string> = {
  '3m': '3개월',
  '6m': '6개월',
  '1y': '1년',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const fmt = (n: number) => n.toLocaleString('ko-KR');

function formatDateLabel(dateStr: string): string {
  if (!dateStr) return '';
  // YYYY-MM-DD → MM/DD
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[1]}/${parts[2]}`;
  return dateStr;
}

/* ------------------------------------------------------------------ */
/*  Custom Tooltip for LineChart                                        */
/* ------------------------------------------------------------------ */

function CustomLineTooltip({ active, payload, label }: { active?: boolean; payload?: { value?: number }[]; label?: string }) {
  if (!active || !payload || !payload.length) return null;
  const val = payload[0]?.value;
  if (val == null) return null;
  const color = val > 0 ? '#10B981' : val < 0 ? '#EF4444' : '#374151';
  return (
    <div
      style={{
        backgroundColor: '#fff',
        border: '1px solid #E1E5EB',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: '0.8125rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ color: '#6B7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 700, color }}>
        {val > 0 ? '+' : ''}{val.toFixed(2)}%
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Custom Tooltip for PieChart                                         */
/* ------------------------------------------------------------------ */

function CustomPieTooltip({ active, payload }: { active?: boolean; payload?: { name?: string; value?: number }[] }) {
  if (!active || !payload || !payload.length) return null;
  const item = payload[0];
  return (
    <div
      style={{
        backgroundColor: '#fff',
        border: '1px solid #E1E5EB',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: '0.8125rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ fontWeight: 600, color: '#1A1A2E' }}>{item.name}</div>
      <div style={{ color: '#6B7280' }}>{fmt(item.value ?? 0)}원</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section title                                                       */
/* ------------------------------------------------------------------ */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          width: 3,
          height: 18,
          borderRadius: 2,
          backgroundColor: '#1E3A5F',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
        {children}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Donut chart component                                               */
/* ------------------------------------------------------------------ */

function DonutChart({
  data,
  colorMap,
  title,
}: {
  data: DistributionItem[];
  colorMap: Record<string, string>;
  title: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);

  if (data.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: 220,
          color: '#9CA3AF',
          fontSize: '0.875rem',
        }}
      >
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
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((entry, idx) => (
                <Cell
                  key={entry.name}
                  fill={colorMap[entry.name] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]}
                />
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
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    backgroundColor: color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: '0.8125rem', color: '#374151', flex: 1 }}>{entry.name}</span>
                <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1A1A2E' }}>{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
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
}: PortfolioChartsProps) {
  const chartData = historyData.map((p) => ({
    date: formatDateLabel(p.date),
    수익률: p.return_rate ?? null,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 기간별 수익률 라인차트 */}
      <div
        style={{
          border: '1px solid #E1E5EB',
          borderRadius: 12,
          padding: 20,
          backgroundColor: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: '#1E3A5F' }} />
            <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
              기간별 수익률
            </span>
          </div>
          {/* Period tabs */}
          <div style={{ display: 'flex', gap: 0, border: '1px solid #E1E5EB', borderRadius: 8, overflow: 'hidden' }}>
            {(['3m', '6m', '1y'] as PeriodKey[]).map((period) => (
              <button
                key={period}
                onClick={() => onActivePeriodChange(period)}
                style={{
                  padding: '6px 14px',
                  fontSize: '0.8125rem',
                  fontWeight: activePeriod === period ? 700 : 500,
                  color: activePeriod === period ? '#fff' : '#6B7280',
                  backgroundColor: activePeriod === period ? '#1E3A5F' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {PERIOD_LABELS[period]}
              </button>
            ))}
          </div>
        </div>

        {historyLoading ? (
          <div
            style={{
              height: 220,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9CA3AF',
              fontSize: '0.875rem',
            }}
          >
            로딩 중...
          </div>
        ) : chartData.length === 0 ? (
          <div
            style={{
              height: 220,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9CA3AF',
              fontSize: '0.875rem',
            }}
          >
            이력 데이터가 없습니다.
          </div>
        ) : chartData.length < 3 ? (
          <div
            style={{
              height: 220,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9CA3AF',
              fontSize: '0.875rem',
              textAlign: 'center',
              padding: '0 20px',
            }}
          >
            데이터가 3개 이상인 경우 그래프가 구현됩니다.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={{ stroke: '#E1E5EB' }}
              />
              <YAxis
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
                width={50}
              />
              <Tooltip content={<CustomLineTooltip />} />
              <Line
                type="monotone"
                dataKey="수익률"
                stroke="#1E3A5F"
                strokeWidth={2}
                dot={{ r: 3, fill: '#1E3A5F', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#3B82F6', strokeWidth: 0 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 분산 차트 2개 - 웹: 가로, 모바일: 세로 */}
      <div style={{ display: 'grid', gap: 16 }} className="chart-distribution-grid">
        <div
          style={{
            border: '1px solid #E1E5EB',
            borderRadius: 12,
            padding: 20,
            backgroundColor: '#fff',
          }}
        >
          <DonutChart
            data={regionDistribution}
            colorMap={REGION_COLORS}
            title="지역 분산"
          />
        </div>
        <div
          style={{
            border: '1px solid #E1E5EB',
            borderRadius: 12,
            padding: 20,
            backgroundColor: '#fff',
          }}
        >
          <DonutChart
            data={riskDistribution}
            colorMap={RISK_COLORS}
            title="위험도 분산"
          />
        </div>
      </div>
      <style>{`
        .chart-distribution-grid { grid-template-columns: 1fr 1fr; }
        @media (max-width: 640px) {
          .chart-distribution-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

export default PortfolioCharts;
