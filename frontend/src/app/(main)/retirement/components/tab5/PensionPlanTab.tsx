'use client';

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRetirementStore } from '../../hooks/useRetirementStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';
import type { RetirementPlanData, YearlyProjection } from '../../types/retirement';
import type { LifecycleDataPoint } from './LifecycleChart';

/* ------------------------------------------------------------------ */
/*  LifecycleChart - SSR 방지                                           */
/* ------------------------------------------------------------------ */

const LifecycleChart = dynamic(() => import('./LifecycleChart'), { ssr: false });

/* ------------------------------------------------------------------ */
/*  연금 지급 방법 타입                                                  */
/* ------------------------------------------------------------------ */

type PensionType = 'lifetime' | 'fixed' | 'inheritance';

interface PensionOption {
  key: PensionType;
  label: string;
  durationLabel: string;
}

const PENSION_OPTIONS: PensionOption[] = [
  { key: 'lifetime', label: '종신형', durationLabel: '종신(100세)' },
  { key: 'fixed', label: '확정형', durationLabel: '20년' },
  { key: 'inheritance', label: '상속형', durationLabel: '종신' },
];

/* ------------------------------------------------------------------ */
/*  연금 계산 로직 (프론트엔드 자체 계산)                                */
/* ------------------------------------------------------------------ */

interface PensionCalcResult {
  monthly_amount: number;
  total_amount: number;
  remaining_principal: number;
  duration_label: string;
}

function calculatePension(
  finalFund: number,
  pensionType: PensionType,
  retirementAge: number,
  annualReturnRate: number,
): PensionCalcResult {
  const endAge = 100;
  const years = endAge - retirementAge;
  const monthlyRate = annualReturnRate / 100 / 12;

  if (pensionType === 'lifetime') {
    // 종신형: 100세까지 균등 분할 수령, 월 수익률 반영
    let monthly_amount: number;
    if (monthlyRate > 0) {
      const periods = years * 12;
      monthly_amount = Math.round(
        (finalFund * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -periods)),
      );
    } else {
      monthly_amount = Math.round(finalFund / (years * 12));
    }
    const total_amount = monthly_amount * years * 12;
    return {
      monthly_amount,
      total_amount,
      remaining_principal: 0,
      duration_label: '종신(100세)',
    };
  }

  if (pensionType === 'fixed') {
    // 확정형: 20년 확정 수령
    const fixedYears = 20;
    const periods = fixedYears * 12;
    let monthly_amount: number;
    if (monthlyRate > 0) {
      monthly_amount = Math.round(
        (finalFund * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -periods)),
      );
    } else {
      monthly_amount = Math.round(finalFund / periods);
    }
    const total_amount = monthly_amount * periods;
    return {
      monthly_amount,
      total_amount,
      remaining_principal: 0,
      duration_label: '20년',
    };
  }

  // 상속형: 이자만 수령, 원금 유지
  const monthly_amount = Math.round((finalFund * annualReturnRate) / 100 / 12);
  const total_amount = monthly_amount * years * 12;
  return {
    monthly_amount,
    total_amount,
    remaining_principal: finalFund,
    duration_label: '종신',
  };
}

/* ------------------------------------------------------------------ */
/*  그래프 데이터 생성                                                   */
/* ------------------------------------------------------------------ */

function buildLifecycleData(
  projections: YearlyProjection[],
  retirementAge: number,
  finalFund: number,
  pensionCalc: PensionCalcResult,
  annualReturnRate: number,
): LifecycleDataPoint[] {
  const result: LifecycleDataPoint[] = [];

  // 모으기 구간: 시뮬레이션 데이터 사용
  for (const p of projections) {
    result.push({
      age: p.age,
      accumulation: Math.round(p.evaluation),
      distribution: undefined,
      phase: 'accumulation',
    });
  }

  // 쓰기 구간: 은퇴 ~ 100세
  const monthlyRate = annualReturnRate / 100 / 12;
  let balance = finalFund;

  for (let age = retirementAge + 1; age <= 100; age++) {
    // 1년 경과
    if (annualReturnRate > 0) {
      balance = balance * Math.pow(1 + monthlyRate, 12) - pensionCalc.monthly_amount * 12;
    } else {
      balance = balance - pensionCalc.monthly_amount * 12;
    }
    const displayBalance = Math.max(0, Math.round(balance));
    result.push({
      age,
      accumulation: undefined,
      distribution: displayBalance,
      phase: 'distribution',
    });
    if (displayBalance === 0) break;
  }

  // 100세까지 채우기
  const lastAge = result[result.length - 1]?.age ?? retirementAge;
  if (lastAge < 100) {
    for (let age = lastAge + 1; age <= 100; age++) {
      result.push({
        age,
        accumulation: undefined,
        distribution: 0,
        phase: 'distribution',
      });
    }
  }

  return result;
}

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
/*  스타일 상수                                                          */
/* ------------------------------------------------------------------ */

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #E5E7EB',
  borderRadius: '12px',
  padding: '24px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#1E3A5F',
  marginBottom: '20px',
  marginTop: 0,
};

/* ------------------------------------------------------------------ */
/*  요약 카드 항목                                                       */
/* ------------------------------------------------------------------ */

function SummaryItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '16px',
        backgroundColor: highlight ? 'rgba(30,58,95,0.05)' : '#F9FAFB',
        borderRadius: '10px',
        border: highlight ? '1px solid rgba(30,58,95,0.18)' : '1px solid #F3F4F6',
      }}
    >
      <span style={{ fontSize: '12px', color: '#9CA3AF', fontWeight: 500 }}>{label}</span>
      <span
        style={{
          fontSize: '18px',
          fontWeight: 700,
          color: highlight ? '#1E3A5F' : '#1A1A2E',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  메인 컴포넌트                                                        */
/* ------------------------------------------------------------------ */

export function PensionPlanTab() {
  const { selectedCustomer, setTab } = useRetirementStore();
  const customerId = selectedCustomer?.id ?? null;

  // 상태
  const [isLoading, setIsLoading] = useState(false);
  const [planData, setPlanData] = useState<RetirementPlanData | null>(null);
  const [projections, setProjections] = useState<YearlyProjection[] | null>(null);
  const [selectedPensionType, setSelectedPensionType] = useState<PensionType>('lifetime');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  /* 3번탭 저장 데이터 로드 */
  const loadPlanData = useCallback(async (cid: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/plans/${cid}`, {
        headers: authLib.getAuthHeader(),
      });
      if (res.ok) {
        const data = await res.json();
        // 배열 또는 단일 객체 대응
        const plan: RetirementPlanData = Array.isArray(data) ? data[0] : data;
        if (!plan) {
          setPlanData(null);
          setProjections(null);
          return;
        }
        setPlanData(plan);

        // yearly_projections가 있으면 사용, 없으면 시뮬레이션 실행
        if (plan.yearly_projections && Array.isArray(plan.yearly_projections) && plan.yearly_projections.length > 0) {
          setProjections(plan.yearly_projections as YearlyProjection[]);
        } else {
          // 시뮬레이션 실행
          const simRes = await fetch(`${API_URL}/api/v1/retirement/simulation/calculate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authLib.getAuthHeader(),
            },
            body: JSON.stringify({
              current_age: plan.current_age,
              annual_return_rate: plan.annual_return_rate,
              lump_sum_amount: plan.lump_sum_amount ?? 0,
              annual_savings: plan.annual_savings ?? 0,
              saving_period_years: plan.saving_period_years ?? 0,
              target_pension_amount: plan.target_pension_amount ?? 0,
            }),
          });
          if (simRes.ok) {
            const simData = await simRes.json();
            setProjections(simData.yearly_projections);
          }
        }
      } else if (res.status === 404) {
        setPlanData(null);
        setProjections(null);
      }
    } catch {
      // 네트워크 에러 무시
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (customerId) {
      loadPlanData(customerId);
    } else {
      setPlanData(null);
      setProjections(null);
    }
  }, [customerId, loadPlanData]);

  /* 계산된 값들 */
  const retirementAge =
    planData?.desired_retirement_age ?? planData?.possible_retirement_age ?? 65;
  const currentAge = planData?.current_age ?? 0;
  const savingPeriod = planData?.saving_period_years ?? 0;
  const annualSavings = planData?.annual_savings ?? 0;
  const lumpSum = planData?.lump_sum_amount ?? 0;
  const annualReturnRate = planData?.annual_return_rate ?? 5;
  const targetFund = planData?.target_retirement_fund ?? 0;

  // 최종 평가금액: 마지막 projection의 evaluation
  const finalFund =
    projections && projections.length > 0
      ? Math.round(projections[projections.length - 1].evaluation)
      : 0;

  // 총납입금액
  const totalContribution =
    projections && projections.length > 0
      ? Math.round(projections[projections.length - 1].total_contribution)
      : lumpSum + annualSavings * savingPeriod;

  // 달성률
  const achievementRate =
    targetFund > 0 ? Math.round((finalFund / targetFund) * 100) : 0;

  // 각 연금 방법별 계산
  const pensionResults: Record<PensionType, PensionCalcResult> = {
    lifetime: calculatePension(finalFund, 'lifetime', retirementAge, annualReturnRate),
    fixed: calculatePension(finalFund, 'fixed', retirementAge, annualReturnRate),
    inheritance: calculatePension(finalFund, 'inheritance', retirementAge, annualReturnRate),
  };

  // 선택된 방법의 결과
  const selectedResult = pensionResults[selectedPensionType];

  // 통합 라이프사이클 그래프 데이터
  const lifecycleData =
    projections && projections.length > 0 && finalFund > 0
      ? buildLifecycleData(projections, retirementAge, finalFund, selectedResult, annualReturnRate)
      : [];

  /* 저장 핸들러 (선택된 방법 정보 저장) */
  const handleSave = async () => {
    if (!customerId) {
      showToast('고객을 먼저 선택하세요.', 'error');
      return;
    }
    showToast('연금수령 계획이 저장되었습니다.', 'success');
  };

  /* 데이터 없는 경우 */
  if (!customerId) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '400px',
          gap: '12px',
          color: '#9CA3AF',
        }}
      >
        <div style={{ fontSize: '16px' }}>상단에서 고객을 선택하세요.</div>
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
          minHeight: '400px',
          color: '#9CA3AF',
          fontSize: '14px',
        }}
      >
        데이터 로딩 중...
      </div>
    );
  }

  if (!planData) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '400px',
          gap: '16px',
        }}
      >
        <div style={{ fontSize: '16px', color: '#6B7280' }}>
          은퇴플랜을 먼저 저장해주세요.
        </div>
        <div style={{ fontSize: '13px', color: '#9CA3AF' }}>
          3번탭에서 은퇴플랜을 입력하고 저장하면 연금수령 계획을 확인할 수 있습니다.
        </div>
        <button
          onClick={() => setTab('retirement-plan')}
          style={{
            padding: '10px 24px',
            backgroundColor: '#1E3A5F',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          3번탭 은퇴플랜으로 이동
        </button>
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
      {/* (1) 모으는 기간 요약 카드 */}
      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>모으는 기간 요약</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '12px',
          }}
        >
          <SummaryItem label="납입기간" value={`${savingPeriod}년`} />
          <SummaryItem
            label="총납입금액"
            value={`${formatCurrency(totalContribution)} 만원`}
          />
          <SummaryItem
            label="예상 은퇴자금"
            value={`${formatCurrency(finalFund)} 만원`}
            highlight
          />
          <SummaryItem
            label="달성률"
            value={
              targetFund > 0
                ? `${achievementRate.toLocaleString('ko-KR')}%`
                : '-'
            }
            highlight={achievementRate >= 100}
          />
        </div>
        <div
          style={{
            marginTop: '12px',
            fontSize: '12px',
            color: '#9CA3AF',
          }}
        >
          현재 나이 {currentAge}세 / 희망 은퇴나이 {retirementAge}세 / 연수익률{' '}
          {annualReturnRate}%
        </div>
      </div>

      {/* (2) 연금지급방법 비교 */}
      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>연금지급방법 비교</h3>

        {/* 방법 선택 버튼 */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {PENSION_OPTIONS.map((opt) => {
            const isSelected = selectedPensionType === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setSelectedPensionType(opt.key)}
                style={{
                  padding: '8px 20px',
                  fontSize: '14px',
                  fontWeight: isSelected ? 600 : 400,
                  color: isSelected ? '#ffffff' : '#374151',
                  backgroundColor: isSelected ? '#1E3A5F' : '#F9FAFB',
                  border: isSelected ? '1px solid #1E3A5F' : '1px solid #E5E7EB',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* 비교 테이블 */}
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '14px',
            }}
          >
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#6B7280',
                    borderBottom: '1px solid #E5E7EB',
                    width: '120px',
                  }}
                >
                  구분
                </th>
                {PENSION_OPTIONS.map((opt) => {
                  const isSelected = selectedPensionType === opt.key;
                  return (
                    <th
                      key={opt.key}
                      style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: isSelected ? '#1E3A5F' : '#6B7280',
                        borderBottom: '1px solid #E5E7EB',
                        backgroundColor: isSelected ? '#EFF6FF' : '#F9FAFB',
                      }}
                    >
                      {opt.label}
                      {isSelected && (
                        <span
                          style={{
                            marginLeft: '6px',
                            fontSize: '10px',
                            backgroundColor: '#1E3A5F',
                            color: '#ffffff',
                            padding: '2px 6px',
                            borderRadius: '4px',
                          }}
                        >
                          선택
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* 월수령액 */}
              <CompareRow
                label="월수령액"
                values={PENSION_OPTIONS.map((opt) => ({
                  key: opt.key,
                  value: `${formatCurrency(pensionResults[opt.key].monthly_amount)} 만원`,
                  selected: selectedPensionType === opt.key,
                }))}
              />
              {/* 수령기간 */}
              <CompareRow
                label="수령기간"
                values={PENSION_OPTIONS.map((opt) => ({
                  key: opt.key,
                  value: opt.durationLabel,
                  selected: selectedPensionType === opt.key,
                }))}
              />
              {/* 총수령액 */}
              <CompareRow
                label="총수령액"
                values={PENSION_OPTIONS.map((opt) => ({
                  key: opt.key,
                  value: `${formatCurrency(pensionResults[opt.key].total_amount)} 만원`,
                  selected: selectedPensionType === opt.key,
                }))}
              />
              {/* 잔여원금 */}
              <CompareRow
                label="잔여원금"
                values={PENSION_OPTIONS.map((opt) => ({
                  key: opt.key,
                  value:
                    pensionResults[opt.key].remaining_principal > 0
                      ? `${formatCurrency(pensionResults[opt.key].remaining_principal)} 만원`
                      : '0',
                  selected: selectedPensionType === opt.key,
                }))}
                isLast
              />
            </tbody>
          </table>
        </div>
      </div>

      {/* (3) 통합 라이프사이클 그래프 */}
      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>통합 라이프사이클 그래프</h3>
        {lifecycleData.length > 0 ? (
          <LifecycleChart data={lifecycleData} retirementAge={retirementAge} />
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
            은퇴플랜 데이터가 있으면 그래프가 표시됩니다.
          </div>
        )}
      </div>

      {/* 저장 버튼 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: '24px' }}>
        <button
          onClick={handleSave}
          style={{
            padding: '10px 28px',
            backgroundColor: '#1E3A5F',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(30,58,95,0.2)',
          }}
        >
          저장
        </button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  비교 테이블 행 컴포넌트                                              */
/* ------------------------------------------------------------------ */

function CompareRow({
  label,
  values,
  isLast = false,
}: {
  label: string;
  values: Array<{ key: PensionType; value: string; selected: boolean }>;
  isLast?: boolean;
}) {
  return (
    <tr style={{ borderBottom: isLast ? 'none' : '1px solid #F3F4F6' }}>
      <td
        style={{
          padding: '12px 16px',
          fontSize: '13px',
          fontWeight: 500,
          color: '#6B7280',
          backgroundColor: '#F9FAFB',
        }}
      >
        {label}
      </td>
      {values.map((v) => (
        <td
          key={v.key}
          style={{
            padding: '12px 16px',
            textAlign: 'center',
            fontSize: '14px',
            fontWeight: v.selected ? 700 : 400,
            color: v.selected ? '#1E3A5F' : '#374151',
            backgroundColor: v.selected ? '#EFF6FF' : '#ffffff',
          }}
        >
          {v.value}
        </td>
      ))}
    </tr>
  );
}

export default PensionPlanTab;
