'use client';

export interface PerformanceSummaryData {
  hit_rate: number;
  avg_excess_return: number;
  tracked_count: number;
  status_distribution?: {
    success?: number;
    failure?: number;
    holding?: number;
  };
}

interface PerformanceSummaryProps {
  data: PerformanceSummaryData | null;
  loading?: boolean;
}

export function PerformanceSummary({ data, loading }: PerformanceSummaryProps) {
  if (loading) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              height: 80,
              borderRadius: 10,
              backgroundColor: 'var(--bg-surface)',
              animation: 'pulse 1.5s infinite',
            }}
          />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const dist = data.status_distribution ?? {};
  const total = (dist.success ?? 0) + (dist.failure ?? 0) + (dist.holding ?? 0);

  const cards = [
    {
      label: '추천 적중률',
      value: `${data.hit_rate.toFixed(1)}%`,
      desc: '목표 수익 달성 비율',
      color: data.hit_rate >= 60 ? '#059669' : data.hit_rate >= 40 ? '#D97706' : '#DC2626',
      bg: data.hit_rate >= 60 ? 'rgba(5,150,105,0.08)' : data.hit_rate >= 40 ? 'rgba(217,119,6,0.08)' : 'rgba(220,38,38,0.08)',
    },
    {
      label: '평균 초과수익',
      value: `${data.avg_excess_return > 0 ? '+' : ''}${data.avg_excess_return.toFixed(2)}%`,
      desc: '벤치마크 대비',
      color: data.avg_excess_return >= 0 ? '#059669' : '#DC2626',
      bg: data.avg_excess_return >= 0 ? 'rgba(5,150,105,0.08)' : 'rgba(220,38,38,0.08)',
    },
    {
      label: '추적 종목 수',
      value: `${data.tracked_count}개`,
      desc: '전체 추천 기록',
      color: 'var(--text-primary)',
      bg: 'var(--bg-surface)',
    },
    {
      label: '성공 / 실패 / 보유',
      value: total > 0 ? `${dist.success ?? 0} / ${dist.failure ?? 0} / ${dist.holding ?? 0}` : '-',
      desc: '상태별 분포',
      color: 'var(--text-primary)',
      bg: 'var(--bg-surface)',
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 12,
        marginBottom: 20,
      }}
    >
      {cards.map(({ label, value, desc, color, bg }) => (
        <div
          key={label}
          style={{
            padding: '14px 16px',
            borderRadius: 10,
            backgroundColor: bg,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: '1.125rem', fontWeight: 800, fontFamily: 'monospace', color, marginBottom: 3 }}>
            {value}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{desc}</div>
        </div>
      ))}
    </div>
  );
}

export default PerformanceSummary;
