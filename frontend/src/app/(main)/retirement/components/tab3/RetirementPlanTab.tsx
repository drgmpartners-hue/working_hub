'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/common/Button';
import { ExportButtons } from '../ExportButtons';
import { useRetirementStore } from '../../hooks/useRetirementStore';
import { formatCurrency, formatInputCurrency, parseCurrency } from '../../utils/formatCurrency';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';
import type {
  YearlyProjection,
  SimulationCalculateRequest,
  SimulationCalculateResponse,
  RetirementPlanData,
} from '../../types/retirement';

/* ------------------------------------------------------------------ */
/*  1번탭 desired-plans 응답 타입 (필요 필드만)                         */
/* ------------------------------------------------------------------ */

interface DesiredPlanSummary {
  desired_retirement_age?: number | null;
  savings_period_years?: number | null;
  holding_period_years?: number | null;
  annual_savings_amount?: number | null;
  simulation_monthly_savings?: number | null;
  simulation_annual_lump_sum?: number | null;
  simulation_total_lump_sum?: number | null;
  expected_return_rate?: number | null;
  simulation_target_fund?: number | null;
  target_retirement_fund?: number | null;
  simulation_data?: Record<string, unknown>[] | null;
  plan_start_year?: number | null;
  // 신규 필드
  calculation_params?: Record<string, unknown> | null;
  use_inflation_input?: boolean | null;
  use_inflation_calc?: boolean | null;
  future_monthly_amount?: number | null;
  current_value_monthly?: number | null;
}

// Recharts SSR 방지
const RetirementGrowthChart = dynamic(() => import('./RetirementGrowthChart'), { ssr: false });

/* ------------------------------------------------------------------ */
/*  토스트 컴포넌트                                                      */
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
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 500,
  color: '#374151',
  marginBottom: '6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: '40px',
  padding: '0 48px 0 12px',
  fontSize: '14px',
  color: '#1A1A2E',
  backgroundColor: '#ffffff',
  border: '1px solid #D1D5DB',
  borderRadius: '8px',
  outline: 'none',
  boxSizing: 'border-box',
  textAlign: 'right',
};

const unitStyle: React.CSSProperties = {
  position: 'absolute',
  right: '12px',
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: '12px',
  color: '#6B7280',
  pointerEvents: 'none',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#1E3A5F',
  marginBottom: '20px',
  marginTop: 0,
};

/* ------------------------------------------------------------------ */
/*  숫자 전용 Input 컴포넌트                                             */
/* ------------------------------------------------------------------ */

function NumericInput({
  id,
  label,
  value,
  onChange,
  unit,
  disabled,
  isCurrency = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (val: string) => void;
  unit: string;
  disabled?: boolean;
  isCurrency?: boolean;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isCurrency) {
      onChange(formatInputCurrency(e.target.value));
    } else {
      onChange(e.target.value.replace(/[^\d.]/g, ''));
    }
  };

  return (
    <div>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          aria-label={label}
          type="text"
          inputMode="numeric"
          value={value}
          onChange={handleChange}
          placeholder="0"
          disabled={disabled}
          style={inputStyle}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = '#1E3A5F';
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(30,58,95,0.12)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = '#D1D5DB';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        <span style={unitStyle}>{unit}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  메인 컴포넌트                                                        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  기본정보 읽기전용 카드                                               */
/* ------------------------------------------------------------------ */

function BasicInfoCard({
  data,
  currentAge,
}: {
  data: DesiredPlanSummary | null;
  currentAge: number | null;
}) {
  if (!data) {
    return (
      <div style={{ padding: '24px', backgroundColor: '#F9FAFB', borderRadius: '8px', textAlign: 'center', color: '#9CA3AF', fontSize: '13px' }}>
        1번탭(은퇴플랜 설계)에서 먼저 저장해주세요.
      </div>
    );
  }

  const p = data.calculation_params || {};
  const simData = data.simulation_data || [];
  const retirementAge = data.desired_retirement_age ?? null;
  const savingsPeriod = data.savings_period_years ?? null;
  const holdingPeriod = data.holding_period_years ?? null;

  // 플랜 시작연도/나이
  const planStartYear = data.plan_start_year ?? new Date().getFullYear();
  const currentYear = new Date().getFullYear();
  const planStartAge = currentAge != null ? currentAge - (currentYear - planStartYear) : null;
  const retirementYear = planStartAge != null && retirementAge != null
    ? planStartYear + (retirementAge - planStartAge) : null;
  const totalPeriod = savingsPeriod != null && holdingPeriod != null ? savingsPeriod + holdingPeriod : null;

  // 투자계획: 테이블에서 실제 적립/거치 집계
  let totalSavings = 0, totalHolding = 0, savingsCount = 0;
  for (const row of simData) {
    const mp = (row.monthly_payment as number) ?? 0;
    const ad = (row.additional as number) ?? 0;
    if (mp > 0) { totalSavings += mp * 12; savingsCount++; }
    if (ad > 0) totalHolding += ad;
  }
  const avgAnnualSavings = savingsCount > 0 ? totalSavings / savingsCount : 0;
  const totalInvestment = totalSavings + totalHolding;

  // 목표: 테이블에서 은퇴나이-1, 100세 평가금액
  const retireRow = simData.find(r => retirementAge != null && (r.age as number) === retirementAge - 1);
  const age100Row = simData.find(r => (r.age as number) === 100);
  const retireFund = (retireRow?.evaluation as number) ?? 0;
  const inheritFund = (age100Row?.evaluation as number) ?? 0;

  // 수익률, 연금액
  const recRetRate = p.recommended_return_rate as number | undefined;
  const exRetRate = p.existing_return_rate as number | undefined;
  const investRate = recRetRate ?? exRetRate ?? (data.expected_return_rate ?? null);
  const pensionRate = (p.recommended_pension_rate as number) ?? (p.base_pension_rate as number) ?? (p.pension_return_rate as number) ?? null;
  const futureMonthly = data.future_monthly_amount ?? null;
  const useInflInput = !!data.use_inflation_input;
  const useInflCalc = !!data.use_inflation_calc;

  // 포맷
  const fmtOk = (v: number) => {
    if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억원`;
    if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원`;
    return `${v.toLocaleString('ko-KR')}원`;
  };

  const itemStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #F3F4F6' };
  const lbl: React.CSSProperties = { fontSize: 13, color: '#6B7280' };
  const val: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: '#111827', fontVariantNumeric: 'tabular-nums' };
  const accent: React.CSSProperties = { ...val, color: '#1E3A5F' };
  const groupTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#1E3A5F', marginBottom: 8, paddingBottom: 6, borderBottom: '2px solid #1E3A5F', letterSpacing: '0.02em' };
  const badge: React.CSSProperties = { fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 600, marginLeft: 6 };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
      {/* 그룹1: 기간 설정 */}
      <div style={{ padding: '16px 20px', backgroundColor: '#FAFBFC', borderRadius: 10, border: '1px solid #E5E7EB' }}>
        <div style={groupTitle}>기간 설정</div>
        <div style={itemStyle}><span style={lbl}>플랜 시작</span><span style={accent}>{planStartAge != null ? `${planStartYear}년 (${planStartAge}세)` : '-'}</span></div>
        <div style={itemStyle}><span style={lbl}>희망 은퇴</span><span style={accent}>{retirementAge != null && retirementYear != null ? `${retirementYear}년 (${retirementAge}세)` : retirementAge != null ? `${retirementAge}세` : '-'}</span></div>
        <div style={itemStyle}><span style={lbl}>총 투자기간</span><span style={val}>{totalPeriod != null ? `${totalPeriod}년` : '-'}</span></div>
        <div style={{ ...itemStyle, borderBottom: 'none' }}><span style={lbl}>구성</span><span style={{ fontSize: 13, color: '#374151' }}>적립 {savingsPeriod ?? '-'}년 + 거치 {holdingPeriod ?? '-'}년</span></div>
      </div>

      {/* 그룹2: 투자 계획 */}
      <div style={{ padding: '16px 20px', backgroundColor: '#FAFBFC', borderRadius: 10, border: '1px solid #E5E7EB' }}>
        <div style={groupTitle}>투자 계획</div>
        <div style={itemStyle}><span style={lbl}>연적립금액 (평균)</span><span style={val}>{avgAnnualSavings > 0 ? fmtOk(avgAnnualSavings) : '-'}</span></div>
        <div style={itemStyle}><span style={lbl}>총거치금액</span><span style={val}>{totalHolding > 0 ? fmtOk(totalHolding) : '-'}</span></div>
        <div style={{ ...itemStyle, borderBottom: 'none' }}><span style={lbl}>총투자금액</span><span style={{ ...val, fontSize: 15 }}>{totalInvestment > 0 ? fmtOk(totalInvestment) : '-'}</span></div>
      </div>

      {/* 그룹3: 목표 */}
      <div style={{ padding: '16px 20px', backgroundColor: '#F0F4FA', borderRadius: 10, border: '1px solid #D0DAE8' }}>
        <div style={groupTitle}>목표</div>
        <div style={itemStyle}><span style={lbl}>예상 투자수익률</span><span style={{ ...val, color: '#16A34A' }}>{investRate != null ? `${(investRate * 100).toFixed(1)}%` : '-'}</span></div>
        <div style={itemStyle}><span style={lbl}>예상 연금수익률</span><span style={{ ...val, color: '#16A34A' }}>{pensionRate != null ? `${(pensionRate * 100).toFixed(1)}%` : '-'}</span></div>
        <div style={itemStyle}>
          <span style={lbl}>은퇴당시 연금액</span>
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <span style={val}>{futureMonthly != null && futureMonthly > 0 ? `${Math.round(futureMonthly / 1e4).toLocaleString('ko-KR')}만원/월` : '-'}</span>
            <span style={{ ...badge, backgroundColor: useInflInput ? '#DBEAFE' : '#F3F4F6', color: useInflInput ? '#1D4ED8' : '#6B7280' }}>
              물가{useInflInput ? 'O' : 'X'}
            </span>
          </span>
        </div>
        <div style={itemStyle}>
          <span style={lbl}>은퇴자금</span>
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#1E3A5F' }}>{retireFund > 0 ? fmtOk(retireFund) : '-'}</span>
            <span style={{ ...badge, backgroundColor: useInflCalc ? '#DBEAFE' : '#F3F4F6', color: useInflCalc ? '#1D4ED8' : '#6B7280' }}>
              물가{useInflCalc ? 'O' : 'X'}
            </span>
          </span>
        </div>
        <div style={{ ...itemStyle, borderBottom: 'none' }}>
          <span style={lbl}>상속자금</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: inheritFund > 0 ? '#059669' : '#EF4444' }}>{fmtOk(inheritFund)}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  메인 컴포넌트                                                        */
/* ------------------------------------------------------------------ */

export function RetirementPlanTab() {
  const { selectedCustomer } = useRetirementStore();
  const customerId = selectedCustomer?.id ?? null;

  // 1번탭 기본정보 (읽기전용)
  const [desiredPlanData, setDesiredPlanData] = useState<DesiredPlanSummary | null>(null);

  // 폼 상태
  const [currentAge, setCurrentAge] = useState('');
  const [lumpSum, setLumpSum] = useState('');
  const [annualSavings, setAnnualSavings] = useState('');
  const [savingPeriod, setSavingPeriod] = useState('');
  const [inheritanceConsideration, setInheritanceConsideration] = useState(false);
  const [annualReturnRate, setAnnualReturnRate] = useState('7');
  const [targetFund, setTargetFund] = useState('');
  const [targetPension, setTargetPension] = useState('');
  const [desiredRetirementAge, setDesiredRetirementAge] = useState('');
  const [possibleRetirementAge, setPossibleRetirementAge] = useState('');

  // UI 상태
  const [isLoading, setIsLoading] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [planId, setPlanId] = useState<number | null>(null);

  // 결과 상태
  const [projections, setProjections] = useState<YearlyProjection[] | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  /* 1번탭 데이터 로드 - 기본정보 표시용 */
  const loadDesiredPlan = useCallback(
    async (cid: string) => {
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${cid}`, {
          headers: authLib.getAuthHeader(),
        });
        if (res.ok) {
          const data: DesiredPlanSummary & {
            monthly_desired_amount?: number;
            target_total_fund?: number;
          } = await res.json();

          // 기본정보 표시용 저장
          setDesiredPlanData(data);

          // 기존 폼 세팅 (하위 호환)
          if (data.monthly_desired_amount) {
            setTargetPension(formatInputCurrency(String(data.monthly_desired_amount)));
          }
          if (data.target_total_fund) {
            setTargetFund(formatInputCurrency(String(data.target_total_fund)));
          }
          // 1번탭 희망은퇴나이 → 폼에 세팅
          if (data.desired_retirement_age) {
            setDesiredRetirementAge(String(data.desired_retirement_age));
          }
          // 수익률 세팅
          if (data.expected_return_rate) {
            setAnnualReturnRate(String((data.expected_return_rate * 100).toFixed(1)));
          }
        } else {
          setDesiredPlanData(null);
        }
      } catch {
        setDesiredPlanData(null);
      }
    },
    []
  );

  /* 3번탭 저장 데이터 로드 */
  const loadPlan = useCallback(
    async (cid: string) => {
      setIsLoading(true);
      // 1번탭 기본정보는 항상 불러옴 (기본정보 카드에 표시)
      loadDesiredPlan(cid);
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/plans/${cid}`, {
          headers: authLib.getAuthHeader(),
        });
        if (res.ok) {
          const data: RetirementPlanData = await res.json();
          setPlanId(data.id ?? null);
          setCurrentAge(String(data.current_age));
          setLumpSum(formatInputCurrency(String(data.lump_sum_amount)));
          setAnnualSavings(formatInputCurrency(String(data.annual_savings)));
          setSavingPeriod(String(data.saving_period_years));
          setInheritanceConsideration(data.inheritance_consideration);
          setAnnualReturnRate(String(data.annual_return_rate));
          setTargetFund(formatInputCurrency(String(data.target_retirement_fund)));
          setTargetPension(formatInputCurrency(String(data.target_pension_amount)));
          setDesiredRetirementAge(String(data.desired_retirement_age));
          setPossibleRetirementAge(String(data.possible_retirement_age));

          // 저장된 데이터가 있으면 자동 시뮬레이션
          await runSimulation(data);
        }
        // 404인 경우 loadDesiredPlan에서 폼 기본값 세팅이 이미 완료됨
      } catch {
        // 네트워크 에러 무시
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadDesiredPlan]
  );

  useEffect(() => {
    if (customerId) {
      loadPlan(customerId);
    } else {
      // 고객 초기화
      setDesiredPlanData(null);
      setCurrentAge('');
      setLumpSum('');
      setAnnualSavings('');
      setSavingPeriod('');
      setInheritanceConsideration(false);
      setAnnualReturnRate('7');
      setTargetFund('');
      setTargetPension('');
      setDesiredRetirementAge('');
      setPossibleRetirementAge('');
      setPlanId(null);
      setProjections(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  /* 시뮬레이션 실행 */
  const runSimulation = async (params: SimulationCalculateRequest | RetirementPlanData) => {
    const body: SimulationCalculateRequest = {
      current_age: 'current_age' in params ? params.current_age : Number(currentAge) || 0,
      lump_sum_amount:
        'lump_sum_amount' in params
          ? params.lump_sum_amount
          : parseCurrency(lumpSum),
      annual_savings:
        'annual_savings' in params
          ? params.annual_savings
          : parseCurrency(annualSavings),
      saving_period_years:
        'saving_period_years' in params
          ? params.saving_period_years
          : Number(savingPeriod) || 0,
      inflation_rate:
        'inflation_rate' in params ? params.inflation_rate : 0,
      annual_return_rate:
        'annual_return_rate' in params
          ? params.annual_return_rate
          : Number(annualReturnRate) || 7,
      target_retirement_fund:
        'target_retirement_fund' in params
          ? params.target_retirement_fund
          : parseCurrency(targetFund),
      target_pension_amount:
        'target_pension_amount' in params
          ? params.target_pension_amount
          : parseCurrency(targetPension),
      desired_retirement_age:
        'desired_retirement_age' in params
          ? params.desired_retirement_age
          : Number(desiredRetirementAge) || 65,
      possible_retirement_age:
        'possible_retirement_age' in params
          ? params.possible_retirement_age
          : Number(possibleRetirementAge) || 65,
      inheritance_consideration:
        'inheritance_consideration' in params
          ? params.inheritance_consideration
          : inheritanceConsideration,
    };

    const res = await fetch(`${API_URL}/api/v1/retirement/simulation/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authLib.getAuthHeader(),
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data: SimulationCalculateResponse = await res.json();
      setProjections(data.yearly_projections);
    }
  };

  /* 계산 버튼 핸들러 */
  const handleCalculate = async () => {
    const age = Number(currentAge);
    if (!age || age < 1 || age > 100) {
      showToast('현재 나이를 올바르게 입력하세요.', 'error');
      return;
    }
    setIsCalculating(true);
    try {
      await runSimulation({
        current_age: age,
        lump_sum_amount: parseCurrency(lumpSum),
        annual_savings: parseCurrency(annualSavings),
        saving_period_years: Number(savingPeriod) || 0,
        inflation_rate: 0,
        annual_return_rate: Number(annualReturnRate) || 7,
        target_retirement_fund: parseCurrency(targetFund),
        target_pension_amount: parseCurrency(targetPension),
        desired_retirement_age: Number(desiredRetirementAge) || 65,
        possible_retirement_age: Number(possibleRetirementAge) || 65,
        inheritance_consideration: inheritanceConsideration,
      });
    } catch {
      showToast('계산 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsCalculating(false);
    }
  };

  /* 저장 버튼 핸들러 */
  const handleSave = async () => {
    if (!customerId) {
      showToast('고객을 먼저 선택하세요.', 'error');
      return;
    }
    const age = Number(currentAge);
    if (!age) {
      showToast('현재 나이를 입력하세요.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const body = {
        customer_id: Number(customerId),
        current_age: age,
        lump_sum_amount: parseCurrency(lumpSum),
        annual_savings: parseCurrency(annualSavings),
        saving_period_years: Number(savingPeriod) || 0,
        inflation_rate: 0,
        annual_return_rate: Number(annualReturnRate) || 7,
        target_retirement_fund: parseCurrency(targetFund),
        target_pension_amount: parseCurrency(targetPension),
        desired_retirement_age: Number(desiredRetirementAge) || 65,
        possible_retirement_age: Number(possibleRetirementAge) || 65,
        inheritance_consideration: inheritanceConsideration,
      };

      const url = planId
        ? `${API_URL}/api/v1/retirement/plans/${planId}`
        : `${API_URL}/api/v1/retirement/plans`;
      const method = planId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data: RetirementPlanData = await res.json();
        setPlanId(data.id ?? null);
        showToast('은퇴플랜이 저장되었습니다.', 'success');
        // 저장 후 자동 재계산
        await runSimulation(data);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast((err as { detail?: string }).detail || '저장에 실패했습니다.', 'error');
      }
    } catch {
      showToast('네트워크 오류가 발생했습니다.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // 그래프 데이터 변환
  const chartData =
    projections?.map((p) => ({
      age: p.age,
      amount: Math.round(p.evaluation),
    })) ?? [];

  const desiredRetirementAgeNum = Number(desiredRetirementAge) || undefined;

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
      {/* 내보내기 버튼 */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ExportButtons
          sectionGroups={[['pdf-tab2-info', 'pdf-tab2-table']]}
          filename={`은퇴플랜_${selectedCustomer?.name ?? ''}.pdf`}
          activeTab="은퇴플랜"
          customerInfo={selectedCustomer ? {
            name: selectedCustomer.name,
            birthDate: selectedCustomer.birthDate ?? '-',
            targetFund: selectedCustomer.targetFund > 0
              ? (selectedCustomer.targetFund >= 1e8
                  ? `${(selectedCustomer.targetFund / 1e8).toFixed(1)}억원`
                  : `${selectedCustomer.targetFund.toLocaleString()}만원`)
              : '-',
            retireAge: selectedCustomer.retirementAge > 0 ? String(selectedCustomer.retirementAge) : '-',
          } : undefined}
        />
      </div>

      {/* 상단: 기본정보 (1번탭 데이터 읽기전용) */}
      <div id="pdf-tab2-info" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>기본정보</h3>
          <span style={{ fontSize: '12px', color: '#9CA3AF' }}>
            수정은 1번탭(희망은퇴플랜)에서 가능합니다.
          </span>
        </div>
        <BasicInfoCard
          data={desiredPlanData}
          currentAge={selectedCustomer?.currentAge ?? null}
        />
      </div>

      {/* 연도별 예상 평가금액 (1번탭 시뮬레이션 데이터) */}
      <div id="pdf-tab2-table" style={cardStyle}>
        <h3 style={sectionTitleStyle}>연도별 예상 평가금액</h3>
        {desiredPlanData?.simulation_data && desiredPlanData.simulation_data.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#F9FAFB' }}>
                  {['연도', '연차', '나이', '구분', '월적립(만)', '거치금(만)', '누적원금', '운용수익', '연금인출', '누적인출', '총평가'].map(col => (
                    <th key={col} style={{ padding: '10px 12px', textAlign: ['연도', '연차', '나이', '구분'].includes(col) ? 'center' : 'right', fontSize: '12px', fontWeight: 600, color: col === '연금인출' || col === '누적인출' ? '#DC2626' : '#6B7280', borderBottom: '1px solid #E5E7EB', whiteSpace: 'nowrap' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => { let runCumPension = 0; return (desiredPlanData.simulation_data ?? []).map((row: Record<string, unknown>, idx: number) => {
                  const year = Number(row.year ?? idx + 1);
                  const age = Number(row.age ?? 0);
                  const rawPhase = String(row.phase ?? row.type ?? '-');
                  const phaseLabel = rawPhase === 'saving' ? '적립' : rawPhase === 'holding' ? '거치' : rawPhase === 'retirement' ? '은퇴후' : rawPhase;
                  const phaseColor = rawPhase === 'saving' ? '#3B82F6' : rawPhase === 'holding' ? '#D4A847' : '#16A34A';
                  const mp = Number(row.monthly_payment ?? 0);
                  const ad = Number(row.additional ?? 0);
                  const principal = Number(row.cumulative_principal ?? row.principal ?? 0);
                  const profit = Number(row.investment_return ?? row.profit ?? 0);
                  const evaluation = Number(row.evaluation ?? 0);
                  const pension = Number(row.pension ?? 0);
                  runCumPension += pension;
                  const cumPension = runCumPension;
                  const retAgeNum = desiredPlanData.desired_retirement_age ?? 65;
                  const isRetAge = age === retAgeNum;
                  const isRetirement = rawPhase === 'retirement';
                  const planStartYear = desiredPlanData.plan_start_year ?? new Date().getFullYear();
                  const calYear = planStartYear + year - 1;
                  const bgColor = isRetAge ? 'rgba(30,58,95,0.06)' : isRetirement ? '#F0FDF4' : idx % 2 === 0 ? '#fff' : '#FAFAFA';
                  return (
                    <tr key={year} style={{ backgroundColor: bgColor, borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11, color: '#9CA3AF' }}>{calYear}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>{year}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: isRetAge ? 700 : 400, color: isRetAge ? '#1E3A5F' : '#374151' }}>
                        {age}세{isRetAge && <span style={{ marginLeft: 4, fontSize: 10, color: '#1E3A5F' }}>★</span>}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', color: phaseColor, fontWeight: 600, fontSize: 12 }}>{phaseLabel}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{mp > 0 ? formatCurrency(Math.round(mp / 1e4)) : '-'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{ad > 0 ? formatCurrency(Math.round(ad / 1e4)) : '-'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{formatCurrency(Math.round(principal / 1e4))}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: profit >= 0 ? '#16A34A' : '#DC2626' }}>{formatCurrency(Math.round(profit / 1e4))}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#DC2626' }}>{pension > 0 ? formatCurrency(Math.round(pension / 1e4)) : '-'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#DC2626' }}>{cumPension > 0 ? formatCurrency(Math.round(cumPension / 1e4)) : '-'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>{formatCurrency(Math.round(evaluation / 1e4))}</td>
                    </tr>
                  );
                }); })()}
              </tbody>
            </table>
            <div style={{ textAlign: 'right', fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>(단위: 만원)</div>
          </div>
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>
            1번탭에서 복리 성장 시뮬레이션을 계산하고 저장해주세요.
          </div>
        )}
      </div>

      {/* 성장 그래프 */}
      {desiredPlanData?.simulation_data && desiredPlanData.simulation_data.length > 0 && (
        <div style={cardStyle}>
          <h3 style={sectionTitleStyle}>성장 그래프</h3>
          <RetirementGrowthChart
            data={desiredPlanData.simulation_data.map((row: Record<string, unknown>) => ({
              age: Number(row.age ?? 0),
              amount: Math.round(Number(row.evaluation ?? 0)),
              phase: String(row.phase ?? (Number(row.monthly_payment ?? 0) > 0 ? 'saving' : 'holding')),
              principal: Math.round(Number(row.cumulative_principal ?? 0)),
              pension: Math.round(Number(row.pension ?? 0)),
            }))}
            retirementAge={desiredPlanData.desired_retirement_age ?? 65}
          />
        </div>
      )}

      {/* -- 기존 시뮬레이션 설정/테이블/그래프 제거 완료 -- */}

      {/* 토스트 */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  금액 셀 컴포넌트                                                     */
/* ------------------------------------------------------------------ */

function AmountCell({
  value,
  highlight = false,
  bold = false,
}: {
  value: number;
  highlight?: boolean;
  bold?: boolean;
}) {
  return (
    <td
      style={{
        padding: '8px 12px',
        textAlign: 'right',
        color: highlight ? '#1E3A5F' : '#1A1A2E',
        fontWeight: bold || highlight ? 600 : 400,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      {formatCurrency(value)}
    </td>
  );
}

export default RetirementPlanTab;
