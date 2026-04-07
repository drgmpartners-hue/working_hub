'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/common/Button';
import { useRetirementStore } from '../../hooks/useRetirementStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';
import type { ChartDataPoint } from './ComparisonChart';

// Recharts SSR 방지
const ComparisonChart = dynamic(() => import('./ComparisonChart'), { ssr: false });

/* ------------------------------------------------------------------ */
/*  타입 정의                                                           */
/* ------------------------------------------------------------------ */

interface ActualDataEntry {
  year: number;
  age?: number;
  year_num?: number;
  actual_evaluation: number;
  planned_evaluation: number;
  deviation_rate?: number;
  lump_sum_amount?: number;
  annual_savings_amount?: number;
  total_payment?: number;
  annual_total_profit?: number;
  annual_return_rate?: number;
  withdrawal_amount?: number;
}

interface ProjectedDataEntry {
  year: number;
  age?: number;
  year_num?: number;
  evaluation: number;
  original_planned_evaluation?: number;
}

interface InteractiveCalcResponse {
  id: number;
  profile_id: string;
  plan_year: number;
  actual_data?: ActualDataEntry[];
  projected_data?: ProjectedDataEntry[];
  deviation_rate?: number;
  ai_guide_result?: string;
}

interface AiAdjustment {
  type: string;
  current: string | number;
  suggested: string | number;
  description: string;
}

interface AiGuideResponse {
  adjustments: AiAdjustment[];
  ai_explanation: string;
}

/* ------------------------------------------------------------------ */
/*  스타일 상수                                                         */
/* ------------------------------------------------------------------ */

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #E5E7EB',
  borderRadius: '12px',
  padding: '24px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#1E3A5F',
  marginBottom: '20px',
  marginTop: 0,
};

/* ------------------------------------------------------------------ */
/*  토스트                                                              */
/* ------------------------------------------------------------------ */

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '32px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        padding: '12px 24px',
        borderRadius: '8px',
        backgroundColor: type === 'success' ? '#1E3A5F' : '#EF4444',
        color: '#ffffff',
        fontSize: '14px',
        fontWeight: 500,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        pointerEvents: 'none',
      }}
    >
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  이격률 표시 컴포넌트                                               */
/* ------------------------------------------------------------------ */

function DeviationBadge({
  rate,
  onRequestGuide,
  isLoadingGuide,
}: {
  rate: number;
  onRequestGuide: () => void;
  isLoadingGuide: boolean;
}) {
  const isAbove = rate > 2;
  const isBelow = rate < -2;
  const isMatch = !isAbove && !isBelow;

  const color = isAbove ? '#10B981' : isBelow ? '#EF4444' : '#3B82F6';
  const bgColor = isAbove
    ? 'rgba(16,185,129,0.08)'
    : isBelow
    ? 'rgba(239,68,68,0.08)'
    : 'rgba(59,130,246,0.08)';
  const arrow = isAbove ? '↑' : isBelow ? '↓' : '→';
  const label = isAbove ? '계획 상회' : isBelow ? '계획 하회' : '계획 부합';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 20px',
          borderRadius: '12px',
          backgroundColor: bgColor,
          border: `1.5px solid ${color}22`,
        }}
      >
        <span style={{ fontSize: '32px', fontWeight: 800, color, letterSpacing: '-1px' }}>
          {rate > 0 ? '+' : ''}
          {rate.toFixed(1)}%
        </span>
        <div>
          <div style={{ fontSize: '20px', color }}>{arrow}</div>
          <div style={{ fontSize: '12px', color, fontWeight: 600 }}>{label}</div>
        </div>
      </div>

      {isBelow && (
        <Button
          variant="primary"
          size="md"
          loading={isLoadingGuide}
          onClick={onRequestGuide}
        >
          AI 가이드 요청
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AI 가이드 카드                                                     */
/* ------------------------------------------------------------------ */

function AiGuideCard({ guide }: { guide: AiGuideResponse }) {
  const typeLabel: Record<string, string> = {
    savings: '적립액 조정',
    return_rate: '수익률 조정',
    period: '기간 조정',
  };

  return (
    <div
      style={{
        backgroundColor: '#EFF6FF',
        border: '1px solid #BFDBFE',
        borderRadius: '12px',
        padding: '20px',
        marginTop: '16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '16px',
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            backgroundColor: '#1E3A5F',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            color: '#ffffff',
            fontWeight: 700,
          }}
        >
          AI
        </div>
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#1E3A5F' }}>
          종합금융자산관리사 분석
        </span>
      </div>

      {/* 3가지 조정 방안 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        {guide.adjustments.map((adj, idx) => (
          <div
            key={idx}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: '14px',
              border: '1px solid #BFDBFE',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#3B82F6',
                textTransform: 'uppercase',
                marginBottom: '6px',
              }}
            >
              {typeLabel[adj.type] ?? adj.type}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '6px',
              }}
            >
              <span style={{ fontSize: '13px', color: '#6B7280' }}>{adj.current}</span>
              <span style={{ color: '#9CA3AF' }}>→</span>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#1E3A5F' }}>
                {adj.suggested}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#374151', lineHeight: 1.5 }}>
              {adj.description}
            </div>
          </div>
        ))}
      </div>

      {/* AI 근거 설명 */}
      <div
        style={{
          fontSize: '13px',
          color: '#374151',
          lineHeight: 1.7,
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          padding: '12px',
          border: '1px solid #BFDBFE',
        }}
      >
        {guide.ai_explanation}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  연도별 비교 테이블                                                  */
/* ------------------------------------------------------------------ */

function ComparisonTable({ actualData }: { actualData: ActualDataEntry[] }) {
  if (!actualData || actualData.length === 0) return null;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '13px',
        }}
      >
        <thead>
          <tr style={{ backgroundColor: '#F9FAFB' }}>
            {['연도', '나이', '계획 평가액', '실제 평가액', '차이', '이격률'].map((col) => (
              <th
                key={col}
                style={{
                  padding: '10px 12px',
                  textAlign: col === '연도' || col === '나이' ? 'center' : 'right',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#6B7280',
                  borderBottom: '1px solid #E5E7EB',
                  whiteSpace: 'nowrap',
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {actualData.map((row, idx) => {
            const diff = row.actual_evaluation - row.planned_evaluation;
            const isPositive = diff >= 0;
            const diffColor = isPositive ? '#10B981' : '#EF4444';
            const rateVal = row.deviation_rate ?? 0;
            const rateColor = rateVal > 2 ? '#10B981' : rateVal < -2 ? '#EF4444' : '#3B82F6';

            return (
              <tr
                key={row.year}
                style={{
                  backgroundColor: idx % 2 === 0 ? '#ffffff' : '#FAFAFA',
                  borderBottom: '1px solid #F3F4F6',
                }}
              >
                <td
                  style={{ padding: '8px 12px', textAlign: 'center', color: '#374151' }}
                >
                  {row.year}
                </td>
                <td
                  style={{ padding: '8px 12px', textAlign: 'center', color: '#374151' }}
                >
                  {row.age != null ? `${row.age}세` : '-'}
                </td>
                <td
                  style={{
                    padding: '8px 12px',
                    textAlign: 'right',
                    color: '#1A1A2E',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatCurrency(row.planned_evaluation)}
                </td>
                <td
                  style={{
                    padding: '8px 12px',
                    textAlign: 'right',
                    color: '#1A1A2E',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatCurrency(row.actual_evaluation)}
                </td>
                <td
                  style={{
                    padding: '8px 12px',
                    textAlign: 'right',
                    color: diffColor,
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isPositive ? '+' : ''}
                  {formatCurrency(diff)}
                </td>
                <td
                  style={{
                    padding: '8px 12px',
                    textAlign: 'right',
                    color: rateColor,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {rateVal > 0 ? '+' : ''}
                  {rateVal.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  메인 컴포넌트                                                       */
/* ------------------------------------------------------------------ */

export function InteractiveCalcTab() {
  const { selectedCustomer } = useRetirementStore();
  const customerId = selectedCustomer?.id ?? null;

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingGuide, setIsLoadingGuide] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(
    null
  );

  const [calcResult, setCalcResult] = useState<InteractiveCalcResponse | null>(null);
  const [noPlanError, setNoPlanError] = useState(false);
  const [noInvestmentData, setNoInvestmentData] = useState(false);
  const [aiGuide, setAiGuide] = useState<AiGuideResponse | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  /* 데이터 로드 */
  const loadData = useCallback(
    async (cid: string) => {
      setIsLoading(true);
      setNoPlanError(false);
      setNoInvestmentData(false);
      setCalcResult(null);
      setAiGuide(null);

      try {
        const planYear = new Date().getFullYear();
        const res = await fetch(`${API_URL}/api/v1/retirement/simulation/interactive`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authLib.getAuthHeader(),
          },
          body: JSON.stringify({ customer_id: cid, plan_year: planYear }),
        });

        if (res.status === 404) {
          const err = await res.json().catch(() => ({}));
          const detail = (err as { detail?: string }).detail ?? '';
          if (detail.includes('플랜')) {
            setNoPlanError(true);
          }
          return;
        }

        if (!res.ok) {
          showToast('데이터 로드에 실패했습니다.', 'error');
          return;
        }

        const data: InteractiveCalcResponse = await res.json();
        setCalcResult(data);

        const hasActual = data.actual_data && data.actual_data.length > 0;
        if (!hasActual) {
          setNoInvestmentData(true);
        }

        // 저장된 ai_guide_result가 있으면 파싱
        if (data.ai_guide_result) {
          try {
            const parsed = JSON.parse(data.ai_guide_result) as AiGuideResponse;
            setAiGuide(parsed);
          } catch {
            // 무시
          }
        }
      } catch {
        showToast('네트워크 오류가 발생했습니다.', 'error');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (customerId) {
      loadData(customerId);
    } else {
      setCalcResult(null);
      setNoPlanError(false);
      setNoInvestmentData(false);
      setAiGuide(null);
    }
  }, [customerId, loadData]);

  /* AI 가이드 요청 */
  const handleRequestAiGuide = async () => {
    if (!customerId || !calcResult) return;
    setIsLoadingGuide(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/ai-guide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({
          customer_id: customerId,
          deviation_rate: calcResult.deviation_rate,
          current_evaluation:
            calcResult.actual_data && calcResult.actual_data.length > 0
              ? calcResult.actual_data[calcResult.actual_data.length - 1].actual_evaluation
              : 0,
          plan_annual_savings: 0,
          plan_return_rate: 0,
          remaining_years: 0,
          target_fund: 0,
        }),
      });

      if (res.ok) {
        const data = await res.json() as AiGuideResponse;
        setAiGuide(data);
      } else {
        showToast('AI 가이드 요청에 실패했습니다.', 'error');
      }
    } catch {
      showToast('AI 가이드 요청 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsLoadingGuide(false);
    }
  };

  /* 저장 */
  const handleSave = async () => {
    if (!customerId) {
      showToast('고객을 먼저 선택하세요.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const planYear = new Date().getFullYear();
      const res = await fetch(`${API_URL}/api/v1/retirement/simulation/interactive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({ customer_id: customerId, plan_year: planYear }),
      });
      if (res.ok) {
        showToast('저장되었습니다.', 'success');
      } else {
        showToast('저장에 실패했습니다.', 'error');
      }
    } catch {
      showToast('네트워크 오류가 발생했습니다.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  /* 차트 데이터 구성 */
  const buildChartData = (): ChartDataPoint[] => {
    if (!calcResult) return [];

    const planData = calcResult.actual_data ?? [];
    const projectedData = calcResult.projected_data ?? [];

    // actual_data: plan + actual 구간
    const actualPoints: ChartDataPoint[] = planData.map((entry) => {
      const gap =
        entry.planned_evaluation > 0
          ? Math.abs(entry.actual_evaluation - entry.planned_evaluation)
          : undefined;
      return {
        age: entry.age ?? 0,
        plan: Math.round(entry.planned_evaluation),
        actual: Math.round(entry.actual_evaluation),
        projected: undefined,
        gap: gap ? Math.round(gap) : undefined,
      };
    });

    // projected_data: 수정 예측 구간
    const projectedPoints: ChartDataPoint[] = projectedData.map((entry) => ({
      age: entry.age ?? 0,
      plan: Math.round(entry.original_planned_evaluation ?? 0) || undefined,
      actual: undefined,
      projected: Math.round(entry.evaluation),
      gap: undefined,
    }));

    return [...actualPoints, ...projectedPoints].filter((p) => p.age > 0);
  };

  const chartData = buildChartData();

  // 현재 연도에 해당하는 나이를 actual_data에서 추출
  const currentYear = new Date().getFullYear();
  const currentAgeFromData = calcResult?.actual_data?.find(
    (d) => d.year === currentYear
  )?.age;

  const deviationRate = calcResult?.deviation_rate;
  const actualData = calcResult?.actual_data ?? [];

  /* ------------------------------------------------------------------ */
  /*  렌더링                                                             */
  /* ------------------------------------------------------------------ */

  if (!customerId) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '300px',
          color: '#9CA3AF',
          fontSize: '14px',
        }}
      >
        상단에서 고객을 선택해주세요.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '300px',
          color: '#6B7280',
          fontSize: '14px',
        }}
      >
        데이터를 불러오는 중...
      </div>
    );
  }

  if (noPlanError) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '300px',
          gap: '8px',
          color: '#6B7280',
          fontSize: '14px',
        }}
      >
        <div style={{ fontSize: '32px' }}>📋</div>
        <div style={{ fontWeight: 600, color: '#374151' }}>은퇴플랜이 없습니다</div>
        <div>3번탭에서 은퇴플랜을 먼저 저장해주세요.</div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        maxWidth: '1100px',
        margin: '0 auto',
      }}
    >
      {/* 비교 그래프 */}
      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>계획 vs 실제 비교 그래프</h3>

        {chartData.length > 0 ? (
          <ComparisonChart data={chartData} currentAge={currentAgeFromData} />
        ) : (
          <div
            style={{
              height: '200px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9CA3AF',
              fontSize: '13px',
              backgroundColor: '#F9FAFB',
              borderRadius: '8px',
            }}
          >
            {noInvestmentData
              ? '투자기록이 없습니다. 계획 그래프 데이터가 없습니다.'
              : '데이터가 없습니다.'}
          </div>
        )}

        {/* 이격률 */}
        {deviationRate != null && (
          <div style={{ marginTop: '20px' }}>
            <div
              style={{
                fontSize: '13px',
                fontWeight: 500,
                color: '#6B7280',
                marginBottom: '10px',
              }}
            >
              현재 이격률
            </div>
            <DeviationBadge
              rate={deviationRate}
              onRequestGuide={handleRequestAiGuide}
              isLoadingGuide={isLoadingGuide}
            />

            {/* AI 가이드 결과 */}
            {aiGuide && <AiGuideCard guide={aiGuide} />}
          </div>
        )}

        {noInvestmentData && !deviationRate && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px 16px',
              backgroundColor: '#FFF7ED',
              border: '1px solid #FED7AA',
              borderRadius: '8px',
              fontSize: '13px',
              color: '#92400E',
            }}
          >
            2번탭에서 투자기록을 입력하면 실제 데이터와 계획을 비교할 수 있습니다.
          </div>
        )}
      </div>

      {/* 연도별 비교 테이블 */}
      {actualData.length > 0 && (
        <div style={cardStyle}>
          <h3 style={sectionTitleStyle}>연도별 비교</h3>
          <ComparisonTable actualData={actualData} />
        </div>
      )}

      {/* 저장 버튼 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="secondary"
          size="md"
          loading={isSaving}
          onClick={handleSave}
          disabled={!calcResult}
        >
          저장
        </Button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

export default InteractiveCalcTab;
